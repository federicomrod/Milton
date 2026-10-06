-- 018_briefing_email_delivery.sql
--
-- Email Briefing Extension v1 — company-level preferences for delivering
-- the existing Milton Executive Briefing by email (same engine as the
-- dashboard and Telegram — see lib/restaurant/briefing-generate.ts).
--
-- All columns additive, all on `companies` (delivery is a company-level
-- decision, same rationale as preferred_language in migration 016 — it
-- is not tied to a specific restaurant_brand/location).
--
--   briefing_email_cadence: 'off' | 'daily' | 'weekly'. Deliberately ONE
--     column rather than a separate enabled/cadence pair — "off" already
--     means disabled, so a second boolean could only ever drift out of
--     sync with it for no benefit. Free text with no CHECK constraint,
--     same rationale as pos_source/preferred_language: the fixed option
--     list lives in application code
--     (lib/restaurant/email/preferences.ts's normalizeCadence()), so a
--     third cadence later never requires a migration to match.
--
--   briefing_email_recipient: the one delivery address for this company
--     (V1 is one recipient per company, per the approved scope). Not a
--     secret — validated server-side on every write, never trusted raw
--     from a request at send time (see send-test route).
--
--   briefing_email_weekday: 0 (Sunday) .. 6 (Saturday), only meaningful
--     when cadence = 'weekly'. Defaults to 1 (Monday) — a harmless
--     sensible default a company can change, not a silent behavior.
--
--   briefing_email_timezone: IANA zone name (e.g. "America/Mexico_City").
--     Added because inspection found NO existing unambiguous company-level
--     timezone source to reuse: profiles.timezone is a per-USER legacy
--     preference (not company-level, and multiple users of one company
--     could disagree), and restaurant_pos_connections.timezone is
--     Odoo-connection-specific (absent for companies without Odoo, and
--     semantically about POS date derivation, not delivery scheduling).
--     Reusing either would silently guess at company intent — this
--     column makes the choice explicit instead, set through the
--     settings UI and defaulting new/unconfigured companies to 'UTC'
--     (an honest "not yet chosen" default, not a guessed local zone).
--
--   briefing_email_last_sent_at: reserved for the future scheduler
--     (Email Briefing Extension v1's scheduler is a DESIGN PROPOSAL only
--     in this change — see the architecture report — not implemented or
--     activated). Included now so activating the scheduler later never
--     needs a second migration for basic duplicate-send prevention.
--     No code in this change reads or writes this column.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change, and it has
-- NOT been applied to production as of this commit.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS briefing_email_cadence text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS briefing_email_recipient text NULL,
  ADD COLUMN IF NOT EXISTS briefing_email_weekday smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS briefing_email_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS briefing_email_last_sent_at timestamptz NULL;
