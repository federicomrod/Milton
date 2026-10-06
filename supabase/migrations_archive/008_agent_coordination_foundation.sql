-- 008_agent_coordination_foundation.sql
--
-- Foundational schema for Milton's restaurant agent coordination model.
-- No agents actually run yet — this migration only lays the tables, RLS,
-- indexes and seed catalog so the UI/runner work can follow.
--
-- ===========================================================================
-- DEV RESET NOTE
-- ===========================================================================
-- This file intentionally DROPs the five legacy agent tables (if they
-- exist) before recreating them. The previous schema used a
-- agent_configs.agent_definition_id UUID FK, which is incompatible with
-- this milestone's text-key model (agent_configs.agent_key → agent_definitions.agent_key).
--
-- We are NOT preserving any legacy agent data — per the milestone brief
-- there is no production agent activity yet. ONLY agent_* tables are
-- touched; no other schema is affected.
--
-- All statements below are idempotent (IF EXISTS / IF NOT EXISTS) so the
-- migration is safe to re-run.
--
-- IMPORTANT: paste this file into the Supabase SQL Editor and run it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Step 0: drop legacy / mismatched agent tables in reverse FK order.
--
-- CASCADE protects us from any incidental FKs we don't know about (e.g.
-- the legacy agent_configs referencing agent_definitions via UUID).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.agent_recommendation_events CASCADE;
DROP TABLE IF EXISTS public.agent_recommendations       CASCADE;
DROP TABLE IF EXISTS public.agent_runs                  CASCADE;
DROP TABLE IF EXISTS public.agent_configs               CASCADE;
DROP TABLE IF EXISTS public.agent_definitions           CASCADE;

-- ===========================================================================
-- A. agent_definitions  (global catalog)
-- ===========================================================================
CREATE TABLE public.agent_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key       text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text NOT NULL,
  category        text NOT NULL,
  is_available    boolean NOT NULL DEFAULT true,
  is_coming_soon  boolean NOT NULL DEFAULT false,
  default_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_definitions_category_chk
    CHECK (category IN ('sales','margin','supplier','invoice','inventory','finance','menu'))
);

-- ===========================================================================
-- B. agent_configs  (per-company)
-- ===========================================================================
CREATE TABLE public.agent_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_key      text NOT NULL REFERENCES public.agent_definitions(agent_key) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  run_frequency  text NOT NULL DEFAULT 'manual',
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_configs_unique UNIQUE (company_id, agent_key),
  CONSTRAINT agent_configs_run_frequency_chk
    CHECK (run_frequency IN ('manual','daily','weekly'))
);

CREATE INDEX idx_agent_configs_company_agent
  ON public.agent_configs (company_id, agent_key);

-- ===========================================================================
-- C. agent_runs  (execution history)
-- ===========================================================================
CREATE TABLE public.agent_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_key             text NOT NULL REFERENCES public.agent_definitions(agent_key) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'queued',
  triggered_by          text NOT NULL DEFAULT 'manual',
  triggered_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  findings_count        integer NOT NULL DEFAULT 0,
  summary               text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_status_chk
    CHECK (status IN ('queued','running','completed','failed')),
  CONSTRAINT agent_runs_triggered_by_chk
    CHECK (triggered_by IN ('manual','schedule','system','api')),
  CONSTRAINT agent_runs_findings_count_chk
    CHECK (findings_count >= 0)
);

CREATE INDEX idx_agent_runs_company_agent_started
  ON public.agent_runs (company_id, agent_key, started_at DESC);
CREATE INDEX idx_agent_runs_company_status
  ON public.agent_runs (company_id, status);

-- ===========================================================================
-- D. agent_recommendations  (inbox)
-- ===========================================================================
CREATE TABLE public.agent_recommendations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_key            text NOT NULL REFERENCES public.agent_definitions(agent_key) ON DELETE CASCADE,
  agent_run_id         uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  title                text NOT NULL,
  description          text NOT NULL,
  severity             text NOT NULL DEFAULT 'info',
  recommendation_type  text NOT NULL,
  related_entity_type  text,
  related_entity_id    uuid,
  suggested_action     text,
  status               text NOT NULL DEFAULT 'open',
  impact_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_recommendations_severity_chk
    CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT agent_recommendations_status_chk
    CHECK (status IN ('open','approved','dismissed','resolved','snoozed'))
);

CREATE INDEX idx_agent_recos_company_status_severity
  ON public.agent_recommendations (company_id, status, severity);
CREATE INDEX idx_agent_recos_company_agent_created
  ON public.agent_recommendations (company_id, agent_key, created_at DESC);
CREATE INDEX idx_agent_recos_company_entity
  ON public.agent_recommendations (company_id, related_entity_type, related_entity_id);

-- ===========================================================================
-- E. agent_recommendation_events  (audit trail)
-- ===========================================================================
CREATE TABLE public.agent_recommendation_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recommendation_id   uuid NOT NULL REFERENCES public.agent_recommendations(id) ON DELETE CASCADE,
  event_type          text NOT NULL,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note                text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_recommendation_events_event_chk
    CHECK (event_type IN (
      'created','approved','dismissed','resolved','snoozed','reopened','note_added'
    ))
);

CREATE INDEX idx_agent_reco_events_company_reco_created
  ON public.agent_recommendation_events (company_id, recommendation_id, created_at DESC);

