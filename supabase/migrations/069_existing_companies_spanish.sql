-- 069_existing_companies_spanish.sql
--
-- One-off DATA update, no schema, RLS or default changes.
--
-- Why: companies.preferred_language was added with DEFAULT 'en' and every
-- existing company was backfilled to 'en' (baseline / migration 016), while the
-- restaurant app always showed Spanish and ignored the stored value. The app
-- now honours it, so without this update every existing Spanish-speaking
-- account (web, Telegram kitchen replies, briefings, emails) would flip to
-- English.
--
-- Rule (same Spanish-default country list as lib/restaurant/language.ts:
-- MX SV GT AR CL CO ES PE):
--   * a company still on 'en' that has a location in one of those countries
--     -> 'es';
--   * a company still on 'en' that has NO country stored on any location
--     -> 'es' (the app was Spanish for everyone, so that is what they see now);
--   * a company whose locations all have a stored country OUTSIDE the list
--     keeps 'en' (as onboarding would have defaulted it).
-- Only companies created before this migration are touched, so re-running it
-- later never overrides a language someone chose afterwards. Idempotent:
-- a second run finds nothing left to change.

UPDATE public.companies c
SET preferred_language = 'es',
    updated_at = now()
WHERE c.preferred_language = 'en'
  AND c.created_at < timestamptz '2026-10-30 00:00:00+00'
  AND (
    EXISTS (
      SELECT 1
      FROM public.restaurant_locations l
      WHERE l.company_id = c.id
        AND lower(btrim(l.country)) IN (
          'mx', 'sv', 'gt', 'ar', 'cl', 'co', 'es', 'pe',
          'mexico', 'méxico', 'el salvador', 'guatemala', 'argentina',
          'chile', 'colombia', 'españa', 'spain', 'peru', 'perú'
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.restaurant_locations l
      WHERE l.company_id = c.id
        AND nullif(btrim(l.country), '') IS NOT NULL
    )
  );
