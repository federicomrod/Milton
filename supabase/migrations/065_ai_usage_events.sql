-- 065_ai_usage_events.sql
--
-- AI usage log: one row per OpenAI call (chat or transcription), written
-- server-side only. Lets Milton see cost, latency and quota/billing errors.
-- NO content columns: never prompts, answers, images, audio or keys.
--
-- DESIGN: Additive. One new company-scoped table with RLS
-- (public.is_company_member). Members can SELECT their own company's rows;
-- there is no insert/update/delete policy, so writes go through the service
-- role (admin client) only. company_id is nullable (some calls have no
-- company, e.g. an unauthenticated Telegram step); those rows are invisible
-- to members and visible to the service role.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton
-- Staging first; production only after Fede says yes.

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  company_id          uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature             text NOT NULL,
  model               text NOT NULL,
  input_tokens        integer NULL,
  cached_input_tokens integer NULL,
  output_tokens       integer NULL,
  audio_seconds       numeric NULL,
  -- NULL when the model has no price in lib/ai/prices.ts (never invented).
  est_cost_usd        numeric(12, 6) NULL,
  latency_ms          integer NULL,
  status              text NOT NULL
                      CHECK (status IN ('ok', 'error', 'fallback')),
  error_kind          text NULL
                      CHECK (error_kind IN ('quota', 'billing', 'rate_limit', 'timeout', 'bad_output', 'other')),
  error_code          text NULL
);

CREATE INDEX IF NOT EXISTS ai_usage_events_company_created_idx
  ON public.ai_usage_events (company_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx
  ON public.ai_usage_events (created_at);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_events_select ON public.ai_usage_events;
CREATE POLICY ai_usage_events_select ON public.ai_usage_events
  FOR SELECT
  USING (company_id IS NOT NULL AND public.is_company_member(company_id));
