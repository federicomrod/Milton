-- 080_fixed_cost_enforce_command_boundary.sql
--
-- *** NOT ADDITIVE. NEEDS FEDE'S EXPLICIT APPROVAL BEFORE ANY HOSTED RUN. ***
-- *** Do not apply together with 079 by default: it is a separate decision. ***
--
-- Closes the old direct-write path to the FINANCIAL tables. After this file,
-- signed-in users can no longer INSERT / UPDATE / DELETE restaurant_fixed_costs
-- or restaurant_fixed_costs_log with their own session; every change goes
-- through the 079 command functions (SECURITY DEFINER, owner bypasses RLS,
-- authorization re-checked inside with auth.uid()).
-- fixed_cost_upload_drafts stays directly writable by writers on purpose: a
-- draft is a work area (create, edit a line, discard), not financial truth.
-- A trigger from 079 moves the draft version on every content change, so an
-- approval that reviewed an older draft is rejected.
--
-- WHAT CHANGES (existing enforcement, exactly)
--   * REVOKE INSERT, UPDATE, DELETE on restaurant_fixed_costs and
--     restaurant_fixed_costs_log FROM authenticated. SELECT stays, and so do
--     the RLS SELECT policies from 064.
--   * The 073 write policies (<table>_writers_insert/_update/_delete) are left
--     in place but become inert for `authenticated` on those two tables (no
--     privilege). They are NOT dropped here, so rolling this file back is a
--     GRANT, not a policy rebuild. The drafts table is unchanged.
--   * service_role keeps ALL (it bypasses RLS; the app must not use it for
--     these tables: the commands refuse a caller without auth.uid()).
--
-- WHY IT IS NEEDED
--   Without it an old app build (or any client holding a user JWT) can still
--   write the aggregate directly, skipping versions, events and idempotency. The
--   079 constraint triggers still stop it from breaking an ITEMIZED key, but not
--   from editing a legacy key or from forging log rows. That is a release gate.
--
-- ROLLBACK (data-safe):  GRANT INSERT, UPDATE, DELETE ON public.restaurant_fixed_costs, public.restaurant_fixed_costs_log TO authenticated;
--   After canonical writes exist, restoring direct writes lets an old build
--   write a legacy key without events; itemized keys stay protected by the 079
--   triggers. Prefer a forward fix or a write stop. See docs/design.
--
-- Same BEGIN/COMMIT style as 073. Re-running is safe.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.restaurant_fixed_costs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.restaurant_fixed_costs_log FROM authenticated;

COMMIT;
