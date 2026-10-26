-- 062_milton_estimates.sql
--
-- «Estimar con Milton» (issue #212). For a dish with no recipe, Milton
-- proposes quantities for one plate and a typical restaurant purchase price
-- per ingredient. These are an OVERLAY, never real figures:
--
--   restaurant_dish_estimates   one estimate per dish (menu_item): the lines
--                               [{raw_name, ingredient_id|null, qty, unit,
--                               price_source: real|estimado|null, unit_price,
--                               price_unit, price_estimate_id, line_cost,
--                               confidence}], the portion note and est_cost
--                               (NULL = «Sin precio», never 0).
--   ingredient_price_estimates  one estimated price per (company, normalized
--                               name, unit). A real price always wins; this
--                               is never written to ingredient_cost_entries.
--
-- Nothing here changes a dish's real status, an approved recipe, margins,
-- coverage, COGS or any KPI.
--
-- DESIGN: Additive. Two new company-scoped tables with RLS
-- (public.is_company_member). No DROP, no ALTER of existing tables, no data
-- changes. odoo_product_id is integer, like pos_product_links (038).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging first; production only after Fede and Miles say yes.

CREATE TABLE IF NOT EXISTS public.restaurant_dish_estimates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  menu_item_id     uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  location_id      uuid NULL,
  odoo_product_id  integer NULL,
  menu_source_id   uuid NULL,
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb,
  portion_note     text NULL,
  est_cost         numeric NULL,
  currency         text NULL,
  model            text NULL,
  used_as_draft_at timestamptz NULL,
  created_by       uuid NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_dish_estimates_company_item_uniq
    UNIQUE (company_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS restaurant_dish_estimates_company_idx
  ON public.restaurant_dish_estimates (company_id);

COMMENT ON TABLE public.restaurant_dish_estimates IS
  'Estimado por Milton for a dish with no recipe: an overlay, never a real figure. est_cost NULL means Sin precio. Does not change the dish status or any KPI.';

CREATE TABLE IF NOT EXISTS public.ingredient_price_estimates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_id  uuid NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  name_key       text NOT NULL,
  unit           text NOT NULL,
  unit_price     numeric NOT NULL,
  currency       text NULL,
  country        text NULL,
  model          text NULL,
  rationale      text NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_price_estimates_price_chk CHECK (unit_price > 0),
  CONSTRAINT ingredient_price_estimates_company_name_unit_uniq
    UNIQUE (company_id, name_key, unit)
);

CREATE INDEX IF NOT EXISTS ingredient_price_estimates_company_idx
  ON public.ingredient_price_estimates (company_id);

COMMENT ON TABLE public.ingredient_price_estimates IS
  'Precio estimado por Milton per ingredient name and unit. Never a real price: a real ingredient_cost_entries price always wins and this is never copied there.';

ALTER TABLE public.restaurant_dish_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_price_estimates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  op text;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurant_dish_estimates', 'ingredient_price_estimates']
  LOOP
    FOREACH op IN ARRAY ARRAY['select', 'insert', 'update', 'delete']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
          AND policyname = t || '_member_' || op
      ) THEN
        IF op = 'select' OR op = 'delete' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR %s USING (public.is_company_member(company_id))',
            t || '_member_' || op, t, upper(op));
        ELSIF op = 'insert' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_company_member(company_id))',
            t || '_member_' || op, t);
        ELSE
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id))',
            t || '_member_' || op, t);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

GRANT ALL ON TABLE public.restaurant_dish_estimates TO authenticated, service_role;
GRANT ALL ON TABLE public.ingredient_price_estimates TO authenticated, service_role;
