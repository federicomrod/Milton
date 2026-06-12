-- 004_menu_recipe_foundation.sql
--
-- Menu & Recipes foundation.
--
-- This migration introduces the structural layer that sits between raw
-- POS sales and future costing:
--   * prepared_components       — sub-products that are made in-house
--                                 (smoked brisket, mac & cheese batch, …)
--   * component_recipes         — how to make one batch of a component
--   * component_recipe_inputs   — ingredient OR another component inputs
--   * menu_recipe_inputs        — replacement for recipe_ingredients
--                                 that accepts ingredient OR component
--   * pos_item_mappings         — canonical raw_item_name → menu_items.id
--   * supplier_ingredients      — many-to-many supplier↔ingredient
--
-- We DO NOT touch:
--   * pos_sales_items           — POS layer is stable.
--   * suppliers / supplier_invoices / supplier_invoice_lines — costing
--                                 will land in a later migration.
--   * recipe_ingredients        — kept for backward-compat with any
--                                 legacy reads; new code uses
--                                 menu_recipe_inputs.
--
-- IMPORTANT: this file lives in the repo for history. Supabase migrations
-- are not yet applied from the repo by CI, so the SQL below must also be
-- pasted manually into the Supabase SQL Editor — see the task report.
--
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS …
-- CREATE POLICY …) so re-running this migration is safe.

-- ---------------------------------------------------------------------------
-- menu_items: add optional fields used by the matching flow.
--
-- The existing menu_items.status column already uses 'active'/'inactive',
-- which doesn't match the draft/active/archived vocabulary used elsewhere
-- in this milestone. Documented limitation: we keep the existing column
-- and surface "draft" only as a derived state (no recipe linked yet) in
-- the dashboard, rather than risk breaking other code that reads .status.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Drop NOT NULL on brand_id if present so the dashboard can create menu
  -- items for tenants that don't have a brand row yet. We only relax it,
  -- never strengthen — safe to re-run.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menu_items'
      AND column_name = 'brand_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.menu_items ALTER COLUMN brand_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sub_category text,
  -- pos_display_name lets a menu item declare a default alias for POS
  -- matching beyond pos_item_mappings; the dashboard suggests this when
  -- a name differs only by casing/punctuation.
  ADD COLUMN IF NOT EXISTS pos_display_name text;

-- ---------------------------------------------------------------------------
-- prepared_components
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prepared_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      text,
  output_unit   text NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prepared_components_status_chk
    CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT prepared_components_uniq
    UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prepared_components_company
  ON public.prepared_components(company_id);

