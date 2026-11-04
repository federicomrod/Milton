-- 078_kitchen_stay_signed_in.sql
--
-- A cook joins once and stays signed in on that phone; a lost session is
-- recovered with a name + PIN instead of the original invite link. Managers
-- can reset a PIN, send a new link to an existing cook and sign a phone out.
-- A signed-in manager can switch to Cocina without a link.
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or made stricter; existing rows
-- and keys keep working. Every table is company-scoped.
--
--   companies.kitchen_code        short, human code the cook types with their
--                                 name and PIN (made on demand by the server)
--   kitchen_staff.user_id         null for cooks; set for a manager's own
--                                 kitchen identity (one per company+location)
--   kitchen_invites.target_staff_id
--                                 «nuevo enlace» for an EXISTING cook: the
--                                 redeem reuses that kitchen_staff row (history
--                                 kept) instead of creating a new one
--   kitchen_staff_pins            the PIN, hashed (scrypt + per-row salt) and
--                                 stored apart from kitchen_staff on purpose:
--                                 kitchen_staff has a member SELECT policy, and
--                                 a hash must never be readable by the web.
--                                 RLS is on and there is NO policy: only the
--                                 service role reads or writes it. No API
--                                 returns pin_hash.
--   kitchen_pin_attempts          failed-PIN counters for the lock (per cook
--                                 and per IP). Subjects are hashes, never a
--                                 name or an IP in the clear. Members can read
--                                 their company's rows (is_company_member);
--                                 writes are service role only.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton
-- Staging first; production only after Fede says yes.

-- ---------------------------------------------------------------------------
-- 1. Additive columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS kitchen_code text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_kitchen_code_key
  ON public.companies (kitchen_code)
  WHERE kitchen_code IS NOT NULL;

ALTER TABLE public.kitchen_staff
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

-- One kitchen identity per manager per restaurant.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_staff_company_user_location_key
  ON public.kitchen_staff (company_id, user_id, location_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.kitchen_invites
  ADD COLUMN IF NOT EXISTS target_staff_id uuid NULL
    REFERENCES public.kitchen_staff(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. kitchen_staff_pins (service role only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_staff_pins (
  staff_id     uuid PRIMARY KEY REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pin_hash     text NOT NULL,
  pin_set_at   timestamptz NOT NULL DEFAULT now(),
  must_change  boolean NOT NULL DEFAULT false,
  set_by       uuid NULL
);

CREATE INDEX IF NOT EXISTS kitchen_staff_pins_company_idx
  ON public.kitchen_staff_pins (company_id);

ALTER TABLE public.kitchen_staff_pins ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy: users (web or mobile) can never select pin_hash.

-- ---------------------------------------------------------------------------
-- 3. kitchen_pin_attempts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_pin_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('staff', 'ip')),
  subject         text NOT NULL,
  failures        integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, subject)
);

ALTER TABLE public.kitchen_pin_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitchen_pin_attempts'
      AND policyname = 'kitchen_pin_attempts_member_select'
  ) THEN
    CREATE POLICY kitchen_pin_attempts_member_select ON public.kitchen_pin_attempts
      FOR SELECT USING (company_id IS NOT NULL AND public.is_company_member(company_id));
  END IF;
END $$;

COMMENT ON TABLE public.kitchen_staff_pins IS
  'PIN de cocina (hash scrypt con sal). Sin politicas: solo service role. Nunca se devuelve.';
COMMENT ON TABLE public.kitchen_pin_attempts IS
  'Intentos fallidos de PIN para el bloqueo (por cocinero y por IP). Solo hashes. Escritura solo con service role.';
