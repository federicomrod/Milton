-- 021_kitchen_telegram.sql
--
-- Kitchen QR join + cook reports (R1 issues #55 / #49). Three additive,
-- independent tables. Nothing existing is touched: the manager Telegram
-- tables from migration 017 stay exactly as they are, and kitchen staff
-- are NOT Milton users (no auth account, no company_memberships row).
--
--   1. kitchen_join_tokens: one live wall QR per location. The QR encodes
--      a Telegram deep link ?start=kq1_<secret>; only the SHA-256 hex of
--      the secret is stored (token_hash), so a QR can never be shown
--      again — a lost sheet means rotating. Rotation revokes the live
--      token (revoked_at) and inserts a new one; a partial unique index
--      keeps exactly one live token per location. Wall QRs do not expire,
--      hence no expires_at. Deny-by-default like
--      the manager pairing-code table (migration 017): RLS enabled, ZERO policies, so
--      only the service-role client (webhook and owner/admin API routes)
--      can read or write it.
--
--   2. kitchen_staff: a cook who joined by scanning a QR, identified by
--      telegram_user_id (UNIQUE: one row per cook, one location at a time;
--      scanning another location's QR moves the cook). Stores only the
--      Telegram display name — never a phone number or username.
--      Authenticated company members get SELECT only; every write comes
--      from the service-role client (the Telegram webhook, or owner/admin
--      routes), so a tenant member can never add or move a cook directly.
--
--   3. kitchen_reports: what cooks send (text, photo or voice note) —
--      items running out, 86'd items, waste. Photos/voice are stored as
--      Telegram file ids only (no download, no Storage bucket in R1).
--      UNIQUE (telegram_chat_id, telegram_message_id) makes Telegram
--      webhook retries idempotent. transcript / processed_at are reserved
--      for a later processing step and unused in R1. SELECT only for
--      company members; writes via the service role.
--
-- ORDER OF OPERATIONS: apply this migration BEFORE deploying the code that
-- uses it. It applies cleanly after 019 (and after 020 if present).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

-- ---------------------------------------------------------------------------
-- 1. kitchen_join_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_join_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_join_tokens_one_live_per_location
  ON public.kitchen_join_tokens (location_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.kitchen_join_tokens ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies: service-role only (see header).

-- ---------------------------------------------------------------------------
-- 2. kitchen_staff
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_staff (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id          uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  telegram_user_id     bigint NOT NULL,
  chat_id              bigint NOT NULL,
  display_name         text NOT NULL,
  role                 text NOT NULL DEFAULT 'kitchen' CHECK (role = 'kitchen'),
  is_active            boolean NOT NULL DEFAULT true,
  joined_via_token_id  uuid NULL REFERENCES public.kitchen_join_tokens(id) ON DELETE SET NULL,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  removed_at           timestamptz NULL,
  removed_by           uuid NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id)
);

CREATE INDEX IF NOT EXISTS kitchen_staff_location_active_idx
  ON public.kitchen_staff (location_id, is_active);

-- Serves the per-QR join rate limit.
CREATE INDEX IF NOT EXISTS kitchen_staff_token_joined_idx
  ON public.kitchen_staff (joined_via_token_id, joined_at);

ALTER TABLE public.kitchen_staff ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'kitchen_staff' AND policyname = 'kitchen_staff_member_select') THEN
    CREATE POLICY kitchen_staff_member_select ON public.kitchen_staff
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. kitchen_reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id             uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  staff_id                uuid NOT NULL REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  report_type             text NOT NULL CHECK (report_type IN ('running_out', '86', 'waste', 'unclassified')),
  text                    text NULL CHECK (text IS NULL OR char_length(text) <= 2000),
  media_kind              text NULL CHECK (media_kind IN ('photo', 'voice')),
  telegram_file_id        text NULL,
  telegram_file_unique_id text NULL,
  media_mime              text NULL,
  media_duration_s        int NULL,
  media_size_bytes        int NULL,
  telegram_chat_id        bigint NOT NULL,
  telegram_message_id     bigint NOT NULL,
  transcript              text NULL,
  processed_at            timestamptz NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS kitchen_reports_company_location_created_idx
  ON public.kitchen_reports (company_id, location_id, created_at DESC);

ALTER TABLE public.kitchen_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'kitchen_reports' AND policyname = 'kitchen_reports_member_select') THEN
    CREATE POLICY kitchen_reports_member_select ON public.kitchen_reports
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;
