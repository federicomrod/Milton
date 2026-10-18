-- 059_recipe_inputs_company_indexes.sql
--
-- Speed only. The company-wide recipe reads (the dish economics, the editor's
-- costing load, Menú, Cockpit) read the lines of EVERY version of a company:
--
--   select … from recipe_version_inputs           where company_id = $1
--   select … from component_recipe_version_inputs where company_id = $1
--
-- but those tables only had a per-version index (recipe_version_id /
-- component_recipe_version_id). With Supabase in a distant region every extra
-- scan counts; these two composite indexes serve the company filter directly
-- (and still serve the per-version lookup, whose column comes second).
--
-- ADDITIVE: two CREATE INDEX IF NOT EXISTS, no table or row is changed. The app
-- does NOT depend on this file: without it everything works, only slower.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

CREATE INDEX IF NOT EXISTS recipe_version_inputs_company_version_idx
  ON public.recipe_version_inputs (company_id, recipe_version_id);

CREATE INDEX IF NOT EXISTS component_recipe_version_inputs_company_version_idx
  ON public.component_recipe_version_inputs (company_id, component_recipe_version_id);

-- Read-only check (after applying):
--   select indexname from pg_indexes
--   where tablename in ('recipe_version_inputs', 'component_recipe_version_inputs')
--   order by 1;
