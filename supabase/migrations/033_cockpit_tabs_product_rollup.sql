-- 033_cockpit_tabs_product_rollup.sql
--
-- Cockpit tabs (#134, follow-up to 032): Overview / Menu Profitability /
-- Suppliers / Setup still paged every pos_sales_items row (~9k on Lavara,
-- ~2 s) just to group by product. This migration adds a per-product
-- SECURITY DEFINER RPC and speeds up cockpit_pos_rollup (~950 ms on
-- staging vs ~130–210 ms locally).
--
-- WHAT WAS SLOW ON THE EXISTING ROLLUP (verified locally, see PR):
--   * 032 referenced the `classified` CTE ~11 times. Postgres inlined it,
--     so pos_line_is_tip + timezone conversion ran once per reference.
--     MATERIALIZED classified/lines = one scan.
--   * 032 wrapped sale_date in to_char(...) ~ regex. sale_date is `date`
--     NOT NULL (001), so the predicate is always true and hides the
--     031 index column. Dropped.
--   * Index hunch: 031 already added
--     idx_pos_sales_items_company_location_date (company_id, location_id,
--     sale_date DESC). After dropping the wrap, EXPLAIN uses that prefix.
--     No extra btree — same leading columns. Not a missing index.
--
-- WHAT THIS FILE DOES (additive, idempotent, no row DELETE):
--   1. CREATE OR REPLACE cockpit_pos_rollup: same JSON as 032, MATERIALIZED
--      CTEs, no to_char(sale_date) filter. Membership checked once.
--   2. CREATE OR REPLACE cockpit_pos_product_rollup: per-product totals
--      the tabs need (raw name × location × currency × tip flag).
--
-- Safe to re-run. Apply on Milton Staging after 032. No production apply
-- as part of this PR.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change.

-- ---------------------------------------------------------------------------
-- Faster executive rollup (same payload as 032).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_pos_rollup(
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
  -- Fail closed: do not scan another company's rows, even as DEFINER.
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RETURN jsonb_build_object(
      'row_count', 0,
      'period_from', NULL,
      'period_to', NULL,
      'revenue', jsonb_build_object(
        'gross_sales', 0,
        'discounts', 0,
        'net_sales', 0,
        'tips', 0,
        'odoo_like_total', 0,
        'discounts_estimated', false
      ),
      'tickets', 0,
      'units', 0,
      'daily', '[]'::jsonb,
      'heatmap_cells', '[]'::jsonb,
      'hours_seen', '[]'::jsonb,
      'lunch', jsonb_build_object('net_sales', 0, 'tickets', 0),
      'dinner', jsonb_build_object('net_sales', 0, 'tickets', 0),
      'channel_weeks', '[]'::jsonb,
      'payment_weeks', '[]'::jsonb,
      'category_mix', '[]'::jsonb,
      'channel_by_day', '[]'::jsonb,
      'this_week', NULL,
      'last_week', NULL
    );
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
      psi.id,
      psi.sale_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char((psi.order_placed_at AT TIME ZONE tz), 'YYYY-MM-DD')
        ELSE to_char(psi.sale_date, 'YYYY-MM-DD')
      END AS local_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(DOW FROM (psi.order_placed_at AT TIME ZONE tz))::int
        WHEN psi.sale_date IS NOT NULL THEN
          EXTRACT(DOW FROM psi.sale_date)::int
        ELSE NULL
      END AS local_weekday,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(HOUR FROM (psi.order_placed_at AT TIME ZONE tz))::int
        ELSE NULL
      END AS local_hour,
      coalesce(nullif(trim(psi.check_id), ''), nullif(trim(psi.order_id), ''))
        AS order_key,
      CASE
        WHEN psi.gross_revenue IS NOT NULL AND psi.gross_revenue = psi.gross_revenue
          THEN psi.gross_revenue
        WHEN psi.net_revenue IS NOT NULL AND psi.net_revenue = psi.net_revenue
          THEN psi.net_revenue
        ELSE 0
      END AS posted,
      CASE
        WHEN psi.discount_amount IS NOT NULL AND psi.discount_amount = psi.discount_amount
          THEN psi.discount_amount
        ELSE 0
      END AS discount_amount,
      coalesce(
        (psi.source_metadata ->> 'discount_estimated') = 'true',
        false
      ) AS discount_estimated,
      public.pos_line_is_tip(psi.is_tip, psi.raw_item_name) AS is_tip,
      CASE
        WHEN psi.quantity IS NOT NULL AND psi.quantity = psi.quantity THEN psi.quantity
        ELSE 0
      END AS quantity,
      nullif(trim(psi.sales_channel), '') AS sales_channel,
      nullif(trim(psi.payment_type), '') AS payment_type,
      nullif(trim(psi.category), '') AS category
    FROM public.pos_sales_items psi
    WHERE psi.company_id = p_company_id
      AND (p_location_id IS NULL OR psi.location_id = p_location_id)
      AND (
        p_currency IS NULL
        OR psi.currency IS NULL
        OR psi.currency = p_currency
      )
  ),
  classified AS MATERIALIZED (
    SELECT
      id,
      sale_date,
      local_date,
      local_weekday,
      local_hour,
      order_key,
      posted,
      is_tip,
      quantity,
      discount_estimated,
      sales_channel,
      payment_type,
      category,
      CASE WHEN is_tip THEN 0 ELSE posted END AS net,
      CASE WHEN is_tip THEN posted ELSE 0 END AS tip,
      CASE WHEN is_tip THEN 0 ELSE discount_amount END AS discount,
      CASE WHEN is_tip THEN 0 ELSE posted + discount_amount END AS gross,
      CASE WHEN is_tip THEN 0 ELSE quantity END AS units
    FROM lines
  ),
  bounds AS (
    SELECT
      min(local_date) AS period_from,
      max(local_date) AS period_to,
      count(*)::int AS row_count
    FROM classified
  ),
  windows AS (
    SELECT
      period_from,
      period_to,
      row_count,
      CASE
        WHEN period_to IS NULL THEN NULL
        ELSE (period_to::date - 6)::text
      END AS this_from,
      period_to AS this_to,
      CASE
        WHEN period_to IS NULL THEN NULL
        ELSE (period_to::date - 13)::text
      END AS last_from,
      CASE
        WHEN period_to IS NULL THEN NULL
        ELSE (period_to::date - 7)::text
      END AS last_to
    FROM bounds
  ),
  totals AS (
    SELECT
      round(sum(gross)::numeric, 2) AS gross_sales,
      round(sum(discount)::numeric, 2) AS discounts,
      round(sum(net)::numeric, 2) AS net_sales,
      round(sum(tip)::numeric, 2) AS tips,
      round(sum(posted)::numeric, 2) AS odoo_like_total,
      bool_or(discount_estimated AND NOT is_tip) AS discounts_estimated,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets,
      round(sum(units)::numeric, 3) AS units
    FROM classified
  ),
  daily AS (
    SELECT
      local_date AS date,
      round(sum(net)::numeric, 2) AS net_sales,
      round(sum(gross)::numeric, 2) AS gross_sales,
      round(sum(discount)::numeric, 2) AS discounts,
      round(sum(tip)::numeric, 2) AS tips,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets,
      round(sum(units)::numeric, 3) AS units,
      bool_or(discount_estimated AND NOT is_tip) AS discounts_estimated
    FROM classified
    GROUP BY local_date
  ),
  heatmap AS (
    SELECT
      local_weekday AS weekday,
      local_hour AS hour,
      round(sum(net)::numeric, 2) AS net_sales,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets
    FROM classified
    WHERE local_hour IS NOT NULL AND local_weekday IS NOT NULL
    GROUP BY local_weekday, local_hour
  ),
  hours AS (
    SELECT coalesce(
      jsonb_agg(DISTINCT local_hour ORDER BY local_hour),
      '[]'::jsonb
    ) AS hours_seen
    FROM classified
    WHERE local_hour IS NOT NULL
  ),
  dayparts AS (
    SELECT
      round(sum(net) FILTER (WHERE local_hour IS NOT NULL AND local_hour < 17)::numeric, 2)
        AS lunch_net,
      count(DISTINCT order_key) FILTER (
        WHERE local_hour IS NOT NULL AND local_hour < 17 AND order_key IS NOT NULL
      )::int AS lunch_tickets,
      round(sum(net) FILTER (WHERE local_hour IS NOT NULL AND local_hour >= 17)::numeric, 2)
        AS dinner_net,
      count(DISTINCT order_key) FILTER (
        WHERE local_hour IS NOT NULL AND local_hour >= 17 AND order_key IS NOT NULL
      )::int AS dinner_tickets
    FROM classified
  ),
  channel_weeks AS (
    SELECT
      to_char(date_trunc('week', local_date::date), 'YYYY-MM-DD') AS period,
      coalesce(sales_channel, 'unknown') AS key,
      round(sum(net)::numeric, 2) AS net_sales
    FROM classified
    GROUP BY 1, 2
  ),
  payment_weeks AS (
    SELECT
      to_char(date_trunc('week', local_date::date), 'YYYY-MM-DD') AS period,
      coalesce(payment_type, 'unknown') AS key,
      round(sum(net)::numeric, 2) AS net_sales
    FROM classified
    GROUP BY 1, 2
  ),
  categories AS (
    SELECT
      category,
      round(sum(net)::numeric, 2) AS net_sales,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets,
      round(sum(units)::numeric, 3) AS units
    FROM classified
    WHERE NOT is_tip
    GROUP BY category
  ),
  channel_days AS (
    SELECT
      local_date AS date,
      coalesce(sales_channel, 'unknown') AS channel,
      round(sum(net)::numeric, 2) AS net_sales
    FROM classified
    WHERE NOT is_tip
    GROUP BY 1, 2
  ),
  week_totals AS (
    SELECT
      w.this_from,
      w.this_to,
      w.last_from,
      w.last_to,
      round(sum(c.net) FILTER (
        WHERE w.this_from IS NOT NULL
          AND c.local_date >= w.this_from
          AND c.local_date <= w.this_to
      )::numeric, 2) AS this_net,
      count(DISTINCT c.order_key) FILTER (
        WHERE w.this_from IS NOT NULL
          AND c.local_date >= w.this_from
          AND c.local_date <= w.this_to
          AND c.order_key IS NOT NULL
      )::int AS this_tickets,
      round(sum(c.net) FILTER (
        WHERE w.last_from IS NOT NULL
          AND c.local_date >= w.last_from
          AND c.local_date <= w.last_to
      )::numeric, 2) AS last_net,
      count(DISTINCT c.order_key) FILTER (
        WHERE w.last_from IS NOT NULL
          AND c.local_date >= w.last_from
          AND c.local_date <= w.last_to
          AND c.order_key IS NOT NULL
      )::int AS last_tickets
    FROM classified c
    CROSS JOIN windows w
    GROUP BY w.this_from, w.this_to, w.last_from, w.last_to
  )
  SELECT jsonb_build_object(
    'row_count', w.row_count,
    'period_from', w.period_from,
    'period_to', w.period_to,
    'revenue', jsonb_build_object(
      'gross_sales', coalesce(t.gross_sales, 0),
      'discounts', coalesce(t.discounts, 0),
      'net_sales', coalesce(t.net_sales, 0),
      'tips', coalesce(t.tips, 0),
      'odoo_like_total', coalesce(t.odoo_like_total, 0),
      'discounts_estimated', coalesce(t.discounts_estimated, false)
    ),
    'tickets', coalesce(t.tickets, 0),
    'units', coalesce(t.units, 0),
    'daily', coalesce((SELECT jsonb_agg(d ORDER BY d.date) FROM daily d), '[]'::jsonb),
    'heatmap_cells', coalesce(
      (SELECT jsonb_agg(h) FROM heatmap h),
      '[]'::jsonb
    ),
    'hours_seen', (SELECT hours_seen FROM hours),
    'lunch', jsonb_build_object(
      'net_sales', coalesce((SELECT lunch_net FROM dayparts), 0),
      'tickets', coalesce((SELECT lunch_tickets FROM dayparts), 0)
    ),
    'dinner', jsonb_build_object(
      'net_sales', coalesce((SELECT dinner_net FROM dayparts), 0),
      'tickets', coalesce((SELECT dinner_tickets FROM dayparts), 0)
    ),
    'channel_weeks', coalesce(
      (SELECT jsonb_agg(cw) FROM channel_weeks cw),
      '[]'::jsonb
    ),
    'payment_weeks', coalesce(
      (SELECT jsonb_agg(pw) FROM payment_weeks pw),
      '[]'::jsonb
    ),
    'category_mix', coalesce(
      (
        SELECT jsonb_agg(cat ORDER BY cat.net_sales DESC)
        FROM categories cat
      ),
      '[]'::jsonb
    ),
    'channel_by_day', coalesce(
      (SELECT jsonb_agg(cd) FROM channel_days cd),
      '[]'::jsonb
    ),
    'this_week', CASE
      WHEN wt.this_from IS NULL THEN NULL
      ELSE jsonb_build_object(
        'from', wt.this_from,
        'to', wt.this_to,
        'net_sales', coalesce(wt.this_net, 0),
        'tickets', coalesce(wt.this_tickets, 0)
      )
    END,
    'last_week', CASE
      WHEN wt.last_from IS NULL THEN NULL
      ELSE jsonb_build_object(
        'from', wt.last_from,
        'to', wt.last_to,
        'net_sales', coalesce(wt.last_net, 0),
        'tickets', coalesce(wt.last_tickets, 0)
      )
    END
  )
  INTO result
  FROM windows w
  CROSS JOIN totals t
  CROSS JOIN week_totals wt;

  RETURN coalesce(result, jsonb_build_object(
    'row_count', 0,
    'period_from', NULL,
    'period_to', NULL,
    'revenue', jsonb_build_object(
      'gross_sales', 0,
      'discounts', 0,
      'net_sales', 0,
      'tips', 0,
      'odoo_like_total', 0,
      'discounts_estimated', false
    ),
    'tickets', 0,
    'units', 0,
    'daily', '[]'::jsonb,
    'heatmap_cells', '[]'::jsonb,
    'hours_seen', '[]'::jsonb,
    'lunch', jsonb_build_object('net_sales', 0, 'tickets', 0),
    'dinner', jsonb_build_object('net_sales', 0, 'tickets', 0),
    'channel_weeks', '[]'::jsonb,
    'payment_weeks', '[]'::jsonb,
    'category_mix', '[]'::jsonb,
    'channel_by_day', '[]'::jsonb,
    'this_week', NULL,
    'last_week', NULL
  ));
END;
$$;

COMMENT ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text) IS
  'Company/location POS rollup for the cockpit. SECURITY DEFINER after is_company_member. MATERIALIZED scan. Safe to re-run this migration.';

