-- 031_cockpit_pos_rollup.sql
--
-- Cockpit load (#134): server-side POS rollup + indexes so the executive
-- strip (KPIs, daily chart, heatmap) does not page every pos_sales_items
-- row through PostgREST's 1,000-row cap.
--
-- DESIGN: Additive and idempotent. No DROP, no DELETE, no rewrite of
-- existing rows. Functions are SECURITY INVOKER so RLS on
-- pos_sales_items still applies. The app tries cockpit_pos_rollup() and
-- falls back to the paginated reader when the function is missing.
--
-- Tip classification mirrors lib/restaurant/sales-revenue.ts:
--   is_tip = true  → tip
--   is_tip = false → not a tip
--   is_tip IS NULL → product name (Propina / tip / gratuity…), accent-folded
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 030. No production apply as part
-- of this PR.

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_location_date
  ON public.pos_sales_items (company_id, location_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_id
  ON public.pos_sales_items (company_id, id);

-- ---------------------------------------------------------------------------
-- Tip matcher — same rules as isTipSaleRow / isTipLineName in TypeScript.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_line_is_tip(
  p_is_tip boolean,
  p_raw_item_name text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  folded text;
  tokens text[];
  head text;
  suffix text;
  i int;
BEGIN
  IF p_is_tip IS TRUE THEN
    RETURN TRUE;
  END IF;
  IF p_is_tip IS FALSE THEN
    RETURN FALSE;
  END IF;

  folded := lower(trim(coalesce(p_raw_item_name, '')));
  IF folded = '' THEN
    RETURN FALSE;
  END IF;

  -- NFD + strip combining marks (Propína → propina), then collapse
  -- punctuation the same way foldTipKey() does in TypeScript.
  folded := regexp_replace(
    normalize(folded, NFD),
    E'[\\u0300-\\u036F]',
    '',
    'g'
  );
  folded := trim(regexp_replace(folded, '[^a-z0-9%]+', ' ', 'g'));
  IF folded = '' THEN
    RETURN FALSE;
  END IF;

  tokens := regexp_split_to_array(folded, '\s+');
  head := tokens[1];
  IF head IS NULL OR head = '' THEN
    RETURN FALSE;
  END IF;

  IF head IN ('propina', 'propinas', 'tips', 'gratuity', 'gratuities') THEN
    RETURN TRUE;
  END IF;

  IF head = 'tip' THEN
    FOR i IN 2 .. coalesce(array_length(tokens, 1), 1) LOOP
      suffix := tokens[i];
      IF suffix IS NULL OR suffix = '' THEN
        CONTINUE;
      END IF;
      IF suffix IN (
        'jar',
        'sugerido',
        'sugerida',
        'sugeridas',
        'sugeridos',
        'voluntaria',
        'voluntario',
        'voluntarias',
        'voluntarios',
        'tarjeta',
        'tarjetas',
        'servicio',
        'service',
        'pct',
        'percent'
      ) OR suffix = '%' OR suffix ~ '^[0-9]' THEN
        CONTINUE;
      END IF;
      RETURN FALSE;
    END LOOP;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.pos_line_is_tip(boolean, text) IS
  'Tip / Propina detector matching lib/restaurant/sales-revenue.ts. Column wins when set; otherwise the product name.';

-- ---------------------------------------------------------------------------
-- One-row JSON rollup for the cockpit executive strip and Sales hero.
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
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  tz text;
  result jsonb;
BEGIN
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

  WITH lines AS (
    SELECT
      psi.id,
      psi.sale_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char((psi.order_placed_at AT TIME ZONE tz), 'YYYY-MM-DD')
        ELSE psi.sale_date
      END AS local_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(DOW FROM (psi.order_placed_at AT TIME ZONE tz))::int
        WHEN psi.sale_date ~ '^\d{4}-\d{2}-\d{2}$' THEN
          EXTRACT(DOW FROM psi.sale_date::date)::int
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
      AND psi.sale_date ~ '^\d{4}-\d{2}-\d{2}$'
      AND (
        p_currency IS NULL
        OR psi.currency IS NULL
        OR psi.currency = p_currency
      )
  ),
  classified AS (
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
  'Company/location POS rollup for the cockpit. SECURITY INVOKER — RLS applies. Safe to re-run this migration.';

REVOKE EXECUTE ON FUNCTION public.pos_line_is_tip(boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_line_is_tip(boolean, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text)
  TO authenticated, service_role;
