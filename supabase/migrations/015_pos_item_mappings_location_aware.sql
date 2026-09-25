-- 015_pos_item_mappings_location_aware.sql
--
-- Makes pos_item_mappings restaurant/location-aware so the same raw POS
-- item name (e.g. "Coke") can map to a different menu_items row at
-- different restaurant locations, without ambiguity.
--
-- BACKGROUND
--
-- Today pos_item_mappings is keyed only by (company_id, raw_pos_item_name),
-- with a single UNIQUE constraint enforcing at most one mapping per raw
-- name per company. That's correct for a single-restaurant company but
-- breaks the moment a company has two brands/locations that each sell an
-- item with the same or similar raw POS name — only one of the two real
-- menu items could ever be mapped, and the other location's sales of that
-- item would be mismatched or left unmatched.
--
-- DESIGN
--
-- Add a nullable `location_id`, and replace the single UNIQUE constraint
-- with TWO PARTIAL unique indexes rather than one composite constraint
-- that includes location_id directly. This is deliberate, not
-- incidental — plain SQL UNIQUE semantics treat every NULL as distinct
-- from every other NULL, so a naive
-- `UNIQUE (company_id, location_id, raw_pos_item_name)` constraint would
-- NOT stop the company-wide/legacy rows (location_id IS NULL) from
-- silently accumulating duplicates — exactly the "duplicate ambiguous
-- fallback mapping" risk this design must prevent. Two partial indexes
-- each enforce uniqueness within their own, unambiguous group:
--
--   1. pos_item_mappings_location_uniq
--      UNIQUE (company_id, location_id, raw_pos_item_name)
--      WHERE location_id IS NOT NULL
--      -> at most one mapping per raw name PER LOCATION. This is what
--         lets "Coke" map differently at location A vs location B.
--
--   2. pos_item_mappings_company_wide_uniq
--      UNIQUE (company_id, raw_pos_item_name)
--      WHERE location_id IS NULL
--      -> at most ONE company-wide/legacy fallback mapping per raw name,
--         exactly preserving today's guarantee for rows that don't (yet)
--         specify a location.
--
-- LOOKUP PRECEDENCE (enforced in application code, not SQL — see
-- lib/restaurant/scoped-matching.ts):
--   1. exact match on (company_id, location_id, raw_pos_item_name)
--   2. fall back to (company_id, raw_pos_item_name) WHERE location_id IS NULL
--   3. unmatched
--
-- EXISTING DATA
--
-- All rows that exist today have no location_id column at all yet; after
-- this migration they get location_id = NULL by column default, which is
-- exactly the "legacy/company-wide" bucket. The existing single UNIQUE
-- constraint (company_id, raw_pos_item_name) already guaranteed no two
-- current rows share a company_id + raw_pos_item_name pair — which is
-- precisely what pos_item_mappings_company_wide_uniq (scoped to
-- location_id IS NULL) requires. So every existing row is guaranteed to
-- satisfy the new partial index with zero data cleanup, and this
-- migration performs no UPDATE/backfill.
--
-- The old constraint is dropped because it would otherwise conflict with
-- inserting a second, location-specific mapping for the same raw name
-- (it only looks at company_id + raw_pos_item_name, ignoring
-- location_id, so it would incorrectly reject the legitimate
-- location-specific row as a duplicate of the existing company-wide one).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

ALTER TABLE public.pos_item_mappings
  ADD COLUMN IF NOT EXISTS location_id uuid NULL
    REFERENCES public.restaurant_locations(id) ON DELETE CASCADE;

ALTER TABLE public.pos_item_mappings
  DROP CONSTRAINT IF EXISTS pos_item_mappings_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS pos_item_mappings_location_uniq
  ON public.pos_item_mappings (company_id, location_id, raw_pos_item_name)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_item_mappings_company_wide_uniq
  ON public.pos_item_mappings (company_id, raw_pos_item_name)
  WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_item_mappings_location
  ON public.pos_item_mappings (location_id);