-- ---------------------------------------------------------------------------
-- component_recipes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.component_recipes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  component_id      uuid NOT NULL REFERENCES public.prepared_components(id) ON DELETE CASCADE,
  name              text NOT NULL,
  output_quantity   numeric(14,4) NOT NULL,
  output_unit       text NOT NULL,
  -- yield_percentage encodes shrinkage during preparation (e.g. raw brisket
  -- 100 kg → smoked brisket 65 kg yields 65). Optional; calculations should
  -- fall back to output_quantity/inputs sum when null.
  yield_percentage  numeric(8,4),
  status            text NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT component_recipes_status_chk
    CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT component_recipes_yield_chk
    CHECK (yield_percentage IS NULL OR (yield_percentage > 0 AND yield_percentage <= 100)),
  CONSTRAINT component_recipes_uniq
    UNIQUE (company_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_component_recipes_company
  ON public.component_recipes(company_id);

-- ---------------------------------------------------------------------------
-- component_recipe_inputs: each row is either an ingredient OR another
-- prepared component. The XOR is enforced by a CHECK constraint so we
-- can't accidentally point at both.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.component_recipe_inputs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  component_recipe_id  uuid NOT NULL REFERENCES public.component_recipes(id) ON DELETE CASCADE,
  input_type           text NOT NULL,
  ingredient_id        uuid REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  component_id         uuid REFERENCES public.prepared_components(id) ON DELETE RESTRICT,
  quantity             numeric(14,4) NOT NULL,
  unit                 text NOT NULL,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT component_recipe_inputs_type_chk
    CHECK (input_type IN ('ingredient', 'component')),
  CONSTRAINT component_recipe_inputs_qty_chk
    CHECK (quantity > 0),
  CONSTRAINT component_recipe_inputs_xor_chk
    CHECK (
      (input_type = 'ingredient' AND ingredient_id IS NOT NULL AND component_id IS NULL)
      OR
      (input_type = 'component'  AND component_id IS NOT NULL AND ingredient_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_component_recipe_inputs_recipe
  ON public.component_recipe_inputs(component_recipe_id);
CREATE INDEX IF NOT EXISTS idx_component_recipe_inputs_company
  ON public.component_recipe_inputs(company_id);

-- ---------------------------------------------------------------------------
-- menu_recipe_inputs: like recipe_ingredients but the input can be either
-- a raw ingredient OR a prepared component. We keep the legacy
-- recipe_ingredients table untouched for backward compat; new code reads
-- and writes menu_recipe_inputs.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.menu_recipe_inputs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipe_id      uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  input_type     text NOT NULL,
  ingredient_id  uuid REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  component_id   uuid REFERENCES public.prepared_components(id) ON DELETE RESTRICT,
  quantity       numeric(14,4) NOT NULL,
  unit           text NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT menu_recipe_inputs_type_chk
    CHECK (input_type IN ('ingredient', 'component')),
  CONSTRAINT menu_recipe_inputs_qty_chk
    CHECK (quantity > 0),
  CONSTRAINT menu_recipe_inputs_xor_chk
    CHECK (
      (input_type = 'ingredient' AND ingredient_id IS NOT NULL AND component_id IS NULL)
      OR
      (input_type = 'component'  AND component_id IS NOT NULL AND ingredient_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_menu_recipe_inputs_recipe
  ON public.menu_recipe_inputs(recipe_id);
CREATE INDEX IF NOT EXISTS idx_menu_recipe_inputs_company
  ON public.menu_recipe_inputs(company_id);

-- recipes: add status + serving fields if missing.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS serving_quantity numeric(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serving_unit text NOT NULL DEFAULT 'portion';

-- Add the status check if it's not already there. Wrapped in a DO block
-- because Postgres doesn't have ADD CONSTRAINT IF NOT EXISTS pre-15.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipes_status_chk'
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_status_chk
      CHECK (status IN ('draft', 'active', 'archived'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- pos_item_mappings: canonical mapping from a raw POS item name (as it
-- appears in pos_sales_items.raw_item_name) to a menu_items row.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pos_item_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  raw_pos_item_name   text NOT NULL,
  menu_item_id        uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  match_type          text NOT NULL DEFAULT 'manual',
  -- 0..1 confidence — only meaningful for suggested/auto matches.
  confidence          numeric(5,4),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_item_mappings_match_type_chk
    CHECK (match_type IN ('manual', 'suggested', 'auto')),
  CONSTRAINT pos_item_mappings_confidence_chk
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- One canonical mapping per raw name per company. Rebinding to a
  -- different menu item is an UPDATE, not an INSERT, so the unmatched
  -- list stays unambiguous.
  CONSTRAINT pos_item_mappings_uniq
    UNIQUE (company_id, raw_pos_item_name)
);

CREATE INDEX IF NOT EXISTS idx_pos_item_mappings_company
  ON public.pos_item_mappings(company_id);
CREATE INDEX IF NOT EXISTS idx_pos_item_mappings_menu_item
  ON public.pos_item_mappings(menu_item_id);

-- ---------------------------------------------------------------------------
-- supplier_ingredients: many-to-many supplier↔ingredient so a single raw
-- material can be sourced from multiple suppliers with different SKUs.
-- The existing ingredients.supplier_id column stays as a "primary supplier"
-- hint; this table is for the multi-source case.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_ingredients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id           uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  ingredient_id         uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  supplier_item_name    text,
  supplier_sku          text,
  preferred             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_ingredients_uniq
    UNIQUE (company_id, supplier_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_ingredients_company
  ON public.supplier_ingredients(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ingredients_ingredient
  ON public.supplier_ingredients(ingredient_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (optional — only attach if helper exists)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_prepared_components_updated_at ON public.prepared_components;
    CREATE TRIGGER trg_prepared_components_updated_at
      BEFORE UPDATE ON public.prepared_components
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    DROP TRIGGER IF EXISTS trg_component_recipes_updated_at ON public.component_recipes;
    CREATE TRIGGER trg_component_recipes_updated_at
      BEFORE UPDATE ON public.component_recipes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    DROP TRIGGER IF EXISTS trg_pos_item_mappings_updated_at ON public.pos_item_mappings;
    CREATE TRIGGER trg_pos_item_mappings_updated_at
      BEFORE UPDATE ON public.pos_item_mappings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    DROP TRIGGER IF EXISTS trg_supplier_ingredients_updated_at ON public.supplier_ingredients;
    CREATE TRIGGER trg_supplier_ingredients_updated_at
      BEFORE UPDATE ON public.supplier_ingredients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — every new table is company-scoped via the existing
-- public.is_company_member(uuid) helper. If your project doesn't have it,
-- replace each predicate with the inline equivalent:
--   company_id IN (SELECT company_id FROM public.company_memberships WHERE user_id = auth.uid())
-- ---------------------------------------------------------------------------

ALTER TABLE public.prepared_components      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_recipes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_recipe_inputs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_recipe_inputs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_item_mappings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_ingredients     ENABLE ROW LEVEL SECURITY;

-- Helper: do nothing if a policy of the given name already exists; this
-- keeps the migration idempotent without hand-coding DROP POLICY for each.
DO $$
DECLARE
  t text;
  op text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'prepared_components',
      'component_recipes',
      'component_recipe_inputs',
      'menu_recipe_inputs',
      'pos_item_mappings',
      'supplier_ingredients'
    ])
  LOOP
    FOR op IN SELECT unnest(ARRAY['select','insert','update','delete'])
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        t || '_' || op, t
      );
    END LOOP;
  END LOOP;
END $$;

-- prepared_components
CREATE POLICY prepared_components_select  ON public.prepared_components
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY prepared_components_insert  ON public.prepared_components
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY prepared_components_update  ON public.prepared_components
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY prepared_components_delete  ON public.prepared_components
  FOR DELETE  USING (public.is_company_member(company_id));

-- component_recipes
CREATE POLICY component_recipes_select    ON public.component_recipes
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY component_recipes_insert    ON public.component_recipes
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY component_recipes_update    ON public.component_recipes
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY component_recipes_delete    ON public.component_recipes
  FOR DELETE  USING (public.is_company_member(company_id));

-- component_recipe_inputs
CREATE POLICY component_recipe_inputs_select ON public.component_recipe_inputs
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY component_recipe_inputs_insert ON public.component_recipe_inputs
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY component_recipe_inputs_update ON public.component_recipe_inputs
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY component_recipe_inputs_delete ON public.component_recipe_inputs
  FOR DELETE  USING (public.is_company_member(company_id));

-- menu_recipe_inputs
CREATE POLICY menu_recipe_inputs_select ON public.menu_recipe_inputs
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY menu_recipe_inputs_insert ON public.menu_recipe_inputs
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY menu_recipe_inputs_update ON public.menu_recipe_inputs
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY menu_recipe_inputs_delete ON public.menu_recipe_inputs
  FOR DELETE  USING (public.is_company_member(company_id));

-- pos_item_mappings
CREATE POLICY pos_item_mappings_select ON public.pos_item_mappings
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY pos_item_mappings_insert ON public.pos_item_mappings
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY pos_item_mappings_update ON public.pos_item_mappings
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY pos_item_mappings_delete ON public.pos_item_mappings
  FOR DELETE  USING (public.is_company_member(company_id));

-- supplier_ingredients
CREATE POLICY supplier_ingredients_select ON public.supplier_ingredients
  FOR SELECT  USING (public.is_company_member(company_id));
CREATE POLICY supplier_ingredients_insert ON public.supplier_ingredients
  FOR INSERT  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY supplier_ingredients_update ON public.supplier_ingredients
  FOR UPDATE  USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
CREATE POLICY supplier_ingredients_delete ON public.supplier_ingredients
  FOR DELETE  USING (public.is_company_member(company_id));
