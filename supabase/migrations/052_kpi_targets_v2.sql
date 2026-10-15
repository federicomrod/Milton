-- 052_kpi_targets_v2.sql
--
-- R1-16a (Cockpit v2 + Objetivos, phase 1). The goals a restaurant sets
-- (monthly sales, food cost %, gross margin %, average ticket) live in the
-- EXISTING table restaurant_kpi_targets; no new table for them.
--
-- WHAT CHANGES (all additive; no row is deleted, no value rewritten)
--   * metric_key also allows food_cost_pct and gross_margin_pct (the four
--     existing keys keep working).
--   * target_period also allows monthly (daily keeps working).
--   * location_id (null = the whole company) -> restaurant_locations, same
--     company (composite FK through a new unique index on locations).
--   * effective_from date: a target applies from that day on; the months
--     before keep the target they had. Existing rows are backfilled to
--     1900-01-01 so they stay valid for ALL history; new rows default to
--     today.
--   * weekday_weights jsonb: 7 numbers (Mon..Sun) that sum to 1; null = flat.
--   * the unique key becomes (company, location, metric, period,
--     effective_from) with NULL location treated as ONE value
--     (NULLS NOT DISTINCT, PostgreSQL 15+).
--   * restaurant_company_settings: one row per company; today it only holds
--     the default "Comparar con" of the Cockpit.
--   * kpi_targets_save(): saves a whole Objetivos form (rows + weekday split
--     + default comparison) in ONE transaction.
--
-- SAFETY
--   * RLS of restaurant_kpi_targets is unchanged (is_company_member). The new
--     table has the same policy; its anon grant is revoked.
--   * kpi_targets_save is SECURITY INVOKER (every statement runs through the
--     caller's RLS); a non-member gets 42501; closed to anon/PUBLIC.
--   * Until this is applied Objetivos says "falta aplicar la migración 052"
--     and the Cockpit works without targets.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_kpi_targets
  ADD COLUMN IF NOT EXISTS location_id uuid NULL,
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '1900-01-01',
  ADD COLUMN IF NOT EXISTS weekday_weights jsonb NULL;

-- Existing rows now carry 1900-01-01 (valid for all history); from here on a
-- new row defaults to today.
ALTER TABLE public.restaurant_kpi_targets
  ALTER COLUMN effective_from SET DEFAULT current_date;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_metric_chk;
ALTER TABLE public.restaurant_kpi_targets
  ADD CONSTRAINT restaurant_kpi_targets_metric_chk CHECK (
    metric_key IN ('revenue', 'orders', 'units_sold', 'avg_ticket',
                   'food_cost_pct', 'gross_margin_pct')
  );

ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_period_chk;
ALTER TABLE public.restaurant_kpi_targets
  ADD CONSTRAINT restaurant_kpi_targets_period_chk CHECK (
    target_period IN ('daily', 'monthly')
  );

-- 7 numbers >= 0 that sum to 1 (within a rounding hair), or NULL.
CREATE OR REPLACE FUNCTION public.kpi_weekday_weights_ok(w jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT w IS NULL OR (
    jsonb_typeof(w) = 'array'
    AND jsonb_array_length(w) = 7
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(w) e
      WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}')::numeric < 0
    )
    AND abs((SELECT sum((e #>> '{}')::numeric) FROM jsonb_array_elements(w) e) - 1) <= 0.001
  )
$$;

ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_weights_chk;
ALTER TABLE public.restaurant_kpi_targets
  ADD CONSTRAINT restaurant_kpi_targets_weights_chk
  CHECK (public.kpi_weekday_weights_ok(weekday_weights));

-- ---------------------------------------------------------------------------
-- A restaurant of the SAME company
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_locations_id_company_uniq
  ON public.restaurant_locations (id, company_id);

ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_location_fk;
ALTER TABLE public.restaurant_kpi_targets
  ADD CONSTRAINT restaurant_kpi_targets_location_fk
  FOREIGN KEY (location_id, company_id)
  REFERENCES public.restaurant_locations (id, company_id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- The key: one target per company, restaurant (or whole company), metric,
-- period and start date.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_uniq;
ALTER TABLE public.restaurant_kpi_targets
  DROP CONSTRAINT IF EXISTS restaurant_kpi_targets_uniq_v2;
ALTER TABLE public.restaurant_kpi_targets
  ADD CONSTRAINT restaurant_kpi_targets_uniq_v2
  UNIQUE NULLS NOT DISTINCT (company_id, location_id, metric_key, target_period, effective_from);

CREATE INDEX IF NOT EXISTS restaurant_kpi_targets_lookup_idx
  ON public.restaurant_kpi_targets (company_id, metric_key, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Company settings: the default "Comparar con" of the Cockpit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_company_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_comparison text NOT NULL DEFAULT 'months_6',
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_company_settings_comparison_chk CHECK (
    default_comparison IN ('last_week', 'last_month', 'months_3', 'months_6', 'months_12')
  )
);

ALTER TABLE public.restaurant_company_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'restaurant_company_settings'
      AND policyname = 'restaurant_company_settings_member') THEN
    CREATE POLICY restaurant_company_settings_member
      ON public.restaurant_company_settings FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.restaurant_company_settings TO authenticated, service_role;
REVOKE ALL ON TABLE public.restaurant_company_settings FROM anon;

-- ---------------------------------------------------------------------------
-- kpi_targets_save: the whole form, one transaction
--
--   p_rows = [{metric_key, target_period, target_value | null}]
--     a value upserts the row at (company, location, metric, period,
--     effective_from); null writes an INACTIVE row from that day on ("no
--     target from here"), so the lookup finds a clear stop, never a 0.
--   p_weekday_weights: 7 numbers (sum 1) for the monthly revenue row, or null.
--   p_default_comparison: stored on the company settings, or null to leave it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kpi_targets_save(
  p_company_id uuid,
  p_location_id uuid,
  p_effective_from date,
  p_rows jsonb,
  p_weekday_weights jsonb DEFAULT NULL,
  p_default_comparison text DEFAULT NULL,
  p_currency text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_metric text;
  v_period text;
  v_value numeric;
  v_saved integer := 0;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'effective_from is required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 20 THEN
    RAISE EXCEPTION 'rows must be an array of at most 20 targets' USING ERRCODE = '22023';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_locations
    WHERE id = p_location_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'unknown restaurant for this company' USING ERRCODE = '22023';
  END IF;
  IF NOT public.kpi_weekday_weights_ok(p_weekday_weights) THEN
    RAISE EXCEPTION 'weekday weights must be 7 numbers that sum to 1' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_metric := r->>'metric_key';
    v_period := r->>'target_period';
    IF jsonb_typeof(r->'target_value') = 'number' THEN
      v_value := (r->>'target_value')::numeric;
      IF v_value < 0 THEN
        RAISE EXCEPTION 'a target cannot be negative' USING ERRCODE = '22023';
      END IF;
    ELSE
      v_value := NULL;
    END IF;

    INSERT INTO public.restaurant_kpi_targets (
      company_id, location_id, metric_key, target_period, effective_from,
      target_value, currency, is_active, weekday_weights
    ) VALUES (
      p_company_id, p_location_id, v_metric, v_period, p_effective_from,
      COALESCE(v_value, 0), COALESCE(p_currency, 'USD'), v_value IS NOT NULL,
      CASE WHEN v_metric = 'revenue' AND v_period = 'monthly' AND v_value IS NOT NULL
           THEN p_weekday_weights ELSE NULL END
    )
    ON CONFLICT (company_id, location_id, metric_key, target_period, effective_from)
    DO UPDATE SET
      target_value = EXCLUDED.target_value,
      is_active = EXCLUDED.is_active,
      weekday_weights = EXCLUDED.weekday_weights,
      currency = EXCLUDED.currency,
      updated_at = now();
    v_saved := v_saved + 1;
  END LOOP;

  IF p_default_comparison IS NOT NULL THEN
    INSERT INTO public.restaurant_company_settings (company_id, default_comparison, updated_by)
    VALUES (p_company_id, p_default_comparison, auth.uid())
    ON CONFLICT (company_id) DO UPDATE SET
      default_comparison = EXCLUDED.default_comparison,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('saved', v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_targets_save(uuid, uuid, date, jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kpi_targets_save(uuid, uuid, date, jsonb, jsonb, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.kpi_weekday_weights_ok(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kpi_weekday_weights_ok(jsonb) TO authenticated, service_role;

-- Read-only checks (after applying):
--   select count(*) as rows, count(*) filter (where effective_from = date '1900-01-01') as old_rows
--   from public.restaurant_kpi_targets where company_id = '<company uuid>';
--   select metric_key, target_period, location_id, effective_from, target_value, is_active
--   from public.restaurant_kpi_targets where company_id = '<company uuid>' order by 1, 2, 4;
--   select has_function_privilege('anon', 'public.kpi_targets_save(uuid,uuid,date,jsonb,jsonb,text,text)', 'execute');  -- must be false
