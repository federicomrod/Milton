-- 054_restaurant_shifts.sql
--
-- R1-17a (Ventas › Detalle redesign, part 1). Two things that belong together:
--
--  1. TURNOS. The lunch/dinner split of Ventas was hard-coded (hour < 17).
--     Each restaurant now has its own shifts (Almuerzo, Cena, Desayuno…):
--     name, start/end (end < start crosses midnight), weekdays, active.
--     An order belongs to the shift that contains its LOCAL clock time on its
--     business weekday. It is computed at query time and never stored, so
--     editing the hours re-buckets history. Orders outside every shift of a
--     restaurant that has shifts are «Otro horario».
--
--  2. THE BUSINESS DAY. Sales after midnight belong to the PREVIOUS business
--     day. The cutoff of a restaurant is the end of its last shift that
--     crosses midnight (never more than 09:00); with no such shift, 04:00.
--     business date = (local timestamp − cutoff)::date. The three rollups
--     below are re-created with it (new versions; 032, 047 and 053 stay as
--     they were): the daily series, the weekday of the heatmap, shift
--     assignment and «Mejor día» all follow it. The hour of an order stays the
--     real clock hour.
--
-- ALSO FIXED HERE: 053 declared `sale_date` as text. It is a date, so on the
-- real schema 053's function failed when called and the app silently used its
-- row walk. The version below uses the right type.
--
-- SAFETY (additive; no existing row is changed)
--   * New table restaurant_shifts (RLS through is_company_member; anon revoked)
--     and three new functions. The rollups are CREATE OR REPLACE with the same
--     names and signatures, so the app calls them unchanged.
--   * restaurant_shifts_save is SECURITY DEFINER with a pinned search_path: a
--     non-member gets 42501; overlapping active shifts on a weekday get 22023
--     with a Spanish message. Closed to anon/PUBLIC.
--   * Every existing restaurant is seeded with TODAY'S split (Almuerzo
--     00:00–17:00, Cena 17:00–24:00): shift totals stay identical until
--     someone edits them. The daily figures DO move for orders placed after
--     midnight (04:00 cutoff): that is the business-day rule, not a bug.
--   * Until this is applied the app keeps today's behaviour (calendar day, the
--     17:00 split) and Configuración › Turnos says «falta aplicar la migración
--     054».
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_locations_id_company_uniq
  ON public.restaurant_locations (id, company_id);

CREATE TABLE IF NOT EXISTS public.restaurant_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  weekdays int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_shifts_restaurant_fk FOREIGN KEY (restaurant_id, company_id)
    REFERENCES public.restaurant_locations (id, company_id) ON DELETE CASCADE,
  CONSTRAINT restaurant_shifts_name_chk CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT restaurant_shifts_times_chk CHECK (start_time <> end_time),
  CONSTRAINT restaurant_shifts_weekdays_chk CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]
  )
);

CREATE INDEX IF NOT EXISTS restaurant_shifts_restaurant_idx
  ON public.restaurant_shifts (restaurant_id, sort_order);

ALTER TABLE public.restaurant_shifts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'restaurant_shifts' AND policyname = 'restaurant_shifts_member') THEN
    CREATE POLICY restaurant_shifts_member ON public.restaurant_shifts FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.restaurant_shifts TO authenticated, service_role;
