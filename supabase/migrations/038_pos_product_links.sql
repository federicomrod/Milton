-- 038_pos_product_links.sql
--
-- Plan B PR 1 (#163 / #162): POS is the source of truth for what is sold.
-- New pos_product_links table holds classification and the human-confirmed
-- link from an Odoo product to a menu item / recipe. Only a person moves
-- a link to Confirmado. Only Confirmado + Aprobada counts toward margins.
--
-- Also: nullable menu_items.odoo_product_id, and nullable combo parent
-- columns on pos_sales_items so Odoo 18 native combo lines keep their
-- parent-child relation (parent price 0, children carry the price).
--
-- DESIGN: Additive. No DROP of tables. No ALTER of existing columns
-- (types, nullability, defaults, or constraints). New table + new
-- nullable columns only.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 037. No production apply as part
-- of this PR.

-- ---------------------------------------------------------------------------
-- 1. POS product links (Odoo product → recipe, human-confirmed)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pos_product_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id uuid NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  odoo_product_id integer NOT NULL,
  odoo_name text NOT NULL,
  classification text NOT NULL DEFAULT 'por_clasificar',
  menu_item_id uuid NULL REFERENCES public.menu_items(id) ON DELETE SET NULL,
  link_state text NOT NULL DEFAULT 'sin_vincular',
  confirmed_by uuid NULL,
  confirmed_at timestamptz NULL,
  confirmed_how text NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_product_links_classification_chk
    CHECK (
      classification IN (
        'por_clasificar',
        'requiere_receta',
        'componente',
        'no_requiere_costeo'
      )
    ),
  CONSTRAINT pos_product_links_link_state_chk
    CHECK (link_state IN ('sin_vincular', 'sugerido', 'confirmado')),
  CONSTRAINT pos_product_links_confirmado_chk
    CHECK (
      (
        link_state = 'confirmado'
        AND confirmed_by IS NOT NULL
        AND confirmed_at IS NOT NULL
        AND confirmed_how IS NOT NULL
      )
      OR (
        link_state <> 'confirmado'
        AND confirmed_by IS NULL
        AND confirmed_at IS NULL
        AND confirmed_how IS NULL
      )
    )
);

-- Location-aware uniqueness, same split as pos_item_mappings:
-- a plain UNIQUE(company_id, location_id, odoo_product_id) would not
-- stop duplicate company-wide rows because NULL is never equal to NULL.
CREATE UNIQUE INDEX IF NOT EXISTS pos_product_links_location_uniq
  ON public.pos_product_links (company_id, location_id, odoo_product_id)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_product_links_company_wide_uniq
  ON public.pos_product_links (company_id, odoo_product_id)
  WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS pos_product_links_company_idx
  ON public.pos_product_links (company_id, odoo_product_id);

CREATE INDEX IF NOT EXISTS pos_product_links_menu_item_idx
  ON public.pos_product_links (company_id, menu_item_id)
  WHERE menu_item_id IS NOT NULL;

COMMENT ON TABLE public.pos_product_links IS
  'Odoo POS product → recipe link. POS is the source of truth. Only a person sets link_state=confirmado (confirmed_by/at/how required). Only Confirmado + Aprobada counts toward margins.';

COMMENT ON COLUMN public.pos_product_links.classification IS
  'por_clasificar | requiere_receta | componente | no_requiere_costeo';

COMMENT ON COLUMN public.pos_product_links.link_state IS
  'sin_vincular | sugerido | confirmado. confirmado is never written without a person.';

COMMENT ON COLUMN public.pos_product_links.confirmed_how IS
  'How a person confirmed (e.g. manual, milton_staff_on_behalf). Required when confirmado.';

COMMENT ON COLUMN public.pos_product_links.evidence IS
  'Suggestion evidence (fuzzy/AI match). Never enough to confirm the link.';

-- ---------------------------------------------------------------------------
-- 2. Nullable Odoo product id on menu items (no existing-column changes)
-- ---------------------------------------------------------------------------

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS odoo_product_id integer NULL;

CREATE INDEX IF NOT EXISTS menu_items_odoo_product_idx
  ON public.menu_items (company_id, odoo_product_id)
  WHERE odoo_product_id IS NOT NULL;

COMMENT ON COLUMN public.menu_items.odoo_product_id IS
  'Optional Odoo product.product id. The confirmed link lives on pos_product_links; this column does not confirm a link.';

-- ---------------------------------------------------------------------------
-- 3. Nullable combo parent fields on POS sales rows
-- ---------------------------------------------------------------------------

ALTER TABLE public.pos_sales_items
  ADD COLUMN IF NOT EXISTS combo_parent_external_line_id text NULL,
  ADD COLUMN IF NOT EXISTS combo_parent_odoo_product_id integer NULL;

CREATE INDEX IF NOT EXISTS pos_sales_items_combo_parent_idx
  ON public.pos_sales_items (company_id, combo_parent_external_line_id)
  WHERE combo_parent_external_line_id IS NOT NULL;

COMMENT ON COLUMN public.pos_sales_items.combo_parent_external_line_id IS
  'Odoo pos.order.line id of the native combo parent. NULL on older Odoo and on stand-alone lines.';

COMMENT ON COLUMN public.pos_sales_items.combo_parent_odoo_product_id IS
  'Odoo product.product id of the combo parent. Child line sales roll up to this product.';

-- ---------------------------------------------------------------------------
-- 4. RLS — same company-member pattern as recipes / pos_item_mappings
-- ---------------------------------------------------------------------------

ALTER TABLE public.pos_product_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pos_product_links'
      AND policyname = 'pos_product_links_member'
  ) THEN
    CREATE POLICY pos_product_links_member ON public.pos_product_links
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.pos_product_links TO anon, authenticated, service_role;