REVOKE EXECUTE ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Per-product totals for cockpit tabs (menu profitability / overview).
-- Currency-mismatch rule matches lib/restaurant/currency.ts isSameCurrency
-- AND the profitability walk order (empty raw name is skipped first).
-- distinct_check_count matches JS `check_id ?? order_id` (blank check_id
-- does not fall back — unlike cockpit_pos_rollup tickets).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_pos_product_rollup(
  p_company_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_currency text DEFAULT NULL
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
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RETURN jsonb_build_object(
      'row_count', 0,
      'distinct_check_count', 0,
      'currency_mismatch_rows', 0,
      'products', '[]'::jsonb
    );
  END IF;

  WITH lines AS MATERIALIZED (
    SELECT
      nullif(btrim(psi.raw_item_name), '') AS raw_item_name,
      psi.location_id,
      psi.currency,
      CASE
        WHEN psi.check_id IS NOT NULL THEN psi.check_id
        ELSE psi.order_id
      END AS check_key,
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
  ),
  classified AS MATERIALIZED (
    SELECT
      raw_item_name,
      location_id,
      currency,
      check_key,
      is_tip,
      posted,
      CASE WHEN is_tip THEN 0 ELSE posted END AS net,
      CASE WHEN is_tip THEN 0 ELSE quantity END AS units,
      (
        p_currency IS NOT NULL
        AND raw_item_name IS NOT NULL
        AND currency IS NOT NULL
        AND btrim(currency) <> ''
        AND (
          upper(btrim(currency)) !~ '^[A-Z]{3}$'
          OR upper(btrim(currency)) <> upper(btrim(p_currency))
        )
      ) AS currency_mismatch
    FROM lines
  ),
  totals AS (
    SELECT
      count(*)::int AS row_count,
      count(DISTINCT check_key) FILTER (
        WHERE check_key IS NOT NULL AND check_key <> ''
      )::int AS distinct_check_count,
      count(*) FILTER (WHERE currency_mismatch)::int AS currency_mismatch_rows
    FROM classified
  ),
  products AS (
    SELECT
      raw_item_name,
      location_id,
      currency,
      is_tip,
      round(sum(units)::numeric, 3) AS units,
      round(sum(net)::numeric, 2) AS net,
      round(sum(posted)::numeric, 2) AS posted
    FROM classified
    WHERE raw_item_name IS NOT NULL
      AND NOT currency_mismatch
    GROUP BY raw_item_name, location_id, currency, is_tip
  )
  SELECT jsonb_build_object(
    'row_count', t.row_count,
    'distinct_check_count', t.distinct_check_count,
    'currency_mismatch_rows', t.currency_mismatch_rows,
    'products', coalesce(
      (
        SELECT jsonb_agg(p ORDER BY p.net DESC, p.raw_item_name)
        FROM products p
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM totals t;

  RETURN coalesce(result, jsonb_build_object(
    'row_count', 0,
    'distinct_check_count', 0,
    'currency_mismatch_rows', 0,
    'products', '[]'::jsonb
  ));
END;
$$;

COMMENT ON FUNCTION public.cockpit_pos_product_rollup(uuid, uuid, text) IS
  'Per-product POS totals for cockpit tabs. SECURITY DEFINER after is_company_member. Safe to re-run this migration.';

REVOKE EXECUTE ON FUNCTION public.cockpit_pos_product_rollup(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_pos_product_rollup(uuid, uuid, text)
  TO authenticated, service_role;
