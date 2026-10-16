-- 057_adopt_legacy_line_prices.sql
--
-- ONE current price per ingredient: ingredient_cost_entries (latest effective,
-- with history and supplier) is the only source of an ingredient line's price.
-- Old recipe lines carry their own copy of a price (recipe_version_inputs /
-- component_recipe_version_inputs .unit_cost, mostly from the client's cost
-- workbook, «Costo Unitario»). The app stops reading those copies for
-- ingredient lines (a line with a copy and no cost entry is «Sin precio» with a
-- «Precio antiguo de la receta» offer). This file helps clean up what is
-- already there.
--
-- WHAT IS ADDED (additive; no existing row is changed or deleted)
--   * legacy_unit_base(unit)                 helper: family + factor to g / ml.
--   * legacy_line_price_report(company)      DRY RUN. One row per ingredient with
--                                            line copies: what would happen.
--   * adopt_legacy_line_prices(company, dry) inserts ONE cost entry for an
--                                            ingredient that has NO entry when all
--                                            its line copies agree (within 0.5%
--                                            after unit conversion). Ingredients
--                                            whose copies disagree, or are in
--                                            incompatible units, get NOTHING and are
--                                            listed for a person. Ingredients that
--                                            already have an entry are left alone.
--                                            Idempotent: a second run adds nothing.
--   * legacy_current_unit_cost_report(company) read-only: ingredients.current_unit_cost
--                                            values that differ from the latest entry.
--                                            The app no longer reads that column.
--
-- NOT DONE ON PURPOSE
--   * Line unit_cost / cost_source are NOT nulled: the app ignores them for
--     ingredient lines, so they are harmless and this is fully undoable.
--     Removing them is a later step.
--   * ingredients.current_unit_cost is NOT changed.
--
-- SAFETY
--   * SECURITY INVOKER: every statement runs through the caller's RLS.
--   * Not a member of the company: 42501 (nothing is read or written). The ONLY
--     exception is a call with no auth.uid() made by the trusted roles postgres
--     or service_role (the SQL Editor, a migration, a job): they have no
--     membership and are let through. Anyone else, including anon and an
--     authenticated user of another company, still gets 42501. current_user is
--     the caller's role because the functions are SECURITY INVOKER.
--   * Closed to anon / PUBLIC.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor, then FIRST
-- run the dry run:
--     select * from public.legacy_line_price_report('<company uuid>');
--     select public.adopt_legacy_line_prices('<company uuid>', true);   -- dry run
--     select public.adopt_legacy_line_prices('<company uuid>', false);  -- applies
--     select * from public.legacy_current_unit_cost_report('<company uuid>');

