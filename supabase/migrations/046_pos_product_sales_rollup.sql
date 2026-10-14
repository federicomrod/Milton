-- 046_pos_product_sales_rollup.sql
--
-- R1-12 (Speed). Menú, Platos and Resumen build their dish list from the
-- Odoo POS lines. Until now that meant paging ~20k raw pos_sales_items
-- rows through PostgREST (1000 per request: ~20 requests, ~2 s) and
-- summing them in Node. This function does the same sum inside Postgres
-- and returns ONE jsonb value, so a full Menú load reads ~1 request
-- instead of ~20, and a one-dish read stays one small request.
--
-- Why a function and not a refreshed table: a table needs a refresh hook
-- after every POS sync / CSV upload and goes stale if one is missed; the
-- numbers on screen must never differ from the raw lines. The function is
-- always exact, needs no backfill and no refresh, and works for any
-- restaurant/period filter. (A table can be layered on later if one
-- company grows past ~1M lines; EXPLAIN queries are in the PR.)
--
-- WHAT IT RETURNS
--   One element per group of lines that the Node builder treats the same:
--     (restaurant, own product, resolved combo parent, POS name, is_tip,
--      category). Each carries the sums the builder needs (units, posted
--      revenue = gross_revenue, line count) and the first/last line id,
--      so first-category / last-name tie-breaks are the same as walking
--      the rows ordered by id. The app turns each group into one
--      synthetic line and feeds the SAME buildPosProductList, so tip
--      rules, rounding and combo roll-up are not duplicated in SQL.
--   Filters: Odoo lines only, restaurant, inclusive sale_date range, and
--   (one-dish reads) the product's own lines.
--   combo parent = pos_sales_items.combo_parent_odoo_product_id, else the
--   product of the line named by combo_parent_external_line_id (same
--   resolution the Node code did over the rows it had loaded).
--
-- SAFETY (additive, idempotent, no data touched)
--   * CREATE OR REPLACE FUNCTION only. No table, column or row changes.
--   * SECURITY DEFINER after a single is_company_member() check (error
--     42501 for a non-member, so callers fall back instead of showing zero
--     sales), the same pattern as cockpit_pos_rollup (032). search_path
--     pinned. EXECUTE is revoked from PUBLIC and anon on both functions.
--   * Needs 038 (combo columns) — the app falls back to the raw-row walk
--     if this function is missing or errors, so applying it is optional
--     for correctness and only buys speed.
--
-- IMPORTANT: Supabase migrations are not applied from the repo by CI.
-- Paste this file into the Supabase SQL Editor (staging first).

CREATE OR REPLACE FUNCTION public.pos_odoo_product_id(meta jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
  n numeric;
BEGIN
  IF meta IS NULL THEN
    RETURN NULL;
  END IF;
  -- Same as `meta.product_id ?? meta.odoo_product_id`, integers only.
  v := meta -> 'product_id';
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    v := meta -> 'odoo_product_id';
  END IF;
  IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
    RETURN NULL;
  END IF;
  n := (v #>> '{}')::numeric;
  IF n <> trunc(n) OR abs(n) > 2147483647 THEN
    RETURN NULL;
  END IF;
  RETURN n::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_product_sales_groups(
  p_company_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_odoo_product_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Fail closed and loud: never aggregate another company's lines, even
  -- as DEFINER, and never answer "no sales" to someone who may not read
  -- them. The app treats the error as "function unavailable" and falls
  -- back to reading rows through RLS.
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company'
      USING ERRCODE = '42501';
  END IF;

  WITH lines AS (
    SELECT
      psi.id,
      psi.location_id,
      psi.raw_item_name,
      psi.quantity,
      psi.gross_revenue,
      psi.is_tip,
      NULLIF(btrim(psi.category), '') AS category,
      public.pos_odoo_product_id(psi.source_metadata) AS own_product_id,
      psi.combo_parent_odoo_product_id,
      NULLIF(btrim(psi.combo_parent_external_line_id), '') AS parent_line_id
    FROM public.pos_sales_items psi
    WHERE psi.company_id = p_company_id
      AND psi.pos_source = 'odoo'
      AND (p_location_id IS NULL OR psi.location_id = p_location_id)
      AND (p_from IS NULL OR psi.sale_date >= p_from)
      AND (p_to IS NULL OR psi.sale_date <= p_to)
      AND (
        p_odoo_product_id IS NULL
        OR psi.source_metadata ->> 'product_id' = p_odoo_product_id::text
      )
  ),
  resolved AS (
    SELECT
      l.*,
      COALESCE(
        l.combo_parent_odoo_product_id,
        (
          SELECT public.pos_odoo_product_id(pl.source_metadata)
          FROM public.pos_sales_items pl
          WHERE pl.company_id = p_company_id
            AND pl.pos_source = 'odoo'
            AND pl.external_line_id = l.parent_line_id
          LIMIT 1
        )
      ) AS parent_product_id
    FROM lines l
    WHERE l.own_product_id IS NOT NULL
  ),
  grouped AS (
    SELECT
      r.location_id,
      r.own_product_id,
      r.parent_product_id,
      r.raw_item_name,
      r.is_tip,
      r.category,
      SUM(r.quantity) AS quantity,
      SUM(r.gross_revenue) AS gross_revenue,
      COUNT(*) AS line_count,
      MIN(r.id::text) AS first_id,
      MAX(r.id::text) AS last_id
    FROM resolved r
    GROUP BY 1, 2, 3, 4, 5, 6
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'location_id', g.location_id,
        'product_id', g.own_product_id,
        'parent_product_id', g.parent_product_id,
        'name', g.raw_item_name,
        'is_tip', g.is_tip,
        'category', g.category,
        'quantity', g.quantity,
        'gross_revenue', g.gross_revenue,
        'line_count', g.line_count,
        'first_id', g.first_id,
        'last_id', g.last_id
      )
      ORDER BY g.last_id
    ),
    '[]'::jsonb
  )
  INTO result
  FROM grouped g;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_product_sales_groups(uuid, uuid, date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_product_sales_groups(uuid, uuid, date, date, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pos_product_sales_groups(uuid, uuid, date, date, integer) FROM anon;
REVOKE ALL ON FUNCTION public.pos_odoo_product_id(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_odoo_product_id(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_odoo_product_id(jsonb)
  TO authenticated, service_role;
