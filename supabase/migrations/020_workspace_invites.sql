-- 020_workspace_invites.sql
--
-- R1 item 2 — workspace invite + account activation (GitHub issue #45) and
-- the "Connect your data" request log. Purely additive: two new tables, two
-- new functions for RLS/landing, and one SECURITY DEFINER RPC. No existing
-- table, policy or function is altered (bootstrap_restaurant_user from
-- migration 011 is untouched and is NEVER called for invitees).
--
--   1. workspace_invites
--      A Milton admin (profiles.role = 'admin') invites a client email into
--      an EXISTING workspace (companies row). Only a SHA-256 hash of the
--      one-time token is stored (token_hash); the raw token exists only in
--      the link handed to the admin once. role is 'owner' or 'member'.
--      A partial unique index allows at most one live (not accepted, not
--      revoked) invite per (company, lower(email)).
--      RLS: SELECT/INSERT/UPDATE for Milton admins only. There is NO policy
--      for invitees — they never read this table; acceptance goes through
--      accept_workspace_invite().
--
--      Ready for owner invites later (NOT built here): the role column and
--      company_id scoping mean client-owner invites need exactly one more
--      RLS policy (company_memberships.role = 'owner' for that company_id)
--      plus a UI. Neither is added in this migration (product decision:
--      only Milton admins invite during the pilot).
--
--   2. accept_workspace_invite(p_token_hash, p_user_id)
--      SECURITY DEFINER, EXECUTE granted to service_role ONLY, same pattern
--      as bootstrap_restaurant_user (PostgREST strips profiles.id on
--      insert, so profile/membership writes happen inside Postgres).
--      EXECUTE is revoked from PUBLIC, anon AND authenticated: on Supabase
--      the public schema's default privileges grant EXECUTE directly to
--      anon and authenticated, so revoking PUBLIC alone would leave it
--      callable through /rest/v1/rpc with the public key. One
--      transaction: lock the invite, reject accepted / revoked / expired
--      with a distinct error code each, require the auth user's email to
--      match the invite (case-insensitive), upsert the profile, insert the
--      membership with the invite's role (no-op if present), stamp
--      accepted_at / accepted_by. It never creates a company. A user who
--      already belongs to a DIFFERENT company is refused with
--      already_member_of_other_company (resolveCompanyIdForUser assumes one
--      company per user), never moved or duplicated.
--
--   3. current_user_was_invited()
--      SECURITY DEFINER, EXECUTE for authenticated (and service_role);
--      revoked from PUBLIC and anon. Returns whether the
--      calling user has an accepted invite, so the login redirect can keep
--      invited users out of the self-serve onboarding wizard without
--      giving invitees any read access to workspace_invites.
--
--   4. data_source_requests
--      Log of "request this data source" clicks on the Connect-your-data
--      screen. INSERT/SELECT for members of the company
--      (public.is_company_member), SELECT for Milton admins. No UPDATE or
--      DELETE policy.
--
-- Privileges: every SECURITY DEFINER function below has EXECUTE revoked from
-- PUBLIC and anon explicitly (see migration 022 for the reasoning); the RLS
-- helpers stay executable by authenticated because policies evaluate them as
-- the querying role.
--
-- Milton admin check: profiles.role = 'admin' — the same check the app
-- already uses (isUserAdminServer). NOTE: migration 011's header claims
-- profiles has no role column; if the column does not exist, the admin
-- check fails closed (no admin policy matches) — see the PR notes.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change. Apply it
-- BEFORE deploying the code that uses it.

-- ---------------------------------------------------------------------------
-- Milton admin helper (used by the RLS policies below)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_milton_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid() AND p.role = 'admin'
  );
$$;

-- Only signed-in users (RLS policies run as them) and the service role.
REVOKE EXECUTE ON FUNCTION public.is_milton_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_milton_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. workspace_invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'member')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_by  uuid NOT NULL,
  created_at  timestamptz DEFAULT now(),
  accepted_at timestamptz NULL,
  accepted_by uuid NULL,
  revoked_at  timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_live_email_uniq
  ON public.workspace_invites (company_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS workspace_invites_accepted_by_idx
  ON public.workspace_invites (accepted_by)
  WHERE accepted_by IS NOT NULL;

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'workspace_invites' AND policyname = 'workspace_invites_admin_select') THEN
    CREATE POLICY workspace_invites_admin_select ON public.workspace_invites
      FOR SELECT USING (public.is_milton_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'workspace_invites' AND policyname = 'workspace_invites_admin_insert') THEN
    CREATE POLICY workspace_invites_admin_insert ON public.workspace_invites
      FOR INSERT WITH CHECK (public.is_milton_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'workspace_invites' AND policyname = 'workspace_invites_admin_update') THEN
    CREATE POLICY workspace_invites_admin_update ON public.workspace_invites
      FOR UPDATE USING (public.is_milton_admin())
                  WITH CHECK (public.is_milton_admin());
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. accept_workspace_invite RPC
-- ---------------------------------------------------------------------------

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

  -- One company per user: never move or duplicate.
  IF EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE user_id = p_user_id AND company_id <> v_invite.company_id
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

-- Server-only. PUBLIC, anon and authenticated must ALL be revoked: the public
-- schema's default privileges grant anon/authenticated directly.
REVOKE ALL ON FUNCTION public.accept_workspace_invite(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. current_user_was_invited()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_was_invited()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_invites
     WHERE accepted_by = auth.uid() AND accepted_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_was_invited() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_was_invited() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. data_source_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_source_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  source     text NOT NULL CHECK (source IN ('odoo', 'revel_live', 'square', 'toast', 'other')),
  details    text NULL CHECK (details IS NULL OR char_length(details) <= 1000),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_source_requests_company_idx
  ON public.data_source_requests (company_id, created_at DESC);

ALTER TABLE public.data_source_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'data_source_requests' AND policyname = 'data_source_requests_member_select') THEN
    CREATE POLICY data_source_requests_member_select ON public.data_source_requests
      FOR SELECT USING (public.is_company_member(company_id) OR public.is_milton_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'data_source_requests' AND policyname = 'data_source_requests_member_insert') THEN
    CREATE POLICY data_source_requests_member_insert ON public.data_source_requests
      FOR INSERT WITH CHECK (public.is_company_member(company_id) AND user_id = auth.uid());
  END IF;
END
$$;
