-- supabase/tests/secdef_guard.sql
--
-- GUARD: lists every SECURITY DEFINER, non-trigger function in a
-- non-system schema that PUBLIC, anon or authenticated can still EXECUTE,
-- minus the explicit allowlist below. MUST RETURN 0 ROWS.
--
-- Why: functions in public get EXECUTE from PUBLIC by default and, on
-- Supabase, direct grants to anon/authenticated via default privileges, so
-- a SECURITY DEFINER function is callable through /rest/v1/rpc/<name> by
-- anyone with the public key unless its privileges are explicitly revoked
-- (see migration 022).
--
-- How it decides "can execute": (a) aclexplode over proacl — a NULL ACL
-- means the default (owner + PUBLIC), and PUBLIC / anon / authenticated
-- entries are reported — and (b) has_function_privilege() for anon and
-- authenticated, which also catches access inherited through role
-- membership. Read-only: pure catalog SELECT, safe to run against any
-- database (including production, read-only).
--
-- Run:  psql "$DB_URL" -X -A -t -f supabase/tests/secdef_guard.sql
--       (any output line = failure)
--
-- Skipped: trigger functions (not callable as RPC), extension-owned
-- functions, and Supabase-managed schemas.
--
-- ALLOWLIST: (schema, function, argument TYPES, roles allowed to execute, reason).
-- Argument types only (e.g. 'uuid, text'), never parameter names, so a renamed
-- parameter can't silently defeat the match.
-- A role listed here is excused for that function ONLY; anything else still
-- fails. Every entry needs a one-line reason.

WITH allowlist (schema_name, func_name, arg_types, allowed_roles, reason) AS (
  VALUES
    ('public', 'is_company_member',        'uuid',
       ARRAY['authenticated'],
       'RLS helper evaluated for signed-in users; anon revoked (migration 022)'),
    ('public', 'is_milton_admin',          '',
       ARRAY['authenticated'],
       'RLS helper for admin-only policies, evaluated for signed-in users (migration 020)'),
    ('public', 'current_user_was_invited', '',
       ARRAY['authenticated'],
       'called from the logged-in login redirect; reads only auth.uid() (migration 020)')
),
managed_schemas (name) AS (
  VALUES ('auth'), ('storage'), ('realtime'), ('_realtime'), ('vault'),
         ('graphql'), ('graphql_public'), ('extensions'), ('pgbouncer'),
         ('supabase_functions'), ('supabase_migrations'), ('net'),
         ('pgsodium'), ('pgsodium_masks'), ('cron'), ('pgtle'), ('_analytics'),
         ('information_schema')
),
fn AS (
  SELECT p.oid, n.nspname AS schema_name, p.proname AS func_name,
         oidvectortypes(p.proargtypes) AS arg_types,
         p.proowner, p.proacl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef
     AND p.prokind = 'f'
     AND p.prorettype <> 'trigger'::regtype
     AND n.nspname !~ '^pg_'
     AND n.nspname NOT IN (SELECT name FROM managed_schemas)
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
     )
),
acl_exposed AS (
  -- Direct and PUBLIC grants, from the ACL (NULL ACL = default privileges).
  SELECT fn.oid,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS role_name
    FROM fn
    CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
   WHERE a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated'))
),
priv_exposed AS (
  -- Effective privilege, including inheritance through role membership.
  SELECT fn.oid, r.role_name
    FROM fn
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name)
     AND has_function_privilege(r.role_name, fn.oid, 'EXECUTE')
),
exposed AS (
  SELECT oid, role_name FROM acl_exposed
  UNION
  SELECT oid, role_name FROM priv_exposed
)
SELECT fn.schema_name,
       fn.func_name,
       fn.arg_types,
       string_agg(DISTINCT e.role_name, ', ' ORDER BY e.role_name) AS executable_by
  FROM exposed e
  JOIN fn ON fn.oid = e.oid
  LEFT JOIN allowlist al
         ON al.schema_name = fn.schema_name
        AND al.func_name = fn.func_name
        AND al.arg_types = fn.arg_types
 WHERE al.func_name IS NULL
    OR e.role_name <> ALL (al.allowed_roles)
 GROUP BY fn.schema_name, fn.func_name, fn.arg_types
 ORDER BY 1, 2, 3;