-- ---------------------------------------------------------------------------
-- Units: family and factor to the family's base (g for weight, ml for volume).
-- Anything else is its own family (the unit text): no conversion is guessed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.legacy_unit_base(
  p_unit text,
  OUT family text,
  OUT factor numeric
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    CASE lower(btrim(coalesce(p_unit, '')))
      WHEN 'kg' THEN 'weight' WHEN 'g' THEN 'weight'
      WHEN 'lb' THEN 'weight' WHEN 'oz' THEN 'weight'
      WHEN 'l' THEN 'volume' WHEN 'ml' THEN 'volume' WHEN 'gal' THEN 'volume'
      ELSE 'other:' || lower(btrim(coalesce(p_unit, '')))
    END,
    CASE lower(btrim(coalesce(p_unit, '')))
      WHEN 'kg' THEN 1000::numeric WHEN 'g' THEN 1::numeric
      WHEN 'lb' THEN 453.59237::numeric WHEN 'oz' THEN 28.349523125::numeric
      WHEN 'l' THEN 1000::numeric WHEN 'ml' THEN 1::numeric
      WHEN 'gal' THEN 3785.411784::numeric
      ELSE 1::numeric
    END
$$;

-- ---------------------------------------------------------------------------
-- Dry run: what the cleanup would do, one row per ingredient with line copies.
--   status = 'has_entry'    the ingredient already has a cost entry: left alone
--            'adopt'        no entry, all copies agree: ONE entry would be added
--            'disagree'     no entry, copies differ: a person decides
--            'mixed_units'  no entry, copies in incompatible units: a person decides
-- Which versions are read: the APPROVED version costing uses today (the first
-- approved one covers all history; a later approved one wins from its
-- effective_date, as in pickApprovedVersion) AND the newest version (the draft
-- the editor shows). If either carries a different price the ingredient is a
-- «disagree»: a draft never decides alone, and neither does an old approval.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.legacy_line_price_report(p_company uuid)
RETURNS TABLE (
  ingredient_id uuid,
  ingredient_name text,
  status text,
  lines integer,
  unit text,
  unit_cost numeric,
  min_per_base numeric,
  max_per_base numeric,
  family text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_company IS NULL OR NOT (
       public.is_company_member(p_company)
       OR (auth.uid() IS NULL AND current_user IN ('postgres', 'service_role'))
     ) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ap_v AS (
    SELECT rv.id, rv.recipe_id, rv.version_number, rv.effective_date
    FROM public.recipe_versions rv
    WHERE rv.company_id = p_company AND rv.status = 'approved'
  ),
  first_v AS (
    SELECT DISTINCT ON (a.recipe_id) a.id, a.recipe_id
    FROM ap_v a
    ORDER BY a.recipe_id, (a.effective_date IS NOT NULL), a.version_number
  ),
  later_v AS (
    SELECT DISTINCT ON (a.recipe_id) a.id, a.recipe_id
    FROM ap_v a
    WHERE a.effective_date IS NOT NULL AND a.effective_date <= current_date
    ORDER BY a.recipe_id, a.effective_date DESC, a.version_number DESC
  ),
  newest_v AS (
    SELECT DISTINCT ON (rv.recipe_id) rv.id
    FROM public.recipe_versions rv
    WHERE rv.company_id = p_company
    ORDER BY rv.recipe_id, rv.version_number DESC
  ),
  latest_v AS (
    SELECT coalesce(l.id, f.id) AS id
    FROM first_v f
    LEFT JOIN later_v l ON l.recipe_id = f.recipe_id
    UNION
    SELECT n.id FROM newest_v n
  ),
  ap_c AS (
    SELECT cv.id, cv.component_recipe_id, cv.version_number, cv.effective_date
    FROM public.component_recipe_versions cv
    WHERE cv.company_id = p_company AND cv.status = 'approved'
  ),
  first_c AS (
    SELECT DISTINCT ON (a.component_recipe_id) a.id, a.component_recipe_id
    FROM ap_c a
    ORDER BY a.component_recipe_id, (a.effective_date IS NOT NULL), a.version_number
  ),
  later_c AS (
    SELECT DISTINCT ON (a.component_recipe_id) a.id, a.component_recipe_id
    FROM ap_c a
    WHERE a.effective_date IS NOT NULL AND a.effective_date <= current_date
    ORDER BY a.component_recipe_id, a.effective_date DESC, a.version_number DESC
  ),
  newest_c AS (
    SELECT DISTINCT ON (cv.component_recipe_id) cv.id
    FROM public.component_recipe_versions cv
    WHERE cv.company_id = p_company
    ORDER BY cv.component_recipe_id, cv.version_number DESC
  ),
  latest_cv AS (
    SELECT coalesce(l.id, f.id) AS id
    FROM first_c f
    LEFT JOIN later_c l ON l.component_recipe_id = f.component_recipe_id
    UNION
    SELECT n.id FROM newest_c n
  ),
  copies AS (
    SELECT i.ingredient_id AS ing_id, i.unit AS u, i.unit_cost AS c
    FROM public.recipe_version_inputs i
    WHERE i.recipe_version_id IN (SELECT lv.id FROM latest_v lv)
      AND i.company_id = p_company
      AND i.input_type = 'ingredient'
      AND i.ingredient_id IS NOT NULL
      AND i.unit_cost IS NOT NULL AND i.unit_cost > 0
    UNION ALL
    SELECT i.ingredient_id, i.unit, i.unit_cost
    FROM public.component_recipe_version_inputs i
    WHERE i.component_recipe_version_id IN (SELECT lc.id FROM latest_cv lc)
      AND i.company_id = p_company
      AND i.input_type = 'ingredient'
      AND i.ingredient_id IS NOT NULL
      AND i.unit_cost IS NOT NULL AND i.unit_cost > 0
  ),
  based AS (
    SELECT c.ing_id, c.u, c.c, b.family AS fam, c.c / b.factor AS per_base
    FROM copies c
    CROSS JOIN LATERAL public.legacy_unit_base(c.u) b
  ),
  agg AS (
    SELECT
      b.ing_id,
      count(*)::integer AS n,
      count(DISTINCT b.fam)::integer AS families,
      min(b.per_base) AS mn,
      max(b.per_base) AS mx,
      -- representative copy: the highest one (a copy that agrees is within 0.5%)
      (array_agg(b.u ORDER BY b.per_base DESC))[1] AS rep_unit,
      (array_agg(b.c ORDER BY b.per_base DESC))[1] AS rep_cost,
      (array_agg(b.fam ORDER BY b.per_base DESC))[1] AS rep_family
    FROM based b
    GROUP BY b.ing_id
  )
  SELECT
    a.ing_id,
    ing.name::text,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.ingredient_cost_entries e
        WHERE e.company_id = p_company AND e.ingredient_id = a.ing_id
      ) THEN 'has_entry'
      WHEN a.families > 1 THEN 'mixed_units'
      WHEN (a.mx - a.mn) <= 0.005 * a.mx THEN 'adopt'
      ELSE 'disagree'
    END,
    a.n,
    a.rep_unit::text,
    a.rep_cost,
    a.mn,
    a.mx,
    a.rep_family::text
  FROM agg a
  JOIN public.ingredients ing
    ON ing.id = a.ing_id AND ing.company_id = p_company
  ORDER BY ing.name;
END;
$$;

-- ---------------------------------------------------------------------------
-- The cleanup. p_dry_run = true reports and writes nothing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adopt_legacy_line_prices(
  p_company uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r record;
  v_unit text;
  v_cost numeric;
  v_default text;
  v_adopted jsonb := '[]'::jsonb;
  v_disagree jsonb;
  v_mixed jsonb;
  v_has integer;
  v_base_fam text;
  v_default_fam text;
  v_default_factor numeric;
  v_rep_factor numeric;
  v_currency text;
BEGIN
  IF p_company IS NULL OR NOT (
       public.is_company_member(p_company)
       OR (auth.uid() IS NULL AND current_user IN ('postgres', 'service_role'))
     ) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT * FROM public.legacy_line_price_report(p_company)
    WHERE status = 'adopt'
  LOOP
    SELECT ing.default_unit, ing.currency INTO v_default, v_currency
    FROM public.ingredients ing
    WHERE ing.id = r.ingredient_id AND ing.company_id = p_company;

    -- In the ingredient's own unit when it is the same family (oz copies on an
    -- ingredient bought in lb); otherwise in the unit of the copies.
    v_unit := r.unit;
    v_cost := r.unit_cost;
    IF v_default IS NOT NULL THEN
      SELECT b.family, b.factor INTO v_default_fam, v_default_factor
      FROM public.legacy_unit_base(v_default) b;
      SELECT b.factor INTO v_rep_factor FROM public.legacy_unit_base(r.unit) b;
      IF v_default_fam = r.family AND v_default_fam NOT LIKE 'other:%' THEN
        v_unit := v_default;
        v_cost := (r.unit_cost / v_rep_factor) * v_default_factor;
      END IF;
    END IF;

    IF NOT p_dry_run THEN
      INSERT INTO public.ingredient_cost_entries (
        company_id, ingredient_id, supplier_id, source_type, source_id,
        cost_date, effective_date, date_source,
        quantity, unit, total_cost, unit_cost,
        normalized_unit, normalized_unit_cost, currency, notes
      ) VALUES (
        p_company, r.ingredient_id, NULL, 'manual', NULL,
        current_date, current_date, 'manual',
        1, v_unit, v_cost, v_cost,
        v_unit, v_cost, coalesce(v_currency, 'USD'),
        'Adoptado del precio de línea'
      );
    END IF;

    v_adopted := v_adopted || jsonb_build_array(jsonb_build_object(
      'ingredient_id', r.ingredient_id,
      'name', r.ingredient_name,
      'unit', v_unit,
      'unit_cost', v_cost,
      'lines', r.lines
    ));
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id', x.ingredient_id, 'name', x.ingredient_name,
           'lines', x.lines, 'min_per_base', x.min_per_base,
           'max_per_base', x.max_per_base)), '[]'::jsonb)
    INTO v_disagree
  FROM public.legacy_line_price_report(p_company) x
  WHERE x.status = 'disagree';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id', x.ingredient_id, 'name', x.ingredient_name,
           'lines', x.lines)), '[]'::jsonb)
    INTO v_mixed
  FROM public.legacy_line_price_report(p_company) x
  WHERE x.status = 'mixed_units';

  SELECT count(*)::integer INTO v_has
  FROM public.legacy_line_price_report(p_company) x
  WHERE x.status = 'has_entry';

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'adopted', v_adopted,
    'disagree', v_disagree,
    'mixed_units', v_mixed,
    'left_alone_with_entry', v_has
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- ingredients.current_unit_cost: a legacy cache the app no longer reads.
-- Read-only report of the values that differ from the latest cost entry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.legacy_current_unit_cost_report(p_company uuid)
RETURNS TABLE (
  ingredient_id uuid,
  ingredient_name text,
  current_unit_cost numeric,
  default_unit text,
  latest_unit_cost numeric,
  latest_unit text,
  differs boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_company IS NULL OR NOT (
       public.is_company_member(p_company)
       OR (auth.uid() IS NULL AND current_user IN ('postgres', 'service_role'))
     ) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (e.ingredient_id)
      e.ingredient_id AS ing_id, e.normalized_unit_cost AS c, e.normalized_unit AS u
    FROM public.ingredient_cost_entries e
    WHERE e.company_id = p_company
    ORDER BY e.ingredient_id, e.effective_date DESC NULLS LAST,
             e.cost_date DESC, e.created_at DESC
  )
  SELECT
    ing.id,
    ing.name::text,
    ing.current_unit_cost::numeric,
    ing.default_unit::text,
    l.c,
    l.u::text,
    CASE
      WHEN l.c IS NULL THEN true
      WHEN (SELECT family FROM public.legacy_unit_base(ing.default_unit))
           <> (SELECT family FROM public.legacy_unit_base(l.u)) THEN true
      ELSE abs(
        ing.current_unit_cost / (SELECT factor FROM public.legacy_unit_base(ing.default_unit))
        - l.c / (SELECT factor FROM public.legacy_unit_base(l.u))
      ) > 0.0001 * greatest(
        l.c / (SELECT factor FROM public.legacy_unit_base(l.u)), 0.000001)
    END
  FROM public.ingredients ing
  LEFT JOIN latest l ON l.ing_id = ing.id
  WHERE ing.company_id = p_company
    AND ing.current_unit_cost IS NOT NULL
    AND ing.current_unit_cost > 0
  ORDER BY ing.name;
END;
$$;

REVOKE ALL ON FUNCTION public.legacy_unit_base(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legacy_line_price_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adopt_legacy_line_prices(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legacy_current_unit_cost_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_unit_base(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legacy_line_price_report(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_legacy_line_prices(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legacy_current_unit_cost_report(uuid) TO authenticated, service_role;

-- Read-only checks (after applying):
--   select has_function_privilege('anon', 'public.adopt_legacy_line_prices(uuid,boolean)', 'execute');  -- must be false
