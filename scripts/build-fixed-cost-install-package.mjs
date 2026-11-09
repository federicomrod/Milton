// Builds supabase/install-packages/fixed-cost-079-install-package.sql from the
// reviewed migration 079: ONE transaction = preflight checks + the migration +
// postflight checks + COMMIT. Any failed check raises, and nothing is kept.
//
//   node scripts/build-fixed-cost-install-package.mjs          # (re)write the file
//   node scripts/build-fixed-cost-install-package.mjs --check  # exit 1 if it is stale
//
// It reads no environment variable and connects to nothing.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "supabase/migrations/079_fixed_cost_items_and_commands.sql";
const OUT = "supabase/install-packages/fixed-cost-079-install-package.sql";

export function buildPackage() {
  const body = readFileSync(join(root, SRC), "utf8");
  const sha = createHash("sha256").update(body).digest("hex");
  return `-- fixed-cost-079-install-package.sql   (GENERATED: do not edit; see scripts/build-fixed-cost-install-package.mjs)
--
-- ALL-OR-NOTHING installation of migration 079 (fixed-cost items and commands).
-- Source: ${SRC}
-- Source SHA-256: ${sha}
--
-- STATUS: NOT APPLIED to any hosted database. Applying it to Milton Staging needs
-- Fede's explicit approval, a quiet window and a restorable recovery point.
-- It does NOT include 080 (separate approval) or the 081 proposal.
--
-- HOW IT BEHAVES
--   * One BEGIN ... COMMIT. A failed preflight, migration statement or postflight
--     check raises; nothing is kept. If a runner keeps sending statements after an
--     error, the closing COMMIT of an aborted transaction is a ROLLBACK.
--   * Preflight refuses to run on a database that already has any 079 object, that
--     lacks a prerequisite (the three 064 tables, the 073 write policies, the
--     helper functions), or that is older than PostgreSQL 15.
--   * It records a fingerprint of every existing row (old columns only) and proves
--     at the end that 079 changed none of them.
--   * Postflight proves the privileges: seven invoker wrappers for signed-in users
--     only, a private implementation schema, no API role on any new sequence, and
--     no write privilege on the new tables.
--   * lock_timeout (10 s) stops it queueing behind application traffic.
--
-- Run it as ONE script (Supabase SQL Editor, or: psql -1 -v ON_ERROR_STOP=1 -f ...).

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ===========================================================================
-- PREFLIGHT
-- ===========================================================================
DO $pre$
DECLARE
  t text;
  missing text[] := ARRAY[]::text[];
  present text[] := ARRAY[]::text[];
  fp text;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'preflight: PostgreSQL 15 or newer is required';
  END IF;

  FOREACH t IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = t) THEN
      missing := missing || ('role ' || t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['companies', 'company_memberships', 'restaurant_locations',
                           'restaurant_fixed_costs', 'restaurant_fixed_costs_log',
                           'fixed_cost_upload_drafts'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN missing := missing || ('table ' || t); END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['public.is_company_member(uuid)', 'public.has_company_role(uuid,text[])',
                           'public.is_milton_admin()', 'auth.uid()', 'pg_catalog.sha256(bytea)',
                           'pg_catalog.gen_random_uuid()'] LOOP
    IF to_regprocedure(t) IS NULL THEN missing := missing || ('function ' || t); END IF;
  END LOOP;

  -- 073 must be in force: writers-only policies, no member-wide write policy.
  FOREACH t IN ARRAY ARRAY['restaurant_fixed_costs', 'restaurant_fixed_costs_log', 'fixed_cost_upload_drafts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
        missing := missing || ('row level security on ' || t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                  AND policyname IN (t || '_member_insert', t || '_member_update', t || '_member_delete')) THEN
        missing := missing || ('073 applied on ' || t || ' (old member write policy still present)');
      END IF;
      IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                  AND policyname IN (t || '_writers_insert', t || '_writers_update', t || '_writers_delete')) <> 3 THEN
        missing := missing || ('073 writer policies on ' || t);
      END IF;
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'preflight failed, prerequisites missing: %', array_to_string(missing, '; ');
  END IF;

  -- None of 079 may exist yet (also catches a half-applied earlier attempt).
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'fixed_cost_private') THEN present := array_append(present, 'schema fixed_cost_private'::text); END IF;
  FOREACH t IN ARRAY ARRAY['fixed_cost_items', 'fixed_cost_commands'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN present := present || ('table ' || t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['version', 'detail_state', 'copy_source'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'restaurant_fixed_costs' AND column_name = t) THEN present := present || ('column restaurant_fixed_costs.' || t); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurant_fixed_costs_log' AND column_name = 'command_id') THEN present := array_append(present, 'column restaurant_fixed_costs_log.command_id'::text); END IF;
  FOREACH t IN ARRAY ARRAY['version', 'file_sha256'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'fixed_cost_upload_drafts' AND column_name = t) THEN present := present || ('column fixed_cost_upload_drafts.' || t); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND (p.proname LIKE 'fixed\\_cost\\_%' OR p.proname LIKE 'fc\\_%')) THEN present := array_append(present, 'functions fixed_cost_* / fc_* in public'::text); END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_fixed_costs_detail_state_chk') THEN present := array_append(present, 'constraint restaurant_fixed_costs_detail_state_chk'::text); END IF;
  IF array_length(present, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'preflight failed, 079 (or part of it) already exists: %', array_to_string(present, '; ');
  END IF;

  -- Fingerprint of the existing rows, OLD columns only, to prove 079 changes none.
  SELECT md5(
    (SELECT count(*)::text || coalesce(md5(string_agg(to_jsonb(f)::text, E'\\n' ORDER BY f.id)), '') FROM public.restaurant_fixed_costs f) || '|' ||
    (SELECT count(*)::text || coalesce(md5(string_agg(to_jsonb(g)::text, E'\\n' ORDER BY g.id)), '') FROM public.restaurant_fixed_costs_log g) || '|' ||
    (SELECT count(*)::text || coalesce(md5(string_agg(to_jsonb(d)::text, E'\\n' ORDER BY d.id)), '') FROM public.fixed_cost_upload_drafts d)
  ) INTO fp;
  PERFORM set_config('fc079.fingerprint', fp, true);
END
$pre$;

-- ===========================================================================
-- MIGRATION 079 (verbatim)
-- ===========================================================================
${body.replace(/\s+$/, "")}

-- ===========================================================================
-- POSTFLIGHT
-- ===========================================================================
DO $post$
DECLARE
  fp_before text := current_setting('fc079.fingerprint', true);
  fp_after text;
  rec record;
  s text;
  bad text[] := ARRAY[]::text[];
BEGIN
  -- 1. Nothing that existed before was changed by 079 (old columns).
  SELECT md5(
    (SELECT count(*)::text || coalesce(md5(string_agg((to_jsonb(f) - 'version' - 'detail_state' - 'copy_source')::text, E'\\n' ORDER BY f.id)), '') FROM public.restaurant_fixed_costs f) || '|' ||
    (SELECT count(*)::text || coalesce(md5(string_agg((to_jsonb(g) - 'command_id')::text, E'\\n' ORDER BY g.id)), '') FROM public.restaurant_fixed_costs_log g) || '|' ||
    (SELECT count(*)::text || coalesce(md5(string_agg((to_jsonb(d) - 'version' - 'file_sha256')::text, E'\\n' ORDER BY d.id)), '') FROM public.fixed_cost_upload_drafts d)
  ) INTO fp_after;
  IF fp_before IS NULL OR fp_before <> fp_after THEN
    RAISE EXCEPTION 'postflight: existing fixed-cost rows differ from the preflight fingerprint';
  END IF;

  -- 2. Every pre-existing aggregate is an honest legacy total.
  IF EXISTS (SELECT 1 FROM public.restaurant_fixed_costs WHERE detail_state <> 'legacy_total') THEN
    RAISE EXCEPTION 'postflight: a pre-existing aggregate is not legacy_total';
  END IF;

  -- 3. API surface: seven INVOKER wrappers in public, signed-in users only.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'fixed\\_cost\\_%' AND NOT p.prosecdef) <> 7 THEN
    RAISE EXCEPTION 'postflight: expected seven SECURITY INVOKER wrappers in public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosecdef AND (p.proname LIKE 'fixed\\_cost\\_%' OR p.proname LIKE 'fc\\_%')) THEN
    RAISE EXCEPTION 'postflight: a privileged fixed-cost function is in the public schema';
  END IF;
  FOR rec IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fixed\\_cost\\_%' LOOP
    IF NOT has_function_privilege('authenticated', rec.oid, 'EXECUTE') THEN bad := bad || ('authenticated cannot run ' || rec.proname); END IF;
    IF has_function_privilege('anon', rec.oid, 'EXECUTE') THEN bad := bad || ('anon can run ' || rec.proname); END IF;
    IF has_function_privilege('service_role', rec.oid, 'EXECUTE') THEN bad := bad || ('service_role can run ' || rec.proname); END IF;
  END LOOP;

  -- 4. Private schema: only authenticated may enter; helpers are reachable by nobody.
  IF has_schema_privilege('anon', 'fixed_cost_private', 'USAGE') OR has_schema_privilege('service_role', 'fixed_cost_private', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'fixed_cost_private', 'USAGE') THEN
    bad := array_append(bad, 'schema fixed_cost_private privileges are not authenticated-only'::text);
  END IF;
  FOR rec IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'fixed_cost_private' LOOP
    IF has_function_privilege('anon', rec.oid, 'EXECUTE') OR has_function_privilege('service_role', rec.oid, 'EXECUTE') THEN
      bad := bad || ('anon/service_role can run private ' || rec.proname);
    END IF;
    IF rec.proname LIKE 'fc\\_%' AND has_function_privilege('authenticated', rec.oid, 'EXECUTE') THEN
      bad := bad || ('authenticated can run helper ' || rec.proname);
    END IF;
  END LOOP;

  -- 5. Sequences: no API role has any privilege.
  FOREACH s IN ARRAY ARRAY['fixed_cost_private.fixed_cost_version_seq', pg_get_serial_sequence('public.fixed_cost_items', 'seq')] LOOP
    IF has_sequence_privilege('anon', s, 'USAGE,SELECT,UPDATE') OR has_sequence_privilege('authenticated', s, 'USAGE,SELECT,UPDATE')
       OR has_sequence_privilege('service_role', s, 'USAGE,SELECT,UPDATE') THEN
      bad := bad || ('an API role has a privilege on sequence ' || s);
    END IF;
  END LOOP;

  -- 6. New tables: anon nothing; authenticated SELECT only.
  FOREACH s IN ARRAY ARRAY['public.fixed_cost_items', 'public.fixed_cost_commands'] LOOP
    IF has_table_privilege('anon', s, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', s, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR NOT has_table_privilege('authenticated', s, 'SELECT') THEN
      bad := bad || ('unexpected privileges on ' || s);
    END IF;
  END LOOP;

  -- 7. The invariant triggers and RLS are in place.
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('fixed_cost_items_invariant', 'restaurant_fixed_costs_invariant',
        'fixed_cost_upload_drafts_version', 'fixed_cost_commands_immutable') AND NOT tgisinternal) <> 4 THEN
    bad := array_append(bad, 'one of the four triggers is missing'::text);
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fixed_cost_items'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fixed_cost_commands'::regclass) THEN
    bad := array_append(bad, 'RLS is not enabled on a new table'::text);
  END IF;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'postflight failed: %', array_to_string(bad, '; ');
  END IF;
END
$post$;

COMMIT;
`;
}

const out = join(root, OUT);
if (process.argv.includes("--check")) {
  let cur = "";
  try {
    cur = readFileSync(out, "utf8");
  } catch {
    // a missing file is stale by definition
  }
  if (cur !== buildPackage()) {
    console.error(
      `${OUT} is stale: run node scripts/build-fixed-cost-install-package.mjs`
    );
    process.exit(1);
  }
  console.log(`${OUT} is up to date`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildPackage());
  console.log(`wrote ${OUT}`);
}
