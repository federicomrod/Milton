-- ⚠️ NEEDS FEDE'S EXPLICIT OK BEFORE PASTING: exception to additive-only migrations (replaces a UNIQUE constraint)
--
-- 063_kitchen_staff_multi_location.sql
--
-- One Telegram account can be a cook at several restaurants (even in
-- different companies). Until now kitchen_staff had UNIQUE (telegram_user_id)
-- (migration 021): one row per cook, scanning another QR "moved" the cook.
--
-- Why the constraint is replaced instead of keeping one row per cook:
-- kitchen_reports and the recipe drafts have staff_id NOT NULL ->
-- kitchen_staff(id). With one staff row per cook, an item for a second
-- company would point at the first company's row (cross-tenant). One
-- kitchen_staff row per (Telegram account, location) keeps every row a
-- company-scoped link; RLS (is_company_member from 021) stays correct.
--
-- THE ONLY NON-ADDITIVE STEP: the UNIQUE (telegram_user_id) constraint is
-- dropped and replaced by UNIQUE (telegram_user_id, location_id). No column,
-- table or row is dropped or changed. Everything else is additive:
--   1. new index kitchen_staff_tg_user_active_idx (active links per account)
--   2. kitchen_pending_items: a photo / voice note / text that waits for the
--      cook to pick which restaurant it is for (15 minutes, then it expires
--      and the payload is cleared). RLS enabled, ZERO policies = service-role
--      only, like kitchen_join_tokens in 021.
--   3. kitchen_routing_defaults: "the next ones go to X" for 30 minutes.
--      RLS enabled, ZERO policies.
--
-- ORDER OF OPERATIONS: paste this BY HAND into the Supabase SQL Editor
-- (Milton Staging first) BEFORE the code that uses it deploys, same as 021 /
-- 024. It is NOT applied automatically by CI. Idempotent: safe to re-run.
-- Applies cleanly after 062.

-- ---------------------------------------------------------------------------
-- 1. kitchen_staff: one row per (Telegram account, location)
-- ---------------------------------------------------------------------------

-- Drop any UNIQUE constraint on exactly (telegram_user_id), whatever its name.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.kitchen_staff'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['telegram_user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.kitchen_staff DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kitchen_staff'::regclass
      AND conname = 'kitchen_staff_telegram_user_location_key'
  ) THEN
    ALTER TABLE public.kitchen_staff
      ADD CONSTRAINT kitchen_staff_telegram_user_location_key
      UNIQUE (telegram_user_id, location_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS kitchen_staff_tg_user_active_idx
  ON public.kitchen_staff (telegram_user_id)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. kitchen_pending_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_pending_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce               text NOT NULL UNIQUE,
  telegram_user_id    bigint NOT NULL,
  chat_id             bigint NOT NULL,
  telegram_message_id bigint NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('photo', 'voice', 'text', 'document')),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_staff_ids    uuid[] NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  resolved_at         timestamptz NULL,
  chosen_staff_id     uuid NULL REFERENCES public.kitchen_staff(id) ON DELETE SET NULL,
  UNIQUE (chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS kitchen_pending_items_user_idx
  ON public.kitchen_pending_items (telegram_user_id, resolved_at, expires_at);

ALTER TABLE public.kitchen_pending_items ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies: service-role only (see header).

-- ---------------------------------------------------------------------------
-- 3. kitchen_routing_defaults
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_routing_defaults (
  telegram_user_id bigint PRIMARY KEY,
  staff_id         uuid NOT NULL REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  chosen_at        timestamptz NOT NULL
);

ALTER TABLE public.kitchen_routing_defaults ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies: service-role only (see header).

-- ---------------------------------------------------------------------------
-- ROLLBACK (comment block; run by hand only if needed)
-- ---------------------------------------------------------------------------
-- Only valid when every Telegram account has AT MOST ONE kitchen_staff row.
-- Guard query: must return zero rows before rolling back.
--
--   SELECT telegram_user_id, count(*) AS links
--   FROM public.kitchen_staff
--   GROUP BY telegram_user_id
--   HAVING count(*) > 1;
--
-- Rollback:
--   DROP TABLE IF EXISTS public.kitchen_routing_defaults;
--   DROP TABLE IF EXISTS public.kitchen_pending_items;
--   DROP INDEX IF EXISTS public.kitchen_staff_tg_user_active_idx;
--   ALTER TABLE public.kitchen_staff
--     DROP CONSTRAINT IF EXISTS kitchen_staff_telegram_user_location_key;
--   ALTER TABLE public.kitchen_staff
--     ADD CONSTRAINT kitchen_staff_telegram_user_id_key UNIQUE (telegram_user_id);

-- ---------------------------------------------------------------------------
-- CHECK AFTER PASTING (READ-ONLY; run these SELECTs separately)
-- ---------------------------------------------------------------------------
-- New constraint exists (expect 1 row) and the old one is gone (expect 0 rows):
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.kitchen_staff'::regclass AND conname = 'kitchen_staff_telegram_user_location_key';
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.kitchen_staff'::regclass AND contype = 'u'
--     AND pg_get_constraintdef(oid) = 'UNIQUE (telegram_user_id)';
--
-- Both new tables have RLS enabled (expect true, true) and 0 policies:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('kitchen_pending_items', 'kitchen_routing_defaults') AND relkind = 'r';
--   SELECT count(*) AS policies FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('kitchen_pending_items', 'kitchen_routing_defaults');
