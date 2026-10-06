-- 022_secdef_function_hardening.sql
--
-- SECURITY DEFINER hardening: stop exposing privileged functions through
-- PostgREST (/rest/v1/rpc/<function>) to logged-out and ordinary users.
--
-- PROBLEM. Functions run with their OWNER's rights (postgres) when they are
-- SECURITY DEFINER, and by default Postgres grants EXECUTE on every new
-- function to PUBLIC. On Supabase the public schema ALSO carries default
-- privileges that grant EXECUTE directly to anon, authenticated and
-- service_role. So `REVOKE ... FROM PUBLIC` alone is NOT enough: the
-- direct anon/authenticated grants must be revoked explicitly. Migration
-- 011's comment ("anon role cannot [call this]") was therefore wrong:
--
--   * public.bootstrap_restaurant_user(uuid, text) is meant to be called
--     only by the server (service role) from /api/auth/signup-complete, yet
--     anyone holding the public anon key could call it for any user id,
--     creating profile / company / owner-membership rows and re-pointing
--     profiles.company_id for a user who has more than one membership.
--   * public.is_company_member(uuid) is only needed by RLS policies that run
--     as signed-in users (it is evaluated for the QUERYING role, so that
--     role needs EXECUTE).
--
-- WHAT THIS MIGRATION DOES (only REVOKE / GRANT / ALTER FUNCTION; it never
-- redefines a function — is_company_member's body is not in this repo):
--
--   1. bootstrap_restaurant_user: EXECUTE revoked from PUBLIC, anon and
--      authenticated; granted to service_role only.
--   2. is_company_member: EXECUTE revoked from PUBLIC and anon; kept for
--      authenticated (RLS policies run as that role) and service_role.
--      anon is revoked because nothing legitimate runs it as anon: every
--      table read in the app happens behind a login (proxy.ts gates the
--      pages, API routes use authAndCompany() or the service role, the
--      Telegram webhook and cron use the service role) and no code builds a
--      logged-out table client. Consequence, intended: a logged-out request
--      to a table whose policy calls this function now fails with
--      "permission denied for function" instead of returning zero rows.
--   3. Pin search_path on every SECURITY DEFINER function in public that
--      lacks one (public, pg_temp), so a caller can't shadow objects the
--      function resolves by name. Extension-owned functions are skipped.
--
-- Idempotent: REVOKE/GRANT/ALTER can be re-run safely. The two named
-- functions must exist (a missing function fails loudly on purpose rather
-- than silently skipping a security fix).
--
-- Regression guard: supabase/tests/secdef_guard.sql lists SECURITY DEFINER
-- functions that PUBLIC, anon or authenticated can still execute and must
-- return 0 rows.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — and ONLY after Federico explicitly approves applying it.

-- 1. bootstrap_restaurant_user — server-only.
REVOKE EXECUTE ON FUNCTION public.bootstrap_restaurant_user(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_restaurant_user(uuid, text)
  TO service_role;

-- 2. is_company_member — RLS helper for signed-in users.
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid)
  TO authenticated, service_role;

-- 3. Pin search_path on any SECURITY DEFINER function in public without one.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.prokind = 'f'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.deptype = 'e'
       )
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
          WHERE c LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    RAISE NOTICE 'pinned search_path on %', fn;
  END LOOP;
END
$$;
