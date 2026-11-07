-- 081_push_notifications.sql
--
-- Native notifications for the manager app (daily summary + critical alerts).
-- ADDITIVE ONLY: two new tables, their indexes, RLS policies and grants.
-- Nothing existing is dropped, renamed or made stricter.
--
--   push_devices   one row per signed-in manager phone: the Expo push token and
--                  that person's choices (categories, quiet hours, timezone).
--                  A manager reads / writes ONLY their own rows (RLS, user_id =
--                  auth.uid() and company member).
--   push_sends     the log that prevents duplicates and enforces the daily cap.
--                  RLS on and NO policy: service role only. dedupe_key is
--                  unique, so the same notification can never be recorded twice.
--
-- NOT sent from here: sending is OFF until PUSH_ENABLED=1 is set on the server
-- and APNs credentials exist (a hosted step that needs approval). Nothing in
-- this file schedules anything.
--
-- IMPORTANT: Supabase migrations are not applied from the repo by CI. This SQL
-- must be pasted manually into the Supabase SQL Editor by someone with staging
-- access. Staging first; production only after Fede says yes.

CREATE TABLE IF NOT EXISTS public.push_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  expo_token        text NOT NULL,
  platform          text NOT NULL CHECK (platform IN ('ios', 'android')),
  timezone          text NOT NULL DEFAULT 'UTC',
  language          text NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en', 'de')),
  daily_enabled     boolean NOT NULL DEFAULT true,
  critical_enabled  boolean NOT NULL DEFAULT true,
  -- Local hours 0-23. Quiet hours may wrap midnight (22 -> 7).
  daily_hour        smallint NOT NULL DEFAULT 8  CHECK (daily_hour BETWEEN 0 AND 23),
  quiet_start       smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end         smallint NOT NULL DEFAULT 7  CHECK (quiet_end BETWEEN 0 AND 23),
  disabled_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expo_token)
);

CREATE INDEX IF NOT EXISTS push_devices_company_user_idx
  ON public.push_devices (company_id, user_id);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'push_devices' AND policyname = 'push_devices_own_select') THEN
    CREATE POLICY push_devices_own_select ON public.push_devices
      FOR SELECT USING (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'push_devices' AND policyname = 'push_devices_own_insert') THEN
    CREATE POLICY push_devices_own_insert ON public.push_devices
      FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'push_devices' AND policyname = 'push_devices_own_update') THEN
    CREATE POLICY push_devices_own_update ON public.push_devices
      FOR UPDATE USING (user_id = auth.uid() AND public.is_company_member(company_id))
      WITH CHECK (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'push_devices' AND policyname = 'push_devices_own_delete') THEN
    CREATE POLICY push_devices_own_delete ON public.push_devices
      FOR DELETE USING (user_id = auth.uid() AND public.is_company_member(company_id));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.push_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  category    text NOT NULL CHECK (category IN ('daily', 'critical')),
  kind        text NOT NULL,
  dedupe_key  text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS push_sends_user_day_idx
  ON public.push_sends (user_id, created_at);

ALTER TABLE public.push_sends ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy: only the service role reads or writes the send log.

-- ---------------------------------------------------------------------------
-- Grants (least privilege; no TRUNCATE / TRIGGER / REFERENCES / MAINTAIN for
-- app roles). RLS still applies to `authenticated`.
-- ---------------------------------------------------------------------------

-- push_devices: a signed-in manager manages their own rows (RLS above); the
-- service role reads devices to send and removes dead tokens / reassigns a
-- phone. `anon` gets nothing.
REVOKE ALL ON TABLE public.push_devices FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_devices
  TO authenticated, service_role;

-- push_sends: the send log is service-role only. Neither `anon` nor
-- `authenticated` can read or write it, with or without a policy.
REVOKE ALL ON TABLE public.push_sends FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.push_sends TO service_role;

COMMENT ON TABLE public.push_devices IS
  'Expo push token and notification choices of a signed-in manager phone. Each manager sees only their own rows.';
COMMENT ON TABLE public.push_sends IS
  'Send log: unique dedupe_key prevents duplicates; used for the daily cap. Service role only.';
