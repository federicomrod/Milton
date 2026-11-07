-- 073_fixed_costs_write_roles.sql
--
-- Issue #438. Only owner, admin and manager may create, edit or delete fixed
-- costs AT THE DATABASE. The app already says so (lib/auth/capabilities.ts,
-- "costs.fixed" = owner, admin, manager); migration 064 let any company member
-- write, so a member with their own session could bypass the app.
--
-- WHAT CHANGES
--   1. New helper public.has_company_role(target_company_id uuid, roles text[]):
--      true when the signed-in user (auth.uid()) has one of `roles` in that
--      company. Same table and column as is_company_member
--      (public.company_memberships.user_id / .role); role compared trimmed and
--      lower-cased like the app does (normalizeRole). SECURITY DEFINER,
--      search_path = public, EXECUTE revoked from PUBLIC and anon, granted to
--      authenticated and service_role (same hardening as 022). Created only if
--      it does not exist yet; is_company_member is NOT touched.
--   2. restaurant_fixed_costs, restaurant_fixed_costs_log and
--      fixed_cost_upload_drafts (the three tables 064 created): INSERT, UPDATE
--      and DELETE now require has_company_role(company_id,
--      ARRAY['owner','admin','manager']). SELECT stays is_company_member.
--
-- NOT ADDITIVE (the only part): the old write policies of those three tables
-- (<table>_member_insert / _update / _delete) are DROPPED IF EXISTS and
-- replaced by <table>_writers_insert / _update / _delete, all in ONE
-- transaction, so there is no moment without a policy. No table, column, data,
-- grant, default or SELECT-policy change. Re-running is safe (DROP IF EXISTS,
-- CREATE only when missing).
--
-- MILTON STAFF: the app lets Milton staff pass "costs.fixed" whatever their
-- role. Today that only reaches the database when the staff user is also a
-- member of the company (064 is member-only; a staff user who is not a member
-- sees no rows and writes nothing, and the app uses the user's own session, not
-- the service role). To keep exactly that behaviour, each write policy also
-- allows (is_company_member(company_id) AND is_milton_admin()). A staff user
-- who is not a member is unchanged (still no access); the service role bypasses
-- RLS as before.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton Staging
-- first; production only after Fede says yes. Also add has_company_role to the
-- allowlist of supabase/tests/secdef_guard.sql (done in this PR).

BEGIN;

-- 1. Helper ------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'has_company_role'
       AND pg_get_function_identity_arguments(p.oid) = 'target_company_id uuid, roles text[]'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.has_company_role(target_company_id uuid, roles text[])
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT EXISTS (
          SELECT 1
            FROM public.company_memberships cm
           WHERE cm.company_id = target_company_id
             AND cm.user_id = auth.uid()
             AND lower(btrim(cm.role)) = ANY (roles)
        );
      $body$
    $fn$;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.has_company_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, text[]) TO authenticated, service_role;

-- 2. Write policies ------------------------------------------------------------

DO $$
DECLARE
  t text;
  writers text := 'public.has_company_role(company_id, ARRAY[''owner'',''admin'',''manager''])'
    || ' OR (public.is_company_member(company_id) AND public.is_milton_admin())';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'restaurant_fixed_costs',
    'restaurant_fixed_costs_log',
    'fixed_cost_upload_drafts'
  ]
  LOOP
    -- The old member-wide write policies from 064 (only these three per table).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_delete', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)',
        t || '_writers_insert', t, writers);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)',
        t || '_writers_update', t, writers, writers);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE USING (%s)',
        t || '_writers_delete', t, writers);
    END IF;
  END LOOP;
END
$$;

COMMIT;
