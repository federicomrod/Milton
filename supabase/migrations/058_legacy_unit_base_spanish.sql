-- 058_legacy_unit_base_spanish.sql
--
-- OPTIONAL follow-up to 057. legacy_unit_base() (used by the legacy line-price
-- report and adopt_legacy_line_prices) only knew the English tokens (oz, lb, g,
-- kg, l, ml, gal). Line copies written with the Spanish labels of the client
-- workbook (onza, libra, gramo, litro, unidad…) were classed «mixed_units» or
-- kept their raw label. This makes the helper know them.
--
-- WHAT CHANGES (additive: CREATE OR REPLACE of one IMMUTABLE helper)
--   * onza/onzas → oz, libra/libras → lb, gramo(s)/gr → g, kilo(s)/kilogramo(s)
--     → kg, litro(s)/lt → l, mililitro(s) → ml, galón/galon/galones → gal,
--     unidad(es)/unit/ud/pieza(s)/pza → one «count» family (factor 1).
--   * Nothing is re-adopted automatically and no row is written: run the report
--     again (select * from public.legacy_line_price_report('<company uuid>')) and
--     decide. Same signature as in 057 (the callers do not change).
--
-- SAFETY: pure function, no table access. Closed to anon / PUBLIC like 057.
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.legacy_unit_base(
  p_unit text,
  OUT family text,
  OUT factor numeric
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH u AS (
    SELECT CASE lower(btrim(coalesce(p_unit, '')))
      WHEN 'oz' THEN 'oz' WHEN 'onza' THEN 'oz' WHEN 'onzas' THEN 'oz'
      WHEN 'lb' THEN 'lb' WHEN 'libra' THEN 'lb' WHEN 'libras' THEN 'lb'
      WHEN 'g' THEN 'g' WHEN 'gr' THEN 'g' WHEN 'gramo' THEN 'g' WHEN 'gramos' THEN 'g'
      WHEN 'kg' THEN 'kg' WHEN 'kilo' THEN 'kg' WHEN 'kilos' THEN 'kg'
      WHEN 'kilogramo' THEN 'kg' WHEN 'kilogramos' THEN 'kg'
      WHEN 'l' THEN 'l' WHEN 'lt' THEN 'l' WHEN 'litro' THEN 'l' WHEN 'litros' THEN 'l'
      WHEN 'ml' THEN 'ml' WHEN 'mililitro' THEN 'ml' WHEN 'mililitros' THEN 'ml'
      WHEN 'gal' THEN 'gal' WHEN 'galon' THEN 'gal' WHEN 'galón' THEN 'gal'
      WHEN 'galones' THEN 'gal'
      WHEN 'unit' THEN 'unit' WHEN 'unidad' THEN 'unit' WHEN 'unidades' THEN 'unit'
      WHEN 'ud' THEN 'unit' WHEN 'pieza' THEN 'unit' WHEN 'piezas' THEN 'unit'
      WHEN 'pza' THEN 'unit'
      ELSE lower(btrim(coalesce(p_unit, '')))
    END AS k
  )
  SELECT
    CASE k
      WHEN 'kg' THEN 'weight' WHEN 'g' THEN 'weight'
      WHEN 'lb' THEN 'weight' WHEN 'oz' THEN 'weight'
      WHEN 'l' THEN 'volume' WHEN 'ml' THEN 'volume' WHEN 'gal' THEN 'volume'
      WHEN 'unit' THEN 'count'
      ELSE 'other:' || k
    END,
    CASE k
      WHEN 'kg' THEN 1000::numeric WHEN 'g' THEN 1::numeric
      WHEN 'lb' THEN 453.59237::numeric WHEN 'oz' THEN 28.349523125::numeric
      WHEN 'l' THEN 1000::numeric WHEN 'ml' THEN 1::numeric
      WHEN 'gal' THEN 3785.411784::numeric
      ELSE 1::numeric
    END
  FROM u
$$;

REVOKE ALL ON FUNCTION public.legacy_unit_base(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_unit_base(text) TO authenticated, service_role;
