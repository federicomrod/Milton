-- 053_cockpit_product_day_rollup.sql
--
-- R1-16b (Cockpit v2). The Cockpit shows food cost % per day and the sales mix
-- by category for ANY period, filtered in the browser. For that it needs net
-- sales and units per DAY and PRODUCT (and POS category) once — not one query
-- per period. This function returns exactly that as ONE jsonb value, so the
-- app multiplies units by each product's unit cost and groups by category on
-- the server without paging ~20k raw pos_sales_items rows.
--
-- The lines are read exactly as cockpit_pos_rollup (031) reads them: LOCAL
-- date (order_placed_at in the company timezone, else sale_date), tips out,
-- net = the posted revenue, the same currency rule. One element per
-- (local date, restaurant, product, POS category):
--   {d: 'YYYY-MM-DD', l: location uuid | null, p: odoo product id | null,
--    c: category | null, n: net sales, u: units}
--
-- SAFETY (additive, idempotent, no data touched)
--   * CREATE OR REPLACE FUNCTION only. No table, column or row changes.
--   * SECURITY DEFINER after is_company_member(); a non-member gets 42501 (not
--     an empty "no sales" payload), so the app falls back to reading rows
--     through RLS instead of showing zero.
--   * EXECUTE revoked from PUBLIC and anon.
--   * Needs 031 (pos_line_is_tip) and 046 (pos_odoo_product_id). The app falls
--     back to the row walk if this function is missing: applying it is optional
--     for correctness and only buys speed.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.cockpit_product_day_rollup(
  p_company_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_currency text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text;
  result jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company'
      USING ERRCODE = '42501';
  END IF;

  tz := nullif(trim(coalesce(p_timezone, '')), '');
  IF tz IS NULL THEN
    tz := 'UTC';
  END IF;
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION
    WHEN others THEN
      tz := 'UTC';
  END;

  WITH lines AS MATERIALIZED (
    SELECT
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char((psi.order_placed_at AT TIME ZONE tz), 'YYYY-MM-DD')
        ELSE psi.sale_date
      END AS local_date,
      psi.location_id,
      public.pos_odoo_product_id(psi.source_metadata) AS product_id,
      nullif(trim(psi.category), '') AS category,
      CASE
        WHEN psi.gross_revenue IS NOT NULL AND psi.gross_revenue = psi.gross_revenue
          THEN psi.gross_revenue
        WHEN psi.net_revenue IS NOT NULL AND psi.net_revenue = psi.net_revenue
          THEN psi.net_revenue
        ELSE 0
      END AS posted,
      public.pos_line_is_tip(psi.is_tip, psi.raw_item_name) AS is_tip,
      CASE
        WHEN psi.quantity IS NOT NULL AND psi.quantity = psi.quantity THEN psi.quantity
        ELSE 0
      END AS quantity
    FROM public.pos_sales_items psi
    WHERE psi.company_id = p_company_id
      AND (p_location_id IS NULL OR psi.location_id = p_location_id)
      AND psi.sale_date ~ '^\d{4}-\d{2}-\d{2}$'
      AND (
        p_currency IS NULL
        OR psi.currency IS NULL
        OR psi.currency = p_currency
      )
  ),
  grouped AS (
    SELECT
      local_date, location_id, product_id, category,
      round(sum(posted)::numeric, 2) AS net,
      round(sum(quantity)::numeric, 3) AS units
    FROM lines
    WHERE NOT is_tip
    GROUP BY 1, 2, 3, 4
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'd', g.local_date,
        'l', g.location_id,
        'p', g.product_id,
        'c', g.category,
        'n', g.net,
        'u', g.units
      )
      ORDER BY g.local_date, g.product_id
    ),
    '[]'::jsonb
  )
  INTO result
  FROM grouped g;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_product_day_rollup(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cockpit_product_day_rollup(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cockpit_product_day_rollup(uuid, uuid, text, text)
  TO authenticated, service_role;

-- Read-only checks (after applying):
--   select jsonb_array_length(public.cockpit_product_day_rollup('<company uuid>', null, 'America/El_Salvador', null));
--   select has_function_privilege('anon', 'public.cockpit_product_day_rollup(uuid,uuid,text,text)', 'execute');  -- must be false
