-- 056_ingredient_unit_conversions.sql
--
-- One price, several units. An ingredient is priced in one unit (PAPAS FRANCESAS
-- per oz) but used in others (taza). A person defines the bridge once:
-- «1 taza de PAPAS FRANCESAS = 5 oz». Costing then uses it when a line's unit
-- differs from the price unit and no standard conversion exists. Without a
-- conversion nothing is guessed: the line stays «Unidad distinta» / missing.
--
-- WHAT CHANGES (additive; no existing row is touched)
--   * ingredient_unit_conversions (company_id, ingredient_id, from_unit, to_unit,
--     factor, created_by, created_at). ONE direction is stored
--     («1 from_unit = factor to_unit»); the inverse is derived by the app.
--     Unique per (ingredient_id, from_unit, to_unit). factor > 0, from <> to.
--   * Company-scoped RLS through is_company_member. A non-member gets 42501 on
--     insert / update / delete (RLS violation) and sees no rows. Closed to anon.
--   * A conversion can only point at an ingredient of the SAME company
--     (composite foreign key).
--
-- SAFETY
--   * Until this is applied the app keeps working: no conversions are read,
--     «Definir conversión» says «falta aplicar la migración 056».
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.ingredient_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_unit_conversions_factor_positive CHECK (factor > 0),
  CONSTRAINT ingredient_unit_conversions_units_differ
    CHECK (lower(btrim(from_unit)) <> lower(btrim(to_unit))),
  CONSTRAINT ingredient_unit_conversions_unique
    UNIQUE (ingredient_id, from_unit, to_unit)
);

COMMENT ON TABLE public.ingredient_unit_conversions IS
  'Per-ingredient unit bridge: 1 from_unit = factor to_unit. One direction stored; the inverse is derived.';

CREATE INDEX IF NOT EXISTS ingredient_unit_conversions_company_idx
  ON public.ingredient_unit_conversions (company_id, ingredient_id);

-- The ingredient must belong to the same company as the conversion.
CREATE OR REPLACE FUNCTION public.ingredient_unit_conversions_same_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients
    WHERE id = NEW.ingredient_id AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Ese ingrediente no es de tu empresa.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingredient_unit_conversions_same_company_trg
  ON public.ingredient_unit_conversions;
CREATE TRIGGER ingredient_unit_conversions_same_company_trg
  BEFORE INSERT OR UPDATE ON public.ingredient_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION public.ingredient_unit_conversions_same_company();

ALTER TABLE public.ingredient_unit_conversions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'ingredient_unit_conversions'
      AND policyname = 'ingredient_unit_conversions_member') THEN
    CREATE POLICY ingredient_unit_conversions_member
      ON public.ingredient_unit_conversions FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.ingredient_unit_conversions TO authenticated, service_role;
REVOKE ALL ON TABLE public.ingredient_unit_conversions FROM anon;

-- Read-only checks (after applying):
--   select count(*) from public.ingredient_unit_conversions;
--   select has_table_privilege('anon', 'public.ingredient_unit_conversions', 'select');  -- must be false
--   select polname from pg_policy where polrelid = 'public.ingredient_unit_conversions'::regclass;
