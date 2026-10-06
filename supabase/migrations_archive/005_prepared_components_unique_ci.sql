-- 005_prepared_components_unique_ci.sql
--
-- Tightens the prepared_components uniqueness story:
--   1. Archives every "duplicate" (case-insensitive) name, keeping only
--      the oldest row by created_at. Soft action — nothing is destroyed.
--   2. Adds a UNIQUE INDEX on (company_id, lower(name)) so future inserts
--      can't introduce a duplicate that differs only in casing or
--      trailing whitespace.
--
-- We use a UNIQUE INDEX rather than ALTER TABLE … ADD CONSTRAINT UNIQUE
-- because Postgres only lets the latter operate on plain columns, not
-- expressions. The index plays the same role for the planner.
--
-- This file is idempotent: re-running it is safe.
--
-- IMPORTANT: paste this into the Supabase SQL Editor and run it. CI does
-- not apply repo migrations yet.

-- 1. Archive case-insensitive duplicates, oldest wins.
WITH ranked AS (
  SELECT
    id,
    company_id,
    name,
    status,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.prepared_components
)
UPDATE public.prepared_components pc
SET status = 'archived'
FROM ranked r
WHERE pc.id = r.id
  AND r.rn > 1
  AND pc.status <> 'archived';

-- 2. Replace (or create) the case-insensitive uniqueness guard.
-- We deliberately keep the original (company_id, name) constraint from
-- migration 004 — this index is additional and stricter. If migration
-- 004's constraint is missing for any reason this index still does the
-- right thing on its own.
CREATE UNIQUE INDEX IF NOT EXISTS prepared_components_company_name_ci_uniq
  ON public.prepared_components (company_id, lower(trim(name)));
