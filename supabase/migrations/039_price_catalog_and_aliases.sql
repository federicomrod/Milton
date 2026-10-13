-- 039_price_catalog_and_aliases.sql
--
-- Recipes & Costing PR 2: ingredient price catalog + per-company name memory.
--
-- 1. ingredients: which cost entry a person chose when two sources
--    disagreed (nullable chosen_cost_entry_id / chosen_by / chosen_at).
--    The unchosen candidates stay in cost_import_review_items (raw_values)
--    so both values are preserved until someone decides. Only a chosen
--    value is ever written as a cost entry, so the "latest cost" lookup
--    cannot silently prefer a recipe-sheet number over the price list.
-- 2. ingredient_aliases: remembers "this typed or imported name means this
--    ingredient" (for example a typo a person already confirmed), per
--    company, so the same question is not asked twice.
--
-- DESIGN: Additive. New nullable columns on ingredients and one new table.
-- No DROP, no ALTER of existing columns, no data changes.
--
-- Currency: ingredients.currency and ingredient_cost_entries.currency
-- default to MXN. The application writes the company currency (for
-- example USD) explicitly on every row it creates; nothing here relies on
-- the default.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 038. No production apply as part
-- of this PR.

-- ---------------------------------------------------------------------------
-- 1. Chosen cost on ingredients
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS chosen_cost_entry_id uuid NULL
    REFERENCES public.ingredient_cost_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chosen_by uuid NULL,
  ADD COLUMN IF NOT EXISTS chosen_at timestamptz NULL;

COMMENT ON COLUMN public.ingredients.chosen_cost_entry_id IS
  'Cost entry a person chose when the price list and recipe sheets disagreed. NULL = nobody has decided (the price list value stays in force). Deleting the entry clears this.';

COMMENT ON COLUMN public.ingredients.chosen_by IS
  'User who chose the cost. Never set by an import or a suggestion.';

-- ---------------------------------------------------------------------------
-- 2. Ingredient name memory (per company)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ingredient_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  alias_key     text NOT NULL,
  alias_name    text NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_aliases_key_chk CHECK (alias_key <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ingredient_aliases_company_key_uniq
  ON public.ingredient_aliases (company_id, alias_key);

CREATE INDEX IF NOT EXISTS ingredient_aliases_ingredient_idx
  ON public.ingredient_aliases (company_id, ingredient_id);

COMMENT ON TABLE public.ingredient_aliases IS
  'Per-company memory of name -> ingredient (for example EMPANIZAOR -> EMPANIZADOR) that a person confirmed. alias_key is the normalised alias (upper case, no accents, single spaces).';

-- ---------------------------------------------------------------------------
-- 3. RLS — same company-member pattern as pos_product_links (038)
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredient_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ingredient_aliases'
      AND policyname = 'ingredient_aliases_member'
  ) THEN
    CREATE POLICY ingredient_aliases_member ON public.ingredient_aliases
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.ingredient_aliases TO anon, authenticated, service_role;
