-- 081_existing_fixed_cost_table_acl.PROPOSAL.sql
--
-- *** PROPOSAL ONLY. NOT A MIGRATION. NOT APPLIED. Needs Fede's explicit approval. ***
-- It lives outside supabase/migrations on purpose so nothing can pick it up.
--
-- WHY. The live preflight of Milton Staging found that on the three EXISTING
-- fixed-cost tables anon AND authenticated hold direct SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, TRIGGER, REFERENCES and MAINTAIN (Supabase default privileges
-- at the time 064 was applied). Row-level security and the helper-function
-- restrictions still constrain row reads and writes, so this is NOT an observed
-- data leak. But TRUNCATE (and TRIGGER/REFERENCES/MAINTAIN) is outside RLS, and
-- migration 080 revokes only INSERT/UPDATE/DELETE from authenticated. Without this
-- file the "command boundary" claim is not complete. Ordinary PostgREST does not
-- expose TRUNCATE and no exploit was tried.
--
-- WHAT IT CHANGES (existing privileges, exactly; no policy, no data, no column)
--   restaurant_fixed_costs, restaurant_fixed_costs_log, fixed_cost_upload_drafts:
--     anon           : ALL revoked (anon has no business with company data; the
--                      RLS policies already give it no row).
--     authenticated  : restaurant_fixed_costs and _log -> SELECT only
--                      (writes go through the 079 commands);
--                      fixed_cost_upload_drafts -> SELECT, INSERT, UPDATE, DELETE
--                      (a draft is a work area, still written directly).
--     service_role   : unchanged (it bypasses RLS and is server-only).
--   REVOKE ALL + GRANT is used so it does not depend on the Postgres version
--   (MAINTAIN only exists from PG 17).
--
-- Apply only AFTER 079 and 080, in a quiet window, as one transaction.
-- ROLLBACK (data-safe): re-GRANT the privileges listed above to anon/authenticated.

BEGIN;

REVOKE ALL ON TABLE public.restaurant_fixed_costs     FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_fixed_costs_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.fixed_cost_upload_drafts   FROM anon, authenticated;

GRANT SELECT ON TABLE public.restaurant_fixed_costs     TO authenticated;
GRANT SELECT ON TABLE public.restaurant_fixed_costs_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fixed_cost_upload_drafts TO authenticated;

COMMIT;
