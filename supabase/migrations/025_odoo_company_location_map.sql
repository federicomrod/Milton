-- 025_odoo_company_location_map.sql
--
-- Odoo company → Milton location mapping: stores which Milton restaurant
-- location each Odoo res.company syncs to. Required when one Milton account
-- maps to several Odoo companies (e.g. the pilot client: 2 restaurants = 2
-- Odoo companies under one Milton account, with identical till names like
-- 'Caja principal' that would otherwise collide).
--
-- DESIGN: Additive, nullable column on restaurant_locations. One location
-- may serve at most one Odoo company; one Odoo company maps to exactly one
-- location. The unique constraint (company_id, odoo_company_id WHERE NOT
-- NULL) enforces no duplicate mapping per Milton tenant. When a mapping
-- exists, the sync route takes the location from order.company_id and never
-- falls back to the till-name index.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first, then production access (only after backup #21 with Federico's yes)
-- — it is NOT applied automatically by this change.

ALTER TABLE public.restaurant_locations
  ADD COLUMN IF NOT EXISTS odoo_company_id integer NULL;

COMMENT ON COLUMN public.restaurant_locations.odoo_company_id IS
  'Odoo res.company ID this location syncs from (nullable). When set, pos.order records from this Odoo company land on this location, never guessed from till name.';

-- One Odoo company maps to at most one location per Milton company.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_locations_odoo_company_uniq
  ON public.restaurant_locations (company_id, odoo_company_id)
  WHERE odoo_company_id IS NOT NULL;

-- RLS: inherit from restaurant_locations (migration 013/021 style).
-- The column is covered by the existing SELECT/UPDATE policies; no new
-- policy is needed. Admins write via the service-role client after
-- validation.
