-- 003_create_restaurant_kpi_targets.sql
--
-- First-version daily KPI targets for the restaurant cockpit.
-- The dashboard multiplies the daily target by the number of selected days
-- to produce a window target (avg_ticket is the exception — see notes in
-- components/restaurant/RestaurantSalesExplorer.tsx).
--
-- Granularity:
--   * One row per (company_id, metric_key, target_period).
--   * target_period is hard-coded to 'daily' for now; the column is included
--     so we can add weekly/monthly granularities later without an ALTER.
--
-- IMPORTANT: this file lives in the repo for history. Supabase migrations
-- are not yet applied from the repo by CI, so the SQL below must also be
-- pasted manually into the Supabase SQL Editor (see the task report).

CREATE TABLE IF NOT EXISTS public.restaurant_kpi_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key      text NOT NULL,
  target_value    numeric(14,4) NOT NULL,
  target_period   text NOT NULL DEFAULT 'daily',
  currency        text DEFAULT 'MXN',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT restaurant_kpi_targets_metric_chk
    CHECK (metric_key IN ('revenue', 'orders', 'units_sold', 'avg_ticket')),
  CONSTRAINT restaurant_kpi_targets_period_chk
    CHECK (target_period IN ('daily')),
  CONSTRAINT restaurant_kpi_targets_value_chk
    CHECK (target_value >= 0),

  -- One target per (company, metric, period). Lets the dashboard upsert
  -- safely from the editor UI without a separate "delete previous" step.
  CONSTRAINT restaurant_kpi_targets_uniq
    UNIQUE (company_id, metric_key, target_period)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_kpi_targets_company
  ON public.restaurant_kpi_targets(company_id);

-- updated_at trigger (no-op if set_updated_at() isn't defined — wrapped
-- in a DO block so the migration is idempotent and survives a missing
-- helper function).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_restaurant_kpi_targets_updated_at
      ON public.restaurant_kpi_targets;
    CREATE TRIGGER trg_restaurant_kpi_targets_updated_at
      BEFORE UPDATE ON public.restaurant_kpi_targets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

-- Row Level Security: every write/read must be scoped to a company the
-- authenticated user belongs to. We assume the existing helper
-- `public.is_company_member(uuid)` is in place (used by other restaurant
-- tables). If it isn't, replace each USING/WITH CHECK predicate with the
-- inline equivalent: `company_id IN (SELECT company_id FROM company_memberships WHERE user_id = auth.uid())`.
ALTER TABLE public.restaurant_kpi_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_kpi_targets_select ON public.restaurant_kpi_targets;
CREATE POLICY restaurant_kpi_targets_select
  ON public.restaurant_kpi_targets
  FOR SELECT
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_kpi_targets_insert ON public.restaurant_kpi_targets;
CREATE POLICY restaurant_kpi_targets_insert
  ON public.restaurant_kpi_targets
  FOR INSERT
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_kpi_targets_update ON public.restaurant_kpi_targets;
CREATE POLICY restaurant_kpi_targets_update
  ON public.restaurant_kpi_targets
  FOR UPDATE
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_kpi_targets_delete ON public.restaurant_kpi_targets;
CREATE POLICY restaurant_kpi_targets_delete
  ON public.restaurant_kpi_targets
  FOR DELETE
  USING (public.is_company_member(company_id));
