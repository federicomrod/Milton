-- 027_odoo_last_sync.sql
--
-- Stores the last successful Odoo POS sync summary on the connection row
-- so /management/odoo can show "Last synced" after a reload. The live
-- Sync now response still returns the full unmatched_menu_items list;
-- this column keeps a compact snapshot (counts + till names, not the
-- ~200 KB item dump).
--
-- DESIGN: Additive, nullable jsonb. No default. Existing rows stay
-- last_sync IS NULL ("not synced yet"). No policy changes — the column
-- is covered by the existing restaurant_pos_connections RLS from
-- migration 013 / baseline.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- r1-staging before relying on "Last synced" after reload. No production
-- apply as part of this PR.

ALTER TABLE public.restaurant_pos_connections
  ADD COLUMN IF NOT EXISTS last_sync jsonb NULL;

COMMENT ON COLUMN public.restaurant_pos_connections.last_sync IS
  'Compact last successful Odoo POS sync (synced_at, range, counts). Full unmatched item list is not stored.';
