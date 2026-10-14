-- 047_sales_period_rollup.sql
--
-- R1-14 (Speed). Ventas paged EVERY pos_sales_items row (~20k, 26 requests,
-- full columns) on each open just to build its period insights, while the
-- Cockpit already used a SQL rollup. This adds the Ventas equivalent: the
-- same rollup as cockpit_pos_rollup (033) restricted to a LOCAL-date
-- period, plus the per-day / per-weekday / per-slot figures that
-- salesDayStatsFromRows computed in Node (distinct tickets included, so
-- they are counted in SQL and never re-added). One jsonb value, one request.
--
-- SAFETY (additive, idempotent, no data touched)
--   * CREATE OR REPLACE FUNCTION only.
--   * SECURITY DEFINER after is_company_member(); a non-member gets error
--     42501 (not an empty "no sales" payload), so callers fall back to
--     reading rows through RLS instead of showing zero sales.
--   * EXECUTE revoked from PUBLIC and anon.
--   * Needs 031/033 (pos_line_is_tip); the app falls back to the row walk
--     if this function is missing, so applying it is optional for
--     correctness and only buys speed.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.sales_period_rollup(
  p_company_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_currency text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
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
      AND (p_from IS NULL OR psi.sale_date >= p_from - 1)
      AND (p_to IS NULL OR psi.sale_date <= p_to + 1)
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
    WHERE (p_from IS NULL OR local_date >= p_from::text)
      AND (p_to IS NULL OR local_date <= p_to::text)
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
  stat_days AS (
    SELECT
      local_date AS date,
      min(local_weekday) AS weekday,
      round(sum(net)::numeric, 2) AS net_sales,
      sum(net) AS net_raw,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets
    FROM classified
    WHERE NOT is_tip AND local_weekday IS NOT NULL
    GROUP BY local_date
  ),
  stat_weekdays AS (
    SELECT
      local_weekday AS weekday,
      round(sum(net)::numeric, 2) AS net_sales,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets
    FROM classified
    WHERE NOT is_tip AND local_weekday IS NOT NULL
    GROUP BY local_weekday
  ),
  stat_slots AS (
    SELECT
      local_weekday AS weekday,
      local_hour AS hour,
      round(sum(net)::numeric, 2) AS net_sales,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets,
      count(DISTINCT local_date)::int AS days
    FROM classified
    WHERE NOT is_tip AND local_hour IS NOT NULL AND local_weekday IS NOT NULL
    GROUP BY local_weekday, local_hour
  ),
  stat_totals AS (
    SELECT count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets
    FROM classified
    WHERE NOT is_tip AND local_weekday IS NOT NULL
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
    'stat_days', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
          'date', sd.date, 'weekday', sd.weekday, 'net_sales', sd.net_sales,
          'net_raw', sd.net_raw, 'tickets', sd.tickets) ORDER BY sd.date)
       FROM stat_days sd),
      '[]'::jsonb
    ),
    'stat_weekdays', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
          'weekday', sw.weekday, 'net_sales', sw.net_sales, 'tickets', sw.tickets)
          ORDER BY sw.weekday)
       FROM stat_weekdays sw),
      '[]'::jsonb
    ),
    'stat_slots', coalesce(
      (SELECT jsonb_agg(ss ORDER BY ss.weekday, ss.hour) FROM stat_slots ss),
      '[]'::jsonb
    ),
    'stat_tickets', coalesce((SELECT tickets FROM stat_totals), 0),
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

REVOKE ALL ON FUNCTION public.sales_period_rollup(uuid, uuid, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_period_rollup(uuid, uuid, text, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_period_rollup(uuid, uuid, text, text, date, date)
  TO authenticated, service_role;
