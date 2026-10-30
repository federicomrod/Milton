-- 068_kitchen_app_identity.sql
--
-- Mobile P0b (issue #430, epic #429). Cooks can use the Milton kitchen app
-- without Telegram and without being company members:
--
--   kitchen_invites   personal, single-use invite from the owner for ONE
--                     location. Only the SHA-256 hash of the secret is stored.
--                     Valid 7 days; can be revoked before it is used.
--   kitchen_devices   one row per phone a cook logged in on. Only the SHA-256
--                     hash of the device token is stored; revoking a row makes
--                     the very next request fail with 401.
--   kitchen_staff     gains can_see_costs (false for everyone in v1; there is
--                     no UI to turn it on).
--   kitchen_reports / kitchen_recipe_drafts
--                     gain channel ('telegram' | 'app') and, on reports,
--                     client_ref: the app's own id for a report, so a retried
--                     upload never creates a second report.
--
-- NON-ADDITIVE EXCEPTION approved by Fede on 29 Oct 2026 (like 040 and 063): drops NOT NULL on the Telegram id columns so cooks can use the app without Telegram. No data is changed; existing rows and existing unique keys keep working for Telegram rows.
--
-- The six statements of the exception (each guarded, safe to re-run):
--   kitchen_staff.telegram_user_id          DROP NOT NULL
--   kitchen_staff.chat_id                   DROP NOT NULL
--   kitchen_reports.telegram_chat_id        DROP NOT NULL
--   kitchen_reports.telegram_message_id     DROP NOT NULL
--   kitchen_recipe_drafts.telegram_chat_id      DROP NOT NULL
--   kitchen_recipe_drafts.telegram_message_id   DROP NOT NULL
-- Postgres unique constraints allow several NULLs, so
-- UNIQUE (telegram_user_id, location_id) and UNIQUE (telegram_chat_id,
-- telegram_message_id) keep working for Telegram rows.
--
-- Everything else is additive and company-scoped. Writes to the new tables go
-- through the service role only (same as kitchen_join_tokens): there are no
-- insert/update/delete policies for users. Cooks are NEVER written to
-- company_memberships and never get a Supabase auth user.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton
-- Staging first; production only after Fede says yes.

-- ---------------------------------------------------------------------------
-- 1. The non-additive exception: Telegram ids become optional
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_staff'
      AND column_name = 'telegram_user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_staff ALTER COLUMN telegram_user_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_staff'
      AND column_name = 'chat_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_staff ALTER COLUMN chat_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_reports'
      AND column_name = 'telegram_chat_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_reports ALTER COLUMN telegram_chat_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_reports'
      AND column_name = 'telegram_message_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_reports ALTER COLUMN telegram_message_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_recipe_drafts'
      AND column_name = 'telegram_chat_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_recipe_drafts ALTER COLUMN telegram_chat_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kitchen_recipe_drafts'
      AND column_name = 'telegram_message_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.kitchen_recipe_drafts ALTER COLUMN telegram_message_id DROP NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. kitchen_invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id        uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL,
  invitee_name       text NULL,
  secret_hash        text NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at            timestamptz NULL,
  used_by_staff_id   uuid NULL REFERENCES public.kitchen_staff(id) ON DELETE SET NULL,
  revoked_at         timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kitchen_invites_company_location_created_idx
  ON public.kitchen_invites (company_id, location_id, created_at DESC);

ALTER TABLE public.kitchen_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitchen_invites'
      AND policyname = 'kitchen_invites_member_select'
  ) THEN
    CREATE POLICY kitchen_invites_member_select ON public.kitchen_invites
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. kitchen_devices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  staff_id      uuid NOT NULL REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  invite_id     uuid NULL REFERENCES public.kitchen_invites(id) ON DELETE SET NULL,
  token_hash    text NOT NULL UNIQUE,
  platform      text NULL CHECK (platform IN ('ios', 'android')),
  device_label  text NULL,
  last_seen_at  timestamptz NULL,
  revoked_at    timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kitchen_devices_company_staff_idx
  ON public.kitchen_devices (company_id, staff_id);

ALTER TABLE public.kitchen_devices ENABLE ROW LEVEL SECURITY;

-- The web only ever selects the non-secret columns (never token_hash).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitchen_devices'
      AND policyname = 'kitchen_devices_member_select'
  ) THEN
    CREATE POLICY kitchen_devices_member_select ON public.kitchen_devices
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Additive columns on the existing kitchen tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.kitchen_staff
  ADD COLUMN IF NOT EXISTS can_see_costs boolean NOT NULL DEFAULT false;

ALTER TABLE public.kitchen_reports
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'telegram'
    CHECK (channel IN ('telegram', 'app'));

ALTER TABLE public.kitchen_reports
  ADD COLUMN IF NOT EXISTS client_ref text NULL;

ALTER TABLE public.kitchen_recipe_drafts
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'telegram'
    CHECK (channel IN ('telegram', 'app'));

ALTER TABLE public.kitchen_recipe_drafts
  ADD COLUMN IF NOT EXISTS client_ref text NULL;

-- App retry dedupe: the same cook sending the same client_ref twice is one report.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_reports_staff_client_ref_key
  ON public.kitchen_reports (staff_id, client_ref)
  WHERE client_ref IS NOT NULL;

COMMENT ON TABLE public.kitchen_invites IS
  'Invitaciones personales de cocina para la app (un solo uso, 7 dias). Solo se guarda el hash. Escritura solo con service role.';
COMMENT ON TABLE public.kitchen_devices IS
  'Telefonos de cocineros con la app. Solo se guarda el hash del token. Escritura solo con service role.';
