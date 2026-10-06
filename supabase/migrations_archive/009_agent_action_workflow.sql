-- 009_agent_action_workflow.sql
--
-- Stage-1 foundation for Milton's Agent Action Workflow.
--
--   agent_actions          — concrete action proposals derived from
--                            agent_recommendations. Each action carries the
--                            full decision lifecycle (proposed → approved →
--                            assigned → executed → verified, plus reject /
--                            cancel side-branches).
--   agent_action_events    — immutable audit trail for every status change
--                            and note on an agent_actions row.
--
-- IMPORTANT — manual application:
--   This SQL must be pasted into the Supabase SQL Editor and executed there
--   (repo CI does not apply migrations automatically). All statements use
--   IF NOT EXISTS / DROP-IF-EXISTS so the file is safe to re-run.
--
-- Product invariants enforced here:
--   * Tenancy via company_id + RLS using public.is_company_member(...).
--   * Decision history is preserved: there is no auto-pruning of rejected,
--     cancelled, executed, or verified rows. Product UI should hide via
--     filters, not delete.
--   * Status enums are CHECK-constrained, but transitions live in the API
--     layer so we can evolve them without a migration.

-- ===========================================================================
-- A. agent_actions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recommendation_id        uuid REFERENCES public.agent_recommendations(id) ON DELETE SET NULL,
  agent_key                text NOT NULL REFERENCES public.agent_definitions(agent_key) ON DELETE CASCADE,
  action_type              text NOT NULL,
  title                    text NOT NULL,
  description              text,
  status                   text NOT NULL DEFAULT 'proposed',
  priority                 text NOT NULL DEFAULT 'medium',
  related_entity_type      text,
  related_entity_id        uuid,
  payload_json             jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact_json              jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date                 date,
  proposed_by              text NOT NULL DEFAULT 'agent',
  created_by_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at              timestamptz,
  rejected_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at              timestamptz,
  executed_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_at              timestamptz,
  verified_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at              timestamptz,
  cancelled_by_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at             timestamptz,
  outcome_notes            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_actions_action_type_chk
    CHECK (action_type IN (
      'open_related_record',
      'create_setup_task',
      'suggest_price_change',
      'draft_supplier_message',
      'review_supplier',
      'review_recipe',
      'mark_reviewed'
    )),
  CONSTRAINT agent_actions_status_chk
    CHECK (status IN (
      'proposed',
      'approved',
      'rejected',
      'assigned',
      'executed',
      'verified',
      'cancelled'
    )),
  CONSTRAINT agent_actions_priority_chk
    CHECK (priority IN ('low','medium','high','critical')),
  CONSTRAINT agent_actions_proposed_by_chk
    CHECK (proposed_by IN ('agent','user','system'))
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_company_status_priority
  ON public.agent_actions (company_id, status, priority);

CREATE INDEX IF NOT EXISTS idx_agent_actions_company_recommendation
  ON public.agent_actions (company_id, recommendation_id);

CREATE INDEX IF NOT EXISTS idx_agent_actions_company_agent_created
  ON public.agent_actions (company_id, agent_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_company_entity
  ON public.agent_actions (company_id, related_entity_type, related_entity_id);

-- ===========================================================================
-- B. agent_action_events
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.agent_action_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action_id       uuid NOT NULL REFERENCES public.agent_actions(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note            text,
  previous_status text,
  new_status      text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_action_events_event_type_chk
    CHECK (event_type IN (
      'created',
      'approved',
      'rejected',
      'assigned',
      'executed',
      'verified',
      'cancelled',
      'reopened',
      'note_added',
      'payload_updated'
    ))
);

CREATE INDEX IF NOT EXISTS idx_agent_action_events_company_action_created
  ON public.agent_action_events (company_id, action_id, created_at DESC);

-- ===========================================================================
-- updated_at trigger (only if helper exists)
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_agent_actions_updated_at ON public.agent_actions;
    CREATE TRIGGER trg_agent_actions_updated_at
      BEFORE UPDATE ON public.agent_actions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
ALTER TABLE public.agent_actions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_action_events ENABLE ROW LEVEL SECURITY;

-- agent_actions: per-company CRUD.
DROP POLICY IF EXISTS agent_actions_select ON public.agent_actions;
CREATE POLICY agent_actions_select ON public.agent_actions
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_actions_insert ON public.agent_actions;
CREATE POLICY agent_actions_insert ON public.agent_actions
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_actions_update ON public.agent_actions;
CREATE POLICY agent_actions_update ON public.agent_actions
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_actions_delete ON public.agent_actions;
CREATE POLICY agent_actions_delete ON public.agent_actions
  FOR DELETE USING (public.is_company_member(company_id));

-- agent_action_events: per-company CRUD.
-- NOTE: while we DON'T expose deletion in the product UI, the policy
-- allows it for parity with sibling agent_* tables. Product code never
-- DELETEs from these tables — decision history is preserved.
DROP POLICY IF EXISTS agent_action_events_select ON public.agent_action_events;
CREATE POLICY agent_action_events_select ON public.agent_action_events
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_action_events_insert ON public.agent_action_events;
CREATE POLICY agent_action_events_insert ON public.agent_action_events
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_action_events_update ON public.agent_action_events;
CREATE POLICY agent_action_events_update ON public.agent_action_events
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS agent_action_events_delete ON public.agent_action_events;
CREATE POLICY agent_action_events_delete ON public.agent_action_events
  FOR DELETE USING (public.is_company_member(company_id));