REVOKE ALL ON TABLE public.restaurant_shifts FROM anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Do two shifts share any clock time? (a shift whose end is not after its start
-- crosses midnight; 24:00 is the end of the day.)
CREATE OR REPLACE FUNCTION public.restaurant_shift_overlap(
  s1 time, e1 time, s2 time, e2 time
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH m AS (
    SELECT
      (extract(epoch FROM s1) / 60)::int AS a_s,
      (extract(epoch FROM e1) / 60)::int AS a_e0,
      (extract(epoch FROM s2) / 60)::int AS b_s,
      (extract(epoch FROM e2) / 60)::int AS b_e0
  ), n AS (
    SELECT a_s,
           CASE WHEN a_e0 <= a_s THEN a_e0 + 1440 ELSE a_e0 END AS a_e,
           b_s,
           CASE WHEN b_e0 <= b_s THEN b_e0 + 1440 ELSE b_e0 END AS b_e
    FROM m
  )
  SELECT EXISTS (
    SELECT 1 FROM n, unnest(ARRAY[-1440, 0, 1440]) AS k
    WHERE n.a_s < n.b_e + k AND n.b_s + k < n.a_e
  ) FROM n
$$;

-- The business-day cutoff of a restaurant: the end of its last active shift
-- that crosses midnight (never later than 09:00, otherwise "unclear"), else
-- 04:00. Runs as the caller: through RLS when called directly.
CREATE OR REPLACE FUNCTION public.restaurant_business_day_cutoff(p_restaurant_id uuid)
RETURNS time
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT max(s.end_time)
      FROM public.restaurant_shifts s
      WHERE s.restaurant_id = p_restaurant_id
        AND s.active
        AND s.end_time < s.start_time
        AND s.end_time > time '00:00'
        AND s.end_time <= time '09:00'
    ),
    time '04:00'
  )
$$;

