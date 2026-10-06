-- 017_telegram_connections.sql
--
-- Telegram Daily Briefing v1 — lets one Telegram chat receive the existing
-- Milton Executive Briefing for one company. Two additive, independent
-- tables, mirroring the split already established by migration 013
-- (restaurant_pos_connections / restaurant_pos_secrets):
--
--   1. restaurant_telegram_connections: the durable company<->chat link.
--      chat_id is NOT a secret (Telegram chat ids are not credentials),
--      but it IS a tenancy-sensitive mapping, so it gets a narrower access
--      model than a typical "your own company's row" table: only a SELECT
--      policy is defined below. With RLS enabled, a table that defines a
--      policy for SELECT but none for INSERT/UPDATE/DELETE allows
--      authenticated company members to see their own connection status
--      but can never let them set/change chat_id directly through the
--      normal RLS-backed client — every write to this table happens
--      through the service-role client, from the Telegram webhook handler
--      only (lib/restaurant/telegram/pairing.ts), after the pairing-code
--      proof described below. This is what actually prevents company A
--      from linking company B's chat (or vice versa).
--
--      UNIQUE(company_id) enforces "one company = one Telegram chat".
--      UNIQUE(chat_id) enforces "one Telegram chat = one company". Per
--      the approved Adjustment 2, the application layer must reject a new
--      pairing attempt when either side is already connected rather than
--      silently overwriting — these constraints are the last-resort
--      backstop for that rule, not the primary enforcement (the webhook
--      checks first and returns a clear, safe error before ever reaching
--      a constraint violation).
--
--   2. restaurant_telegram_pairing_codes: short-lived, single-use proof
--      that whoever is completing the Telegram side of the pairing was
--      shown a code only an authenticated member of that company could
--      have obtained (from POST /api/restaurant/telegram/pairing-code).
--      Deny-by-default like restaurant_pos_secrets: RLS enabled, ZERO
--      policies for any role, so only the service-role client can ever
--      read or write a code. A code is a short-lived bearer credential
--      during its ~15-minute window, so it gets the same "no policy at
--      all" posture as an encrypted secret, even though it is not itself
--      encrypted (it is single-use, expires quickly, and grants no access
--      beyond linking one already-known company_id to one chat_id).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change, and it has
-- NOT been applied to production as of this commit.

-- ---------------------------------------------------------------------------
-- 1. restaurant_telegram_connections — durable company <-> chat link
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_telegram_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Telegram chat ids are signed 64-bit integers (negative for groups/
  -- channels); bigint covers the full range exactly.
  chat_id        bigint NOT NULL,

  is_active      boolean NOT NULL DEFAULT true,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- One chat per company AND one company per chat (Adjustment 2 — no
  -- silent re-pairing; the application layer checks and rejects before
  -- ever reaching these, but they remain as the hard backstop).
  CONSTRAINT restaurant_telegram_connections_company_uniq UNIQUE (company_id),
  CONSTRAINT restaurant_telegram_connections_chat_uniq UNIQUE (chat_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_telegram_connections_company
  ON public.restaurant_telegram_connections(company_id);

ALTER TABLE public.restaurant_telegram_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_telegram_connections_select ON public.restaurant_telegram_connections;
CREATE POLICY restaurant_telegram_connections_select ON public.restaurant_telegram_connections
  FOR SELECT USING (public.is_company_member(company_id));

-- Deliberately no INSERT/UPDATE/DELETE policy for this table, for ANY
-- role. Writes happen only via the service-role client (see
-- lib/restaurant/telegram/pairing.ts), gated by a consumed pairing code.
-- Do not add one of those policies without a deliberate, separately
-- reviewed reason — it would let an authenticated user set chat_id
-- directly, bypassing the entire pairing-proof mechanism.

-- ---------------------------------------------------------------------------
-- 2. restaurant_telegram_pairing_codes — short-lived, single-use, service-
--    role only. No SELECT/INSERT/UPDATE/DELETE policy is defined for this
--    table, for ANY role, ANYWHERE in this migration or any future one
--    that doesn't explicitly revisit this decision. That absence is the
--    access control, exactly as for restaurant_pos_secrets.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_telegram_pairing_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Cryptographically random, single-use. UNIQUE so a collision (astronomically
  -- unlikely at the entropy generated in lib/restaurant/telegram/pairing.ts)
  -- fails loudly at insert time rather than silently colliding two companies.
  code         text NOT NULL UNIQUE,

  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_telegram_pairing_codes_company
  ON public.restaurant_telegram_pairing_codes(company_id);

ALTER TABLE public.restaurant_telegram_pairing_codes ENABLE ROW LEVEL SECURITY;
-- Deliberately no CREATE POLICY statements below this line for this table.
