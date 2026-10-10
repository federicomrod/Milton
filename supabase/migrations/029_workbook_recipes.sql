-- 029_workbook_recipes.sql
--
-- Workbook import step 2 (GitHub #113): menu items, recipes, sub-recipes,
-- and POS links created by the same upload as ingredient costs. source_type
-- / source_id mark rows this importer created so a later file can update
-- them without overwriting recipes entered by hand. Undo reads those ids
-- from cost_import_batches.undo_snapshot (already jsonb).
--
-- Also allows tab_type = sub_recipe on remembered layout maps.
--
-- DESIGN: Additive. No DROP of tables. The only constraint replace is the
-- layout-map tab_type check, recreated with the extra token.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 028. No production apply as part
-- of this PR.

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS source_type text NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS source_type text NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

ALTER TABLE public.prepared_components
  ADD COLUMN IF NOT EXISTS source_type text NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

ALTER TABLE public.component_recipes
  ADD COLUMN IF NOT EXISTS source_type text NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

CREATE INDEX IF NOT EXISTS menu_items_source_id_idx
  ON public.menu_items (source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recipes_source_id_idx
  ON public.recipes (source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prepared_components_source_id_idx
  ON public.prepared_components (source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.cost_import_layout_maps
  DROP CONSTRAINT IF EXISTS cost_import_layout_maps_tab_type_check;

ALTER TABLE public.cost_import_layout_maps
  ADD CONSTRAINT cost_import_layout_maps_tab_type_check
  CHECK (tab_type IN (
    'price_list',
    'category_cost',
    'purchases',
    'recipe',
    'sub_recipe',
    'ignore'
  ));
