-- 050_ingredient_archive.sql
--
-- R1-15i (Limpieza de ingredientes, part 1). An ingredient that no active
-- recipe uses can be archived: hidden from the working lists, never deleted.
--
--   * One nullable column, `archived_at`. NULL = not archived.
--   * Nothing is dropped, renamed or backfilled; no existing row changes.
--   * Archiving is only ever a soft hide. An archived ingredient comes back by
--     itself as soon as a recipe uses it again (the app treats "archived AND
--     in use" as in use), and a person can restore it from the screen.
--   * RLS is unchanged: the existing "Members can access ingredients" policy
--     already covers an UPDATE of this column.
--
-- Before this migration is applied the screen still shows En uso / Sin uso
-- (computed from the recipes); only "Archivar" says the migration is missing.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Listing the archived ones of a company stays cheap.
CREATE INDEX IF NOT EXISTS ingredients_company_archived_idx
  ON public.ingredients (company_id)
  WHERE archived_at IS NOT NULL;

-- Read-only check (after applying):
--   select count(*) filter (where archived_at is not null) as archived,
--          count(*) as total
--   from public.ingredients where company_id = '<company uuid>';
