-- 036_import_costing_fixes.sql
--
-- Import and costing follow-ups after #160 (issues #162 and #161):
--   * Store Excel variance in $ and % next to workbook_cost_match.
--   * Ingredient price effective_date + date_source so costing can
--     pick the price that was in force, not only cost_date.
--   * Recipe / component-recipe versions: the first approved version
--     applies to all loaded history; later approved versions apply
--     from their effective_date forward and never rewrite earlier
--     periods. A version in review does not replace the approved one.
--
-- DESIGN: Additive. No DROP of tables or columns. New nullable columns
-- and new version tables only. Existing ingredient_cost_entries rows
-- are backfilled with date_source = 'upload' and effective_date =
-- cost_date. Existing active recipes become version 1, approved, with
-- a NULL effective_date (applies to all history).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 035. No production apply as part
-- of this PR.

-- ---------------------------------------------------------------------------
-- 1. Excel variance on imported recipes
-- ---------------------------------------------------------------------------

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS workbook_variance_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_variance_pct numeric NULL,
  ADD COLUMN IF NOT EXISTS effective_date date NULL;

ALTER TABLE public.component_recipes
  ADD COLUMN IF NOT EXISTS workbook_variance_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS workbook_variance_pct numeric NULL,
  ADD COLUMN IF NOT EXISTS effective_date date NULL;

-- ---------------------------------------------------------------------------
-- 2. Ingredient price effective dates
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredient_cost_entries
  ADD COLUMN IF NOT EXISTS effective_date date NULL,
  ADD COLUMN IF NOT EXISTS date_source text NULL;

UPDATE public.ingredient_cost_entries
SET date_source = 'upload'
WHERE date_source IS NULL;

UPDATE public.ingredient_cost_entries
SET effective_date = cost_date
WHERE effective_date IS NULL AND cost_date IS NOT NULL;

ALTER TABLE public.ingredient_cost_entries
  DROP CONSTRAINT IF EXISTS ingredient_cost_entries_date_source_chk;

ALTER TABLE public.ingredient_cost_entries
  ADD CONSTRAINT ingredient_cost_entries_date_source_chk
  CHECK (
    date_source IS NULL
    OR date_source IN (
      'invoice',
      'dated_price_list',
      'upload',
      'confirmation',
      'manual'
    )
  );

CREATE INDEX IF NOT EXISTS ingredient_cost_entries_effective_date_idx
  ON public.ingredient_cost_entries (company_id, ingredient_id, effective_date DESC);

-- ---------------------------------------------------------------------------
-- 3. Recipe versions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  effective_date date NULL,
  serving_quantity numeric(14,4) NULL,
  serving_unit text NULL,
  notes text NULL,
  source_type text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_versions_status_chk
    CHECK (status IN ('approved', 'in_review')),
  CONSTRAINT recipe_versions_number_chk
    CHECK (version_number >= 1),
  CONSTRAINT recipe_versions_uniq UNIQUE (recipe_id, version_number)
);

CREATE INDEX IF NOT EXISTS recipe_versions_company_menu_idx
  ON public.recipe_versions (company_id, menu_item_id, version_number);

CREATE INDEX IF NOT EXISTS recipe_versions_recipe_idx
  ON public.recipe_versions (recipe_id, version_number);

CREATE TABLE IF NOT EXISTS public.recipe_version_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipe_version_id uuid NOT NULL REFERENCES public.recipe_versions(id) ON DELETE CASCADE,
  input_type text NOT NULL,
  ingredient_id uuid NULL,
  component_id uuid NULL,
  quantity numeric(14,4) NOT NULL,
  unit text NOT NULL,
  notes text NULL,
  CONSTRAINT recipe_version_inputs_type_chk
    CHECK (input_type IN ('ingredient', 'component'))
);

CREATE INDEX IF NOT EXISTS recipe_version_inputs_version_idx
  ON public.recipe_version_inputs (recipe_version_id);

CREATE TABLE IF NOT EXISTS public.component_recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  component_recipe_id uuid NOT NULL REFERENCES public.component_recipes(id) ON DELETE CASCADE,
  component_id uuid NOT NULL,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  effective_date date NULL,
  output_quantity numeric(14,4) NOT NULL,
  output_unit text NOT NULL,
  source_type text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_recipe_versions_status_chk
    CHECK (status IN ('approved', 'in_review')),
  CONSTRAINT component_recipe_versions_number_chk
    CHECK (version_number >= 1),
  CONSTRAINT component_recipe_versions_uniq UNIQUE (component_recipe_id, version_number)
);

