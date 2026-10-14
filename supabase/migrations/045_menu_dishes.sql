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
-- 3. menu_dishes_fill_variants(): saves Milton's grouping for the variants
--    that have none yet, in one call (one UPDATE + one INSERT), instead of
--    one request per variant. It never touches a variant that already has
--    a dish or an exclusion.
--
-- DESIGN: Additive. One new company-scoped table with RLS (same rule as
-- 038/039/042/043/044: public.is_company_member), six nullable columns
-- (is_event defaults to false) on pos_product_links and one SECURITY
-- INVOKER function (RLS still applies inside it). No DROP, no RENAME, no
-- ALTER of existing columns, no backfill: Milton fills the new columns
-- only where they are empty and never over a variant a person moved.
--
-- A variant can only point at a dish of its own company: the link's
-- (menu_dish_id, company_id) references menu_dishes (id, company_id).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 044. No production apply as
-- part of this PR. Until it is applied, Milton groups the variants in
-- memory on every load ("✦ Agrupado por Milton") and "Mover variante"
-- says it is not available yet. Needs PostgreSQL 15+ (ON DELETE SET NULL
-- with a column list).

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

-- Target of the company-safe reference from pos_product_links.
CREATE UNIQUE INDEX IF NOT EXISTS menu_dishes_id_company_uniq
  ON public.menu_dishes (id, company_id);

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
  ADD COLUMN IF NOT EXISTS menu_dish_id uuid NULL,
  ADD COLUMN IF NOT EXISTS portion_qty numeric(10,3) NULL,
  ADD COLUMN IF NOT EXISTS side_label text NULL,
  ADD COLUMN IF NOT EXISTS cooking_point text NULL,
  ADD COLUMN IF NOT EXISTS is_event boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text NULL;

-- The dish must belong to the link's company (a dish id from another
-- company is rejected by the database, not only by the app). Deleting a
-- dish clears only menu_dish_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_product_links_menu_dish_company_fk'
  ) THEN
    ALTER TABLE public.pos_product_links
      ADD CONSTRAINT pos_product_links_menu_dish_company_fk
      FOREIGN KEY (menu_dish_id, company_id)
      REFERENCES public.menu_dishes (id, company_id)
      ON DELETE SET NULL (menu_dish_id);
  END IF;
END
$$;

COMMENT ON COLUMN public.pos_product_links.menu_dish_id IS
  'The menu dish this POS variant belongs to. Set by Milton only when empty; a person''s move is never overwritten.';
COMMENT ON COLUMN public.pos_product_links.portion_qty IS
  'Portion of this variant in the dish''s base unit (6/8/12 oz, 2/3 personas). NULL = the base portion.';
COMMENT ON COLUMN public.pos_product_links.excluded_reason IS
  'Why the variant is out of food costing (bebida, extra, modificador, …). NULL = in.';

CREATE INDEX IF NOT EXISTS pos_product_links_menu_dish_idx
  ON public.pos_product_links (company_id, menu_dish_id)
  WHERE menu_dish_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Save Milton's grouping in one call
-- ---------------------------------------------------------------------------
-- p_rows: [{odoo_product_id, odoo_name, menu_dish_id, portion_qty,
--           side_label, cooking_point, is_event, excluded_reason}]
-- Only links with no dish and no exclusion are filled; a product with no
-- link at all gets a company-wide one. A restaurant-only dish only takes
-- that restaurant's links. Returns how many links were filled / created.

CREATE OR REPLACE FUNCTION public.menu_dishes_fill_variants(
  p_company_id uuid,
  p_rows jsonb
)
RETURNS TABLE (filled integer, created integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_filled integer := 0;
  v_created integer := 0;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;

  WITH r AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      odoo_product_id integer,
      odoo_name text,
      menu_dish_id uuid,
      portion_qty numeric,
      side_label text,
      cooking_point text,
      is_event boolean,
      excluded_reason text
    )
  ), up AS (
    UPDATE public.pos_product_links l
    SET menu_dish_id = r.menu_dish_id,
        portion_qty = r.portion_qty,
        side_label = r.side_label,
        cooking_point = r.cooking_point,
        is_event = COALESCE(r.is_event, false),
        excluded_reason = r.excluded_reason,
        updated_at = now()
    FROM r
    LEFT JOIN public.menu_dishes d
      ON d.id = r.menu_dish_id AND d.company_id = p_company_id
    WHERE l.company_id = p_company_id
      AND l.odoo_product_id = r.odoo_product_id
      AND l.menu_dish_id IS NULL
      AND l.excluded_reason IS NULL
      AND (r.menu_dish_id IS NULL OR d.id IS NOT NULL)
      AND (d.restaurant_id IS NULL OR d.restaurant_id = l.location_id)
    RETURNING l.id
  )
  SELECT count(*) INTO v_filled FROM up;

  WITH r AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      odoo_product_id integer,
      odoo_name text,
      menu_dish_id uuid,
      portion_qty numeric,
      side_label text,
      cooking_point text,
      is_event boolean,
      excluded_reason text
    )
  ), ins AS (
    INSERT INTO public.pos_product_links (
      company_id, location_id, odoo_product_id, odoo_name, menu_dish_id,
      portion_qty, side_label, cooking_point, is_event, excluded_reason
    )
    SELECT p_company_id, NULL, r.odoo_product_id, r.odoo_name,
           r.menu_dish_id, r.portion_qty, r.side_label, r.cooking_point,
           COALESCE(r.is_event, false), r.excluded_reason
    FROM r
    LEFT JOIN public.menu_dishes d
      ON d.id = r.menu_dish_id AND d.company_id = p_company_id
    WHERE r.odoo_name IS NOT NULL AND r.odoo_name <> ''
      AND (r.menu_dish_id IS NULL OR (d.id IS NOT NULL AND d.restaurant_id IS NULL))
      AND NOT EXISTS (
        SELECT 1 FROM public.pos_product_links l
        WHERE l.company_id = p_company_id
          AND l.odoo_product_id = r.odoo_product_id
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_created FROM ins;

  RETURN QUERY SELECT v_filled, v_created;
END
$$;

REVOKE ALL ON FUNCTION public.menu_dishes_fill_variants(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_dishes_fill_variants(uuid, jsonb) TO authenticated, service_role;
