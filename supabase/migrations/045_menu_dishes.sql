-- 045_menu_dishes.sql
--
-- R1-10 "Plato del menú": a menu dish groups the POS variants (Odoo
-- products) of one dish: size, side, cooking point, event. The POS has
-- ~400 products; the real menu has ~30–60 dishes. Coverage, margin and
-- problems are read per menu dish. Output of board issue #210 (menu
-- matching).
--
-- 1. menu_dishes: one row per dish of the client's menu. Owned by the
--    company (both restaurants share dishes); restaurant_id ties one to a
--    single restaurant when it only exists there. recipe_id points at the
--    dish's recipe (recipe_versions stay per recipe, as today).
-- 2. pos_product_links: which menu dish a variant belongs to and its
--    attributes (portion, side, cooking point, event), or why it is
--    excluded (bebidas, extras, modificadores…).
--
-- DESIGN: Additive. One new company-scoped table with RLS (same rule as
-- 038/039/042/043/044: public.is_company_member) and six nullable columns
-- (is_event defaults to false) on pos_product_links. No DROP, no RENAME,
-- no ALTER of existing columns, no backfill: Milton fills the new columns
-- only where they are empty and never over a variant a person moved.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 044. No production apply as
-- part of this PR. Until it is applied, Milton groups the variants in
-- memory on every load ("✦ Agrupado por Milton") and "Mover variante"
-- says it is not available yet.

CREATE TABLE IF NOT EXISTS public.menu_dishes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  restaurant_id     uuid NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  category          text NULL,
  recipe_id         uuid NULL REFERENCES public.recipes(id) ON DELETE SET NULL,
  base_portion_qty  numeric(10,3) NULL,
  base_portion_unit text NULL,
  source            text NOT NULL DEFAULT 'name',
  status            text NOT NULL DEFAULT 'suggested',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_dishes_name_chk CHECK (name <> ''),
  CONSTRAINT menu_dishes_source_chk CHECK (source IN ('excel', 'menu', 'name')),
  CONSTRAINT menu_dishes_status_chk
    CHECK (status IN ('suggested', 'confirmed', 'excluded'))
);

COMMENT ON TABLE public.menu_dishes IS
  'A dish of the client''s menu: the parent of its POS variants (size, side, cooking point, event). Suggested by Milton from the POS names, the cost file and the menu; a person confirms or moves variants.';
COMMENT ON COLUMN public.menu_dishes.restaurant_id IS
  'NULL = the dish is on every restaurant''s menu; set = only that restaurant.';
COMMENT ON COLUMN public.menu_dishes.base_portion_qty IS
  'Portion the recipe is written for (e.g. 6 oz, 2 personas). A variant of another size scales only the protein line.';

CREATE UNIQUE INDEX IF NOT EXISTS menu_dishes_company_name_uniq
  ON public.menu_dishes (company_id, COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX IF NOT EXISTS menu_dishes_company_idx
  ON public.menu_dishes (company_id);

ALTER TABLE public.menu_dishes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_dishes'
      AND policyname = 'menu_dishes_member'
  ) THEN
    CREATE POLICY menu_dishes_member ON public.menu_dishes
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.menu_dishes TO anon, authenticated, service_role;

ALTER TABLE public.pos_product_links
  ADD COLUMN IF NOT EXISTS menu_dish_id uuid NULL
    REFERENCES public.menu_dishes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portion_qty numeric(10,3) NULL,
  ADD COLUMN IF NOT EXISTS side_label text NULL,
  ADD COLUMN IF NOT EXISTS cooking_point text NULL,
  ADD COLUMN IF NOT EXISTS is_event boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text NULL;

COMMENT ON COLUMN public.pos_product_links.menu_dish_id IS
  'The menu dish this POS variant belongs to. Set by Milton only when empty; a person''s move is never overwritten.';
COMMENT ON COLUMN public.pos_product_links.portion_qty IS
  'Portion of this variant in the dish''s base unit (6/8/12 oz, 2/3 personas). NULL = the base portion.';
COMMENT ON COLUMN public.pos_product_links.excluded_reason IS
  'Why the variant is out of food costing (bebida, extra, modificador, …). NULL = in.';

CREATE INDEX IF NOT EXISTS pos_product_links_menu_dish_idx
  ON public.pos_product_links (company_id, menu_dish_id)
  WHERE menu_dish_id IS NOT NULL;