CREATE INDEX IF NOT EXISTS component_recipe_versions_component_idx
  ON public.component_recipe_versions (company_id, component_id, version_number);

CREATE TABLE IF NOT EXISTS public.component_recipe_version_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  component_recipe_version_id uuid NOT NULL
    REFERENCES public.component_recipe_versions(id) ON DELETE CASCADE,
  input_type text NOT NULL,
  ingredient_id uuid NULL,
  component_id uuid NULL,
  quantity numeric(14,4) NOT NULL,
  unit text NOT NULL,
  notes text NULL,
  CONSTRAINT component_recipe_version_inputs_type_chk
    CHECK (input_type IN ('ingredient', 'component'))
);

CREATE INDEX IF NOT EXISTS component_recipe_version_inputs_version_idx
  ON public.component_recipe_version_inputs (component_recipe_version_id);

-- First approved version of each existing recipe: applies to all history.
INSERT INTO public.recipe_versions (
  company_id,
  recipe_id,
  menu_item_id,
  version_number,
  status,
  effective_date,
  serving_quantity,
  serving_unit,
  notes,
  source_type
)
SELECT
  r.company_id,
  r.id,
  r.menu_item_id,
  1,
  'approved',
  NULL,
  r.serving_quantity,
  r.serving_unit,
  r.notes,
  r.source_type
FROM public.recipes r
WHERE NOT EXISTS (
  SELECT 1 FROM public.recipe_versions v WHERE v.recipe_id = r.id
);

INSERT INTO public.recipe_version_inputs (
  company_id,
  recipe_version_id,
  input_type,
  ingredient_id,
  component_id,
  quantity,
  unit,
  notes
)
SELECT
  i.company_id,
  v.id,
  i.input_type,
  i.ingredient_id,
  i.component_id,
  i.quantity,
  i.unit,
  i.notes
FROM public.menu_recipe_inputs i
JOIN public.recipe_versions v
  ON v.recipe_id = i.recipe_id
 AND v.version_number = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM public.recipe_version_inputs vi
  WHERE vi.recipe_version_id = v.id
);

INSERT INTO public.component_recipe_versions (
  company_id,
  component_recipe_id,
  component_id,
  version_number,
  status,
  effective_date,
  output_quantity,
  output_unit,
  source_type
)
SELECT
  c.company_id,
  c.id,
  c.component_id,
  1,
  'approved',
  NULL,
  c.output_quantity,
  c.output_unit,
  c.source_type
FROM public.component_recipes c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.component_recipe_versions v
  WHERE v.component_recipe_id = c.id
);

INSERT INTO public.component_recipe_version_inputs (
  company_id,
  component_recipe_version_id,
  input_type,
  ingredient_id,
  component_id,
  quantity,
  unit,
  notes
)
SELECT
  i.company_id,
  v.id,
  i.input_type,
  i.ingredient_id,
  i.component_id,
  i.quantity,
  i.unit,
  i.notes
FROM public.component_recipe_inputs i
JOIN public.component_recipe_versions v
  ON v.component_recipe_id = i.component_recipe_id
 AND v.version_number = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM public.component_recipe_version_inputs vi
  WHERE vi.component_recipe_version_id = v.id
);

-- ---------------------------------------------------------------------------
-- 4. RLS — same company-member pattern as recipes / cost_import_* 
-- ---------------------------------------------------------------------------

ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_version_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_recipe_version_inputs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'recipe_versions'
      AND policyname = 'recipe_versions_member'
  ) THEN
    CREATE POLICY recipe_versions_member ON public.recipe_versions
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'recipe_version_inputs'
      AND policyname = 'recipe_version_inputs_member'
  ) THEN
    CREATE POLICY recipe_version_inputs_member ON public.recipe_version_inputs
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'component_recipe_versions'
      AND policyname = 'component_recipe_versions_member'
  ) THEN
    CREATE POLICY component_recipe_versions_member
      ON public.component_recipe_versions
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'component_recipe_version_inputs'
      AND policyname = 'component_recipe_version_inputs_member'
  ) THEN
    CREATE POLICY component_recipe_version_inputs_member
      ON public.component_recipe_version_inputs
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.recipe_versions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.recipe_version_inputs TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.component_recipe_versions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.component_recipe_version_inputs TO anon, authenticated, service_role;
