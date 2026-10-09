-- 026_company_onboarding_status.sql
--
-- Adds companies.onboarding_status so finishing the restaurant wizard
-- actually marks the company complete (and saves location_count_range,
-- priorities, preferred_language in the same UPDATE). Login and the auth
-- callback already read this column; it was never created (not in
-- 001_baseline, not in 019–023). See GitHub #77.
--
-- Backfill: a company that already has a restaurant_locations row finished
-- the wizard. bootstrap_restaurant_user creates only company + membership;
-- the first location is inserted by POST /api/restaurant/onboarding/complete.
-- add-restaurant only runs after that. Safe to run twice.
--
-- Additive only. No DROP. Does not add companies.created_by — restaurant
-- ownership stays on company_memberships. Apply by hand in the SQL Editor.

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'not_started';

UPDATE public.companies AS c
SET onboarding_status = 'completed'
WHERE c.onboarding_status IS DISTINCT FROM 'completed'
  AND EXISTS (
    SELECT 1
    FROM public.restaurant_locations AS rl
    WHERE rl.company_id = c.id
  );

COMMIT;

-- Read-only check (safe to run after apply, or as part of this paste):
SELECT
  c.id,
  c.name,
  c.onboarding_status,
  EXISTS (
    SELECT 1
    FROM public.restaurant_locations AS rl
    WHERE rl.company_id = c.id
  ) AS has_location
FROM public.companies AS c
ORDER BY c.created_at;
