-- 082_app_activity_tracking.sql
--
-- Track when users open the phone app (last-seen ping) for Los Ranchos adoption
-- metrics. One row per (user, company, surface) combination, updated at most
-- once every 15 minutes (throttled client-side). ADDITIVE ONLY: nothing dropped.
--
--   app_activity   Records user_id, company_id, surface (gestion/cocina),
--                  platform (ios/android/web) and last_seen_at. Updated via
--                  PUT /api/mobile/v1/activity when the app comes to foreground.
--                  RLS: users can only read/write their own rows.
--
-- NOT automatically applied: this SQL must be pasted manually into Supabase SQL
-- Editor by someone with staging access after Fede approves. Staging first, then
-- production.

CREATE TABLE IF NOT EXISTS public.app_activity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface           text NOT NULL CHECK (surface IN ('gestion', 'cocina', 'web')),
  platform          text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, surface)
);

CREATE INDEX IF NOT EXISTS app_activity_company_user_idx
  ON public.app_activity (company_id, user_id);

CREATE INDEX IF NOT EXISTS app_activity_last_seen_idx
  ON public.app_activity (last_seen_at DESC);

ALTER TABLE public.app_activity ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'app_activity' AND policyname = 'app_activity_own_select') THEN
    CREATE POLICY app_activity_own_select ON public.app_activity
      FOR SELECT USING (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'app_activity' AND policyname = 'app_activity_own_insert') THEN
    CREATE POLICY app_activity_own_insert ON public.app_activity
      FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'app_activity' AND policyname = 'app_activity_own_update') THEN
    CREATE POLICY app_activity_own_update ON public.app_activity
      FOR UPDATE USING (user_id = auth.uid() AND public.is_company_member(company_id))
      WITH CHECK (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
END $$;

-- Grants: signed-in users can manage their own rows (RLS above); service role has full access.
REVOKE ALL ON TABLE public.app_activity FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_activity TO authenticated, service_role;

COMMENT ON TABLE public.app_activity IS
  'Last-seen ping from phone app (gestion/cocina) and web. Updated when app comes to foreground, throttled to 15 min client-side. Each user sees only their own rows.';

-- ---------------------------------------------------------------------------
-- Read-only view for weekly per-user last-seen report (web vs app usage)
-- Put it in the reporting schema so PostgREST doesn't serve it.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE VIEW reporting.user_last_seen_report AS
SELECT
  u.id AS user_id,
  u.email,
  cm.company_id,
  c.name AS company_name,
  cm.role,
  u.last_sign_in_at AS web_last_sign_in,
  aa_gestion.last_seen_at AS gestion_last_seen,
  aa_gestion.platform AS gestion_platform,
  aa_cocina.last_seen_at AS cocina_last_seen,
  aa_cocina.platform AS cocina_platform
FROM auth.users u
INNER JOIN public.company_memberships cm ON u.id = cm.user_id
INNER JOIN public.companies c ON cm.company_id = c.id
LEFT JOIN public.app_activity aa_gestion
  ON u.id = aa_gestion.user_id
  AND cm.company_id = aa_gestion.company_id
  AND aa_gestion.surface = 'gestion'
LEFT JOIN public.app_activity aa_cocina
  ON u.id = aa_cocina.user_id
  AND cm.company_id = aa_cocina.company_id
  AND aa_cocina.surface = 'cocina';

-- Only service role can read the report (for Sofia's Friday review).
-- PostgREST doesn't expose the reporting schema, so anon and authenticated
-- cannot reach it through the API.
REVOKE ALL ON reporting.user_last_seen_report FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON reporting.user_last_seen_report TO service_role;

COMMENT ON VIEW reporting.user_last_seen_report IS
  'Weekly per-user last-seen report: web sign-in date plus last app open per surface (gestion/cocina). Service role only.';
