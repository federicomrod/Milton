-- 035_workbook_cost_match.sql
--
-- Keep each imported dish / sub-recipe's Excel COSTO TOTAL (and the
-- per-unit footer or PRECIO DE VENTA SIN IVA) so Milton can compare its
-- computed cost after import. Mismatches must never silently feed
-- cockpit KPIs — only recipes that match the workbook count as costed.
--
-- DESIGN: Additive. No DROP. New nullable columns only.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 034. No production apply as part
-- of this PR.

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS workbook_cost_total numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_selling_price numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_computed_cost numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_cost_match text NULL;

ALTER TABLE public.recipes
  DROP CONSTRAINT IF EXISTS recipes_workbook_cost_match_chk;

ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_workbook_cost_match_chk
  CHECK (
    workbook_cost_match IS NULL
    OR workbook_cost_match IN ('match', 'mismatch')
  );

ALTER TABLE public.component_recipes
  ADD COLUMN IF NOT EXISTS workbook_cost_total numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_unit_price numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_computed_cost numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_cost_match text NULL;

ALTER TABLE public.component_recipes
  DROP CONSTRAINT IF EXISTS component_recipes_workbook_cost_match_chk;

ALTER TABLE public.component_recipes
  ADD CONSTRAINT component_recipes_workbook_cost_match_chk
  CHECK (
    workbook_cost_match IS NULL
    OR workbook_cost_match IN ('match', 'mismatch')
  );