-- ===========================================================================
-- updated_at triggers
--
-- We only attach the trigger when the helper exists in this database. The
-- helper is owned by an earlier migration; if it isn't present, the
-- triggers are silently skipped.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_agent_definitions_updated_at ON public.agent_definitions;
    CREATE TRIGGER trg_agent_definitions_updated_at
      BEFORE UPDATE ON public.agent_definitions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_agent_configs_updated_at ON public.agent_configs;
    CREATE TRIGGER trg_agent_configs_updated_at
      BEFORE UPDATE ON public.agent_configs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_agent_recommendations_updated_at ON public.agent_recommendations;
    CREATE TRIGGER trg_agent_recommendations_updated_at
      BEFORE UPDATE ON public.agent_recommendations
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
ALTER TABLE public.agent_definitions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_recommendations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_recommendation_events   ENABLE ROW LEVEL SECURITY;

-- agent_definitions: every authenticated user can read; writes are
-- restricted to the service role (which bypasses RLS) so app users can't
-- mutate the catalog.
DROP POLICY IF EXISTS agent_definitions_select ON public.agent_definitions;
CREATE POLICY agent_definitions_select ON public.agent_definitions
  FOR SELECT TO authenticated USING (true);

-- agent_configs: per-company CRUD.
DROP POLICY IF EXISTS agent_configs_select ON public.agent_configs;
CREATE POLICY agent_configs_select ON public.agent_configs
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_configs_insert ON public.agent_configs;
CREATE POLICY agent_configs_insert ON public.agent_configs
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_configs_update ON public.agent_configs;
CREATE POLICY agent_configs_update ON public.agent_configs
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_configs_delete ON public.agent_configs;
CREATE POLICY agent_configs_delete ON public.agent_configs
  FOR DELETE USING (public.is_company_member(company_id));

-- agent_runs: per-company CRUD.
DROP POLICY IF EXISTS agent_runs_select ON public.agent_runs;
CREATE POLICY agent_runs_select ON public.agent_runs
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_runs_insert ON public.agent_runs;
CREATE POLICY agent_runs_insert ON public.agent_runs
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_runs_update ON public.agent_runs;
CREATE POLICY agent_runs_update ON public.agent_runs
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_runs_delete ON public.agent_runs;
CREATE POLICY agent_runs_delete ON public.agent_runs
  FOR DELETE USING (public.is_company_member(company_id));

-- agent_recommendations: per-company CRUD.
DROP POLICY IF EXISTS agent_recommendations_select ON public.agent_recommendations;
CREATE POLICY agent_recommendations_select ON public.agent_recommendations
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_recommendations_insert ON public.agent_recommendations;
CREATE POLICY agent_recommendations_insert ON public.agent_recommendations
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_recommendations_update ON public.agent_recommendations;
CREATE POLICY agent_recommendations_update ON public.agent_recommendations
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_recommendations_delete ON public.agent_recommendations;
CREATE POLICY agent_recommendations_delete ON public.agent_recommendations
  FOR DELETE USING (public.is_company_member(company_id));

-- agent_recommendation_events: per-company CRUD.
DROP POLICY IF EXISTS agent_reco_events_select ON public.agent_recommendation_events;
CREATE POLICY agent_reco_events_select ON public.agent_recommendation_events
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_reco_events_insert ON public.agent_recommendation_events;
CREATE POLICY agent_reco_events_insert ON public.agent_recommendation_events
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_reco_events_update ON public.agent_recommendation_events;
CREATE POLICY agent_reco_events_update ON public.agent_recommendation_events
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_reco_events_delete ON public.agent_recommendation_events;
CREATE POLICY agent_reco_events_delete ON public.agent_recommendation_events
  FOR DELETE USING (public.is_company_member(company_id));

-- ===========================================================================
-- Seed agent_definitions  (idempotent via ON CONFLICT)
-- ===========================================================================
INSERT INTO public.agent_definitions
  (agent_key, name, description, category, is_available, is_coming_soon, default_config)
VALUES
  ('pos_agent',
   'POS Agent',
   'Monitors revenue, orders, item sales, channel mix and average ticket.',
   'sales', true, false,
   '{"revenue_drop_threshold_pct": 15, "channel_shift_threshold_pct": 20, "low_volume_item_units": 5}'::jsonb),

  ('recipe_margin_agent',
   'Recipe & Margin Agent',
   'Monitors missing recipes, costing blockers, low-margin items and food cost risks.',
   'margin', true, false,
   '{"low_margin_threshold_pct": 60, "high_food_cost_threshold_pct": 35, "high_revenue_missing_recipe_threshold": 5000}'::jsonb),

  ('supplier_agent',
   'Supplier Agent',
   'Monitors supplier price increases, supplier concentration and missing supplier information.',
   'supplier', true, false,
   '{"price_increase_threshold_pct": 10, "supplier_concentration_threshold_pct": 40, "lookback_days": 90}'::jsonb),

  ('invoice_agent',
   'Invoice Agent',
   'Will read supplier invoices, extract line items and update ingredient cost history.',
   'invoice', false, true,
   '{}'::jsonb),

  ('inventory_agent',
   'Inventory Agent',
   'Will monitor stock, expiry, waste risk and reorder needs.',
   'inventory', false, true,
   '{}'::jsonb),

  ('finance_agent',
   'Finance Agent',
   'Will summarize profitability, cash impact and cost anomalies.',
   'finance', false, true,
   '{}'::jsonb),

  ('menu_agent',
   'Menu Agent',
   'Will recommend pricing, promotions and menu changes.',
   'menu', false, true,
   '{}'::jsonb)
ON CONFLICT (agent_key) DO UPDATE
  SET name           = EXCLUDED.name,
      description    = EXCLUDED.description,
      category       = EXCLUDED.category,
      is_available   = EXCLUDED.is_available,
      is_coming_soon = EXCLUDED.is_coming_soon,
      default_config = EXCLUDED.default_config,
      updated_at     = now();
