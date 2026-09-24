-- 014_onboarding_profile_fields.sql
--
-- Persists the restaurant-onboarding-v1 profile answers that were
-- previously session-only: concept type, location-count range, declared
-- POS system, and priorities.
--
-- Split across three tables rather than all on `companies` — concept type
-- and declared POS system can differ by brand/location respectively (see
-- the multi-brand/multi-location architecture audit), so putting them on
-- `companies` would silently become wrong the moment a second brand or
-- location is added. Location-count range and priorities are genuinely
-- company-level and stay on `companies`.
--
-- All columns nullable, purely additive. No CHECK constraints — validation
-- lives in application code (lib/restaurant/onboarding-copy.ts's
-- normalize* functions), so a future addition to the onboarding UI's
-- option lists never requires a migration to match. No existing column,
-- constraint, or RLS policy is touched.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS location_count_range text NULL,
  ADD COLUMN IF NOT EXISTS priorities text[] NULL;

ALTER TABLE public.restaurant_brands
  ADD COLUMN IF NOT EXISTS concept_type text NULL;

ALTER TABLE public.restaurant_locations
  ADD COLUMN IF NOT EXISTS primary_pos text NULL;