-- ---------------------------------------------------------------------------
-- restaurant_shifts_save: the whole set of shifts of one restaurant, one
-- transaction.
--   p_shifts = [{name, start_time 'HH:MM', end_time 'HH:MM', weekdays [1..7],
--                active}]   (1 = lunes … 7 = domingo)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_shifts_save(
  p_company_id uuid,
  p_restaurant_id uuid,
  p_shifts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  i int := 0;
  v_name text;
  v_start time;
  v_end time;
  v_days int[];
  v_active boolean;
  a record;
  b record;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_locations
    WHERE id = p_restaurant_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Ese restaurante no es de tu empresa.' USING ERRCODE = '22023';
  END IF;
  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR jsonb_array_length(p_shifts) > 12 THEN
    RAISE EXCEPTION 'Los turnos deben ser una lista de 12 como máximo.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _shifts_in (
    pos int, name text, s time, e time, days int[], active boolean
  ) ON COMMIT DROP;
  DELETE FROM _shifts_in;

  FOR r IN SELECT * FROM jsonb_array_elements(p_shifts) LOOP
    i := i + 1;
    v_name := btrim(coalesce(r->>'name', ''));
    IF length(v_name) = 0 OR length(v_name) > 40 THEN
      RAISE EXCEPTION 'Cada turno necesita un nombre (hasta 40 letras).' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_start := (r->>'start_time')::time;
      v_end := (r->>'end_time')::time;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'El turno «%» tiene una hora no válida.', v_name USING ERRCODE = '22023';
    END;
    IF v_start IS NULL OR v_end IS NULL OR v_start = v_end THEN
      RAISE EXCEPTION 'El turno «%» necesita una hora de inicio y otra de fin distintas.', v_name
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(r->'weekdays') = 'array' AND jsonb_array_length(r->'weekdays') > 0 THEN
      SELECT array_agg(DISTINCT x::int ORDER BY x::int) INTO v_days
      FROM jsonb_array_elements_text(r->'weekdays') x;
    ELSE
      v_days := ARRAY[1,2,3,4,5,6,7];
    END IF;
    IF NOT (v_days <@ ARRAY[1,2,3,4,5,6,7]) THEN
      RAISE EXCEPTION 'El turno «%» tiene un día de la semana no válido.', v_name USING ERRCODE = '22023';
    END IF;
    v_active := coalesce((r->>'active')::boolean, true);
    INSERT INTO _shifts_in VALUES (i, v_name, v_start, v_end, v_days, v_active);
  END LOOP;

  -- Active shifts may not overlap on the same weekday.
  FOR a IN SELECT * FROM _shifts_in WHERE active LOOP
    FOR b IN SELECT * FROM _shifts_in WHERE active AND pos > a.pos LOOP
      IF a.days && b.days
         AND public.restaurant_shift_overlap(a.s, a.e, b.s, b.e) THEN
        RAISE EXCEPTION 'Los turnos «%» y «%» se solapan el mismo día. Ajusta las horas.', a.name, b.name
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  DELETE FROM public.restaurant_shifts
  WHERE company_id = p_company_id AND restaurant_id = p_restaurant_id;
  INSERT INTO public.restaurant_shifts
    (company_id, restaurant_id, name, start_time, end_time, weekdays, active, sort_order)
  SELECT p_company_id, p_restaurant_id, name, s, e, days, active, pos FROM _shifts_in;

  RETURN jsonb_build_object(
    'saved', i,
    'cutoff', to_char(public.restaurant_business_day_cutoff(p_restaurant_id), 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restaurant_shifts_save(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_shifts_save(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.restaurant_shift_overlap(time, time, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_shift_overlap(time, time, time, time) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.restaurant_business_day_cutoff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_business_day_cutoff(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed: every existing restaurant gets today's split (idempotent)
-- ---------------------------------------------------------------------------

INSERT INTO public.restaurant_shifts
  (company_id, restaurant_id, name, start_time, end_time, weekdays, active, sort_order)
SELECT rl.company_id, rl.id, v.name, v.s, v.e, ARRAY[1,2,3,4,5,6,7], true, v.ord
FROM public.restaurant_locations rl
CROSS JOIN (VALUES
  ('Almuerzo', time '00:00', time '17:00', 1),
  ('Cena',     time '17:00', time '24:00', 2)
) AS v(name, s, e, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.restaurant_shifts z WHERE z.restaurant_id = rl.id
);

-- ---------------------------------------------------------------------------
-- Rollups, new versions: the business day replaces the calendar day
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

  WITH
  cut AS MATERIALIZED (
    SELECT rl.id, public.restaurant_business_day_cutoff(rl.id) AS cutoff
    FROM public.restaurant_locations rl
    WHERE rl.company_id = p_company_id
  ),
  lines AS (
    SELECT
      psi.id,
      psi.sale_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char(
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval,
            'YYYY-MM-DD')
        ELSE to_char(psi.sale_date, 'YYYY-MM-DD')
      END AS local_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(DOW FROM (
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval))::int
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
    LEFT JOIN cut ON cut.id = psi.location_id
    WHERE psi.company_id = p_company_id
      AND (p_location_id IS NULL OR psi.location_id = p_location_id)
      AND to_char(psi.sale_date, 'YYYY-MM-DD') ~ '^\d{4}-\d{2}-\d{2}$'
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
  'Company/location POS rollup for the cockpit. SECURITY DEFINER after is_company_member. sale_date is date. Safe to re-run this migration.';

REVOKE ALL ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_pos_rollup(uuid, uuid, text, text) TO authenticated, service_role;

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

  WITH
  cut AS MATERIALIZED (
    SELECT rl.id, public.restaurant_business_day_cutoff(rl.id) AS cutoff
    FROM public.restaurant_locations rl
    WHERE rl.company_id = p_company_id
  ),
  lines AS MATERIALIZED (
    SELECT
      psi.id,
      psi.sale_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char(
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval,
            'YYYY-MM-DD')
        ELSE to_char(psi.sale_date, 'YYYY-MM-DD')
      END AS local_date,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(DOW FROM (
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval))::int
        WHEN psi.sale_date IS NOT NULL THEN
          EXTRACT(DOW FROM psi.sale_date)::int
        ELSE NULL
      END AS local_weekday,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(HOUR FROM (psi.order_placed_at AT TIME ZONE tz))::int
        ELSE NULL
      END AS local_hour,
      psi.location_id AS location_id,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          (psi.order_placed_at AT TIME ZONE tz)::time
        ELSE NULL
      END AS clock_time,
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          EXTRACT(ISODOW FROM (
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval))::int
        WHEN psi.sale_date IS NOT NULL THEN
          EXTRACT(ISODOW FROM psi.sale_date)::int
        ELSE NULL
      END AS iso_weekday,
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
    LEFT JOIN cut ON cut.id = psi.location_id
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
      location_id,
      clock_time,
      iso_weekday,
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
  shift_lines AS (
    SELECT
      c.*,
      sh.name AS shift_name,
      sh.sort_order AS shift_order,
      EXISTS (
        SELECT 1 FROM public.restaurant_shifts z
        WHERE z.restaurant_id = c.location_id AND z.active
      ) AS has_shifts
    FROM classified c
    LEFT JOIN LATERAL (
      SELECT z.name, z.sort_order
      FROM public.restaurant_shifts z
      WHERE z.restaurant_id = c.location_id
        AND z.active
        AND c.iso_weekday = ANY (z.weekdays)
        AND c.clock_time IS NOT NULL
        AND (
          (z.start_time < z.end_time
            AND c.clock_time >= z.start_time AND c.clock_time < z.end_time)
          OR (z.start_time >= z.end_time
            AND (c.clock_time >= z.start_time OR c.clock_time < z.end_time))
        )
      ORDER BY z.sort_order, z.start_time
      LIMIT 1
    ) sh ON c.location_id IS NOT NULL
    WHERE NOT c.is_tip
  ),
  shift_totals AS (
    SELECT
      CASE WHEN shift_name IS NULL THEN 'Otro horario' ELSE shift_name END AS name,
      min(coalesce(shift_order, 2147483647)) AS sort_order,
      shift_name IS NULL AS is_other,
      round(sum(net)::numeric, 2) AS net_sales,
      count(DISTINCT order_key) FILTER (WHERE order_key IS NOT NULL)::int AS tickets,
      round(sum(units)::numeric, 3) AS units
    FROM shift_lines
    WHERE has_shifts AND clock_time IS NOT NULL
    GROUP BY 1, 3
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
    'shifts', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
          'name', st.name, 'other', st.is_other, 'net_sales', st.net_sales,
          'tickets', st.tickets, 'units', st.units) ORDER BY st.sort_order)
       FROM shift_totals st),
      '[]'::jsonb
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

REVOKE ALL ON FUNCTION public.sales_period_rollup(uuid, uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_period_rollup(uuid, uuid, text, text, date, date) TO authenticated, service_role;

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

  WITH
  cut AS MATERIALIZED (
    SELECT rl.id, public.restaurant_business_day_cutoff(rl.id) AS cutoff
    FROM public.restaurant_locations rl
    WHERE rl.company_id = p_company_id
  ),
  lines AS MATERIALIZED (
    SELECT
      CASE
        WHEN psi.order_placed_at IS NOT NULL THEN
          to_char(
            (psi.order_placed_at AT TIME ZONE tz)
              - coalesce(cut.cutoff, time '04:00')::interval,
            'YYYY-MM-DD')
        ELSE to_char(psi.sale_date, 'YYYY-MM-DD')
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
    LEFT JOIN cut ON cut.id = psi.location_id
    WHERE psi.company_id = p_company_id
      AND (p_location_id IS NULL OR psi.location_id = p_location_id)
      AND psi.sale_date IS NOT NULL
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

REVOKE ALL ON FUNCTION public.cockpit_product_day_rollup(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_product_day_rollup(uuid, uuid, text, text) TO authenticated, service_role;

-- Read-only checks (after applying):
--   select name, start_time, end_time, weekdays, active from public.restaurant_shifts where company_id = '<company uuid>' order by restaurant_id, sort_order;
--   select id, public.restaurant_business_day_cutoff(id) from public.restaurant_locations where company_id = '<company uuid>';
--   select has_function_privilege('anon', 'public.restaurant_shifts_save(uuid,uuid,jsonb)', 'execute');  -- must be false
