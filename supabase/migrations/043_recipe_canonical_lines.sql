-- 043_recipe_canonical_lines.sql
--
-- Recipes & Costing: one fixed internal recipe table. Every client cost
-- file is first translated into these rows (same columns for every dish);
-- the import creates ingredients, preparations and draft recipes from
-- them. Preparations (sub-recipes, side choices) are rows of the same
-- table with recipe_kind = 'preparation'; dish lines that use one carry
-- its recipe_key in preparation_key.
--
-- Also: a recipe line can carry its own unit cost. A client file often
-- prices the same ingredient differently on different tabs; each dish
-- keeps the cost of its own tab (and the conflict is flagged) instead of
-- one catalog price for every dish. NULL keeps today's behaviour (the
-- catalog price).
--
-- DESIGN: Additive. One new company-scoped table with RLS (same rule as
-- 038/039/042) and two nullable columns on each recipe-version input
-- table. No DROP, no ALTER of existing columns, no data changes.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 042. No production apply as
-- part of this PR.

CREATE TABLE IF NOT EXISTS public.recipe_canonical_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id            uuid NULL REFERENCES public.cost_import_batches(id) ON DELETE CASCADE,
  source_file         text NULL,
  recipe_key          text NOT NULL,
  recipe_kind         text NOT NULL,
  dish_name           text NOT NULL,
  size                text NULL,
  ingredient_name     text NOT NULL,
  unit                text NULL,
  quantity            numeric(14,6) NULL,
  unit_cost           numeric(14,8) NULL,
  line_total          numeric(14,6) NULL,
  excel_total_cost    numeric(14,6) NULL,
  excel_price_sin_iva numeric(14,6) NULL,
  source_tab          text NOT NULL,
  source_cell         text NOT NULL,
  flags               text[] NOT NULL DEFAULT '{}',
  preparation_key     text NULL,
  line_index          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_canonical_lines_kind_chk
    CHECK (recipe_kind IN ('dish', 'preparation'))
);

CREATE INDEX IF NOT EXISTS recipe_canonical_lines_company_batch_idx
  ON public.recipe_canonical_lines (company_id, batch_id);

CREATE INDEX IF NOT EXISTS recipe_canonical_lines_company_dish_idx
  ON public.recipe_canonical_lines (company_id, dish_name);

COMMENT ON TABLE public.recipe_canonical_lines IS
  'Canonical recipe table: every client cost file translated into the same columns (dish, size, ingredient, unit, quantity, unit cost, totals, source cell, flags). unit_cost NULL = Pendiente, never 0. Rows of one import share batch_id, so undoing the batch removes them.';

ALTER TABLE public.recipe_canonical_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'recipe_canonical_lines'
      AND policyname = 'recipe_canonical_lines_member'
  ) THEN
    CREATE POLICY recipe_canonical_lines_member ON public.recipe_canonical_lines
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.recipe_canonical_lines TO anon, authenticated, service_role;

ALTER TABLE public.recipe_version_inputs
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,8) NULL,
  ADD COLUMN IF NOT EXISTS cost_source text NULL;

ALTER TABLE public.component_recipe_version_inputs
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,8) NULL,
  ADD COLUMN IF NOT EXISTS cost_source text NULL;

COMMENT ON COLUMN public.recipe_version_inputs.unit_cost IS
  'Cost per one `unit` of this line, from the client file (its own tab). NULL = use the catalog price. Cleared when a person changes the line''s ingredient or unit.';
COMMENT ON COLUMN public.recipe_version_inputs.cost_source IS
  'Where unit_cost came from, e.g. "DE LA PARRILLA!E8".';
COMMENT ON COLUMN public.component_recipe_version_inputs.unit_cost IS
  'Cost per one `unit` of this line, from the client file (its own tab). NULL = use the catalog price.';
COMMENT ON COLUMN public.component_recipe_version_inputs.cost_source IS
  'Where unit_cost came from, e.g. "SUB RECETAS!E8".';
