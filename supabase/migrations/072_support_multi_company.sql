-- 072_support_multi_company.sql
--
-- Milton staff support access: one Milton admin email can open every client
-- account. Everyone else keeps ONE company per email.
--
-- WHAT CHANGES
--   1. company_memberships.is_support boolean NOT NULL DEFAULT false.
--      A support membership is an ordinary membership (role 'admin') flagged
--      is_support = true; it is what the client's team list shows as
--      «Soporte Milton» and what the owner can remove. Additive column, every
--      existing row stays false.
--   2. public.support_account_opens: one row per «Abrir cuenta» (who, which
--      company, when). Company-scoped (company_id), RLS on, SELECT only for
--      Milton admins (public.is_milton_admin()); no INSERT/UPDATE/DELETE
--      policy, so only the service role (the server action) writes it.
--   3. accept_workspace_invite(): the «one company per user» rule
--      (already_member_of_other_company) no longer applies to a Milton admin
--      (a user in public.milton_admins). Everything else in the function is
--      the body from 020, unchanged. CREATE OR REPLACE keeps the same
--      signature and the same server-only grants (re-applied below).
--
-- RLS IS NOT BYPASSED: a support user reaches a client through a real
-- company_memberships row, so every policy that uses is_company_member /
-- has_company_role works exactly as for any member. No policy is changed.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- policies created only when missing, CREATE OR REPLACE for the one function.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton Staging
-- first; production only after Fede says yes.

BEGIN;

-- 1. Support flag -------------------------------------------------------------

ALTER TABLE public.company_memberships
  ADD COLUMN IF NOT EXISTS is_support boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_memberships.is_support IS
  'Milton staff support membership (role admin). Shown as «Soporte Milton» in the client team list; the owner can remove it.';

-- 2. Audit of «Abrir cuenta» -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_account_opens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  -- Snapshot, so the list still reads if the account is renamed or deleted.
  user_email         text NULL,
  created_membership boolean NOT NULL DEFAULT false,
  opened_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_account_opens_opened_idx
  ON public.support_account_opens (opened_at DESC);
CREATE INDEX IF NOT EXISTS support_account_opens_company_idx
  ON public.support_account_opens (company_id, opened_at DESC);

ALTER TABLE public.support_account_opens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'support_account_opens'
       AND policyname = 'support_account_opens_admin_select'
  ) THEN
    CREATE POLICY support_account_opens_admin_select ON public.support_account_opens
      FOR SELECT USING (public.is_milton_admin());
  END IF;
END
$$;

GRANT SELECT ON TABLE public.support_account_opens TO authenticated;
GRANT ALL ON TABLE public.support_account_opens TO service_role;

-- 3. One company per user, except Milton admins ----------------------------------

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(
  p_token_hash text,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite     public.workspace_invites%ROWTYPE;
  v_user_email text;
BEGIN
  -- (1) Lock the invite row so concurrent accepts serialize.
  SELECT * INTO v_invite
    FROM public.workspace_invites
   WHERE token_hash = p_token_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  -- (2) Distinct error per state.
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_accepted';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  -- (3) The auth user's email must match the invite, ignoring case.
  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = p_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF v_user_email <> lower(v_invite.email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  -- One company per user: never move or duplicate. Milton admins (support)
  -- may belong to several companies.
  IF EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE user_id = p_user_id AND company_id <> v_invite.company_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.milton_admins WHERE user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'already_member_of_other_company';
  END IF;

  -- (4) Profile (id, user_id) — only these columns, see migration 011.
  INSERT INTO public.profiles (id, user_id)
  VALUES (p_user_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- (5) Membership with the invite's role; no-op if already present.
  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE user_id = p_user_id AND company_id = v_invite.company_id
  ) THEN
    INSERT INTO public.company_memberships (user_id, company_id, role)
    VALUES (p_user_id, v_invite.company_id, v_invite.role);
  END IF;

  UPDATE public.profiles
     SET company_id = v_invite.company_id
   WHERE id = p_user_id AND company_id IS NULL;

  -- (6) Single use.
  UPDATE public.workspace_invites
     SET accepted_at = now(), accepted_by = p_user_id
   WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'company_id', v_invite.company_id,
    'role', v_invite.role
  );
END;
$$;

-- Server-only, as in 020.
REVOKE ALL ON FUNCTION public.accept_workspace_invite(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(text, uuid) TO service_role;

COMMIT;
