-- 019_odoo_company_scope.sql
--
-- Odoo multi-company isolation: store WHICH Odoo companies (res.company)
-- a Milton tenant is allowed to sync from.
--
-- RISK: one Odoo database can hold several res.company records, and the
-- Odoo API user configured for a Milton tenant may be able to access more
-- than one of them. Before this change nothing in Milton recorded or
-- enforced an Odoo company, so an unscoped pos.order search_read could
-- return completed POS orders from every company that user can see, and
-- those would be upserted under this Milton tenant's company_id.
--
-- This migration adds ONE additive column:
--
--   restaurant_pos_connections.odoo_company_ids integer[]
--
--   * One Milton tenant may map to several Odoo companies (the pilot has
--     two restaurants = two Odoo companies in one database), hence an
--     integer array.
--   * The column is nullable on purpose. NULL means "nothing selected",
--     and the application FAILS CLOSED on it: the sync route refuses to
--     run (409) and no Odoo RPC is made without a non-empty selection.
--     There is no backfill and no default, so every existing row starts
--     out as "nothing selected" until someone chooses companies.
--   * IDs only ever come from Odoo discovery (res.users.company_ids ->
--     res.company), validated server-side against what the stored Odoo
--     user can access. They are never typed by hand and never written by
--     SQL.
--   * A CHECK constraint forbids an empty array; use NULL instead.
--
-- Existing RLS policies on restaurant_pos_connections (migration 013) are
-- unchanged and already cover the new column. The sync route re-validates
-- the stored selection against Odoo on every run, so a tenant member
-- editing the column directly still cannot reach a company the stored
-- Odoo user cannot access.
--
-- ORDER OF OPERATIONS: this migration must be applied BEFORE the code that
-- reads odoo_company_ids is deployed.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

ALTER TABLE public.restaurant_pos_connections
  ADD COLUMN IF NOT EXISTS odoo_company_ids integer[] NULL;

ALTER TABLE public.restaurant_pos_connections
  ADD CONSTRAINT restaurant_pos_connections_odoo_company_ids_nonempty
  CHECK (odoo_company_ids IS NULL OR cardinality(odoo_company_ids) >= 1);
