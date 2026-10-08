-- 04_security_definer_check.sql
-- List all SECURITY DEFINER functions and their grants
-- This helps identify privilege escalation risks

\set ON_ERROR_STOP on
\set ECHO all

\echo '=== SECURITY DEFINER Functions with Public Execution Rights ==='
\echo ''
\echo 'Functions where PUBLIC, anon, or authenticated can execute a SECURITY DEFINER function:'
\echo ''

SELECT 
  n.nspname as schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments,
  CASE 
    WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
    WHEN p.provolatile = 's' THEN 'STABLE'
    WHEN p.provolatile = 'v' THEN 'VOLATILE'
  END as volatility,
  CASE 
    WHEN p.prosecdef THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END as security_mode,
  CASE 
    WHEN 'search_path' = ANY(string_to_array(p.proconfig::text, ',')) THEN 'YES - search_path pinned'
    ELSE 'NO - search_path NOT pinned (RISK)'
  END as search_path_pinned,
  -- Check if PUBLIC/anon/authenticated can execute
  CASE
    WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'PUBLIC'
    WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon'
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated'
    ELSE 'restricted'
  END as grantee,
  pg_catalog.obj_description(p.oid, 'pg_proc') as description
FROM pg_catalog.pg_proc p
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE 
  n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prosecdef = true  -- SECURITY DEFINER only
  AND (
    has_function_privilege('public', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
ORDER BY n.nspname, p.proname;

\echo ''
\echo '=== All SECURITY DEFINER Functions (including restricted ones) ==='
\echo ''

SELECT 
  n.nspname as schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments,
  CASE 
    WHEN 'search_path' = ANY(string_to_array(regexp_replace(p.proconfig::text, '[{}"]', '', 'g'), ',')) 
    THEN '✓ search_path pinned'
    ELSE '✗ search_path NOT pinned'
  END as search_path_status,
  CASE
    WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'PUBLIC'
    WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon'
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated'
    WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'service_role only'
    ELSE 'restricted'
  END as execute_granted_to
FROM pg_catalog.pg_proc p
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE 
  n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions')
  AND p.prosecdef = true
  AND p.prokind = 'f'  -- functions only, not triggers
ORDER BY n.nspname, p.proname;

\echo ''
\echo '=== Expected Results ==='
\echo 'bootstrap_restaurant_user: service_role only, search_path pinned'
\echo 'handle_new_user: PUBLIC/anon/authenticated (trigger function), search_path pinned'
\echo 'All SECURITY DEFINER functions should have search_path pinned'
\echo ''
