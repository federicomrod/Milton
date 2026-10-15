-- 051_ingredient_duplicates_merge.sql
--
-- R1-15k (Limpieza de ingredientes, part 2): possible duplicate ingredients
-- ("ACEITE DE OLIVA" / "ACEITE DE OIVA"), and Unir (merge) with a full undo.
--
-- NEEDS 050 (ingredients.archived_at): a merged-away ingredient is archived,
-- never deleted.
--
-- ADDITIVE ONLY. Three new tables and three functions; no existing table is
-- altered, nothing dropped, renamed or backfilled. All company-scoped, RLS
-- through is_company_member.
--
--   ingredient_duplicate_suggestions  the queue: pending / skipped (Ahora no) /
--                                     accepted / rejected, one row per set of
--                                     ingredients (set_key = sorted ids).
--   ingredient_not_duplicates         pairs a person said are NOT the same
--                                     ("No son iguales"): never suggested again,
--                                     also after re-imports.
--   ingredient_merges                 the undo log of every merge.
--
--   ingredient_merge(...)       ONE transaction: repoint every recipe line (dishes
--                               and preparations), cost entries, invoice-line
--                               matches and aliases of the losers to the survivor,
--                               remember the losers' names as aliases (the importer
--                               already reads ingredient_aliases), set the chosen
--                               price, archive the losers, write the undo record.
--   ingredient_merge_undo(...)  puts all of it back exactly (lines, prices,
--                               aliases, archive state); a row that someone moved
--                               somewhere else since is left alone.
--   ingredient_duplicate_decide(...)  skip / reject a suggestion in one step.
--
-- SAFETY
--   * SECURITY INVOKER: every statement runs through the caller's RLS.
--   * Not a member of the company: error 42501 (and nothing is read or written).
--   * Closed to anon/PUBLIC.
--   * Costs are not stored: dishes and preparations are costed when read, from
--     their lines and the survivor's price, so they are recomputed by the next
--     read (the app also clears its caches after a merge or an undo).
--   * A line keeps its own unit and quantity (a merge never converts them); the
--     undo record keeps them anyway. This also holds for APPROVED and MANUAL
--     recipe lines: only the ingredient reference moves, nothing else on the
--     line changes, and the move is logged and undoable.
--   * UNIT FAMILIES ARE ENFORCED HERE, not only in the suggestions: a merge of
--     ingredients whose units are of different families (weight / volume /
--     count / portion) is refused with SQLSTATE 22023 and a message in Spanish,
--     whoever calls it (the survivor's price must apply to every line).
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor after 050.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ingredient_duplicate_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_ids uuid[] NOT NULL,
  set_key text NOT NULL,
  source text NOT NULL DEFAULT 'name',
  score numeric(6,3) NULL,
  status text NOT NULL DEFAULT 'pending',
  skipped_at timestamptz NULL,
  decided_by uuid NULL,
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_duplicate_suggestions_status_chk
    CHECK (status IN ('pending', 'skipped', 'accepted', 'rejected')),
  CONSTRAINT ingredient_duplicate_suggestions_source_chk
    CHECK (source IN ('name', 'ai')),
  CONSTRAINT ingredient_duplicate_suggestions_size_chk
    CHECK (cardinality(ingredient_ids) >= 2 AND cardinality(ingredient_ids) <= 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS ingredient_duplicate_suggestions_set_uniq
  ON public.ingredient_duplicate_suggestions (company_id, set_key);

CREATE INDEX IF NOT EXISTS ingredient_duplicate_suggestions_open_idx
  ON public.ingredient_duplicate_suggestions (company_id)
  WHERE status IN ('pending', 'skipped');

CREATE TABLE IF NOT EXISTS public.ingredient_not_duplicates (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_a uuid NOT NULL,
  ingredient_b uuid NOT NULL,
  decided_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, ingredient_a, ingredient_b),
  CONSTRAINT ingredient_not_duplicates_order_chk CHECK (ingredient_a < ingredient_b)
);

CREATE TABLE IF NOT EXISTS public.ingredient_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  survivor_id uuid NOT NULL,
  loser_ids uuid[] NOT NULL,
  survivor_name text NOT NULL,
  loser_names text[] NOT NULL,
  suggestion_id uuid NULL,
  payload jsonb NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz NULL,
  undone_by uuid NULL
);

CREATE INDEX IF NOT EXISTS ingredient_merges_company_idx
  ON public.ingredient_merges (company_id, created_at DESC);

ALTER TABLE public.ingredient_duplicate_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_not_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_merges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'ingredient_duplicate_suggestions'
      AND policyname = 'ingredient_duplicate_suggestions_member') THEN
    CREATE POLICY ingredient_duplicate_suggestions_member
      ON public.ingredient_duplicate_suggestions FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'ingredient_not_duplicates'
      AND policyname = 'ingredient_not_duplicates_member') THEN
    CREATE POLICY ingredient_not_duplicates_member
      ON public.ingredient_not_duplicates FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'ingredient_merges'
      AND policyname = 'ingredient_merges_member') THEN
    CREATE POLICY ingredient_merges_member
      ON public.ingredient_merges FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.ingredient_duplicate_suggestions TO authenticated, service_role;
GRANT ALL ON TABLE public.ingredient_not_duplicates TO authenticated, service_role;
GRANT ALL ON TABLE public.ingredient_merges TO authenticated, service_role;
REVOKE ALL ON TABLE public.ingredient_duplicate_suggestions FROM anon;
REVOKE ALL ON TABLE public.ingredient_not_duplicates FROM anon;
REVOKE ALL ON TABLE public.ingredient_merges FROM anon;

-- ---------------------------------------------------------------------------
-- Unit family of an ingredient (canonical units, as stored)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingredient_unit_family(p_unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_unit, '')))
    WHEN 'kg' THEN 'weight' WHEN 'g' THEN 'weight' WHEN 'lb' THEN 'weight' WHEN 'oz' THEN 'weight'
    WHEN 'l' THEN 'volume' WHEN 'ml' THEN 'volume' WHEN 'gal' THEN 'volume'
    WHEN 'unit' THEN 'count'
    WHEN 'portion' THEN 'portion'
    ELSE 'unknown'
  END
$$;

-- ---------------------------------------------------------------------------
-- ingredient_merge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingredient_merge(
  p_company_id uuid,
  p_survivor_id uuid,
  p_loser_ids uuid[],
  p_chosen_cost_entry_id uuid DEFAULT NULL,
  p_aliases jsonb DEFAULT '[]'::jsonb,
  p_suggestion_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_losers uuid[];
  v_found integer;
  v_survivor_name text;
  v_loser_names text[];
  v_vi jsonb; v_ci jsonb; v_ce jsonb; v_il jsonb; v_al jsonb;
  v_ins jsonb; v_arch jsonb; v_chosen jsonb;
  v_merge_id uuid;
  v_lines integer;
  v_families text[];
  v_bad record;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_losers
    FROM unnest(p_loser_ids) AS x WHERE x IS NOT NULL;
  IF p_survivor_id IS NULL OR cardinality(v_losers) < 1 OR cardinality(v_losers) > 20 THEN
    RAISE EXCEPTION 'choose a survivor and 1 to 20 ingredients to merge' USING ERRCODE = '22023';
  END IF;
  IF p_survivor_id = ANY (v_losers) THEN
    RAISE EXCEPTION 'the survivor cannot be merged into itself' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_found FROM public.ingredients
    WHERE company_id = p_company_id AND id = ANY (v_losers || p_survivor_id);
  IF v_found <> cardinality(v_losers) + 1 THEN
    RAISE EXCEPTION 'unknown ingredient for this company' USING ERRCODE = '22023';
  END IF;
  -- Same unit family only (an ingredient with an unknown unit fits any). The
  -- unit is the ingredient's own, or its latest price's when it has none.
  WITH u AS (
    SELECT i.id, i.name,
      public.ingredient_unit_family(COALESCE(
        i.default_unit,
        (SELECT e.normalized_unit FROM public.ingredient_cost_entries e
          WHERE e.company_id = p_company_id AND e.ingredient_id = i.id
          ORDER BY e.cost_date DESC, e.created_at DESC LIMIT 1)
      )) AS fam
    FROM public.ingredients i
    WHERE i.company_id = p_company_id AND i.id = ANY (v_losers || p_survivor_id)
  )
  SELECT array_agg(DISTINCT fam) FILTER (WHERE fam <> 'unknown') INTO v_families FROM u;
  IF COALESCE(cardinality(v_families), 0) > 1 THEN
    SELECT a.name AS a_name, a.fam AS a_fam, b.name AS b_name, b.fam AS b_fam INTO v_bad
    FROM (
      SELECT i.name, public.ingredient_unit_family(COALESCE(i.default_unit,
        (SELECT e.normalized_unit FROM public.ingredient_cost_entries e
          WHERE e.company_id = p_company_id AND e.ingredient_id = i.id
          ORDER BY e.cost_date DESC, e.created_at DESC LIMIT 1))) AS fam
      FROM public.ingredients i
      WHERE i.company_id = p_company_id AND i.id = ANY (v_losers || p_survivor_id)
    ) a
    JOIN (
      SELECT i.name, public.ingredient_unit_family(COALESCE(i.default_unit,
        (SELECT e.normalized_unit FROM public.ingredient_cost_entries e
          WHERE e.company_id = p_company_id AND e.ingredient_id = i.id
          ORDER BY e.cost_date DESC, e.created_at DESC LIMIT 1))) AS fam
      FROM public.ingredients i
      WHERE i.company_id = p_company_id AND i.id = ANY (v_losers || p_survivor_id)
    ) b ON a.fam <> 'unknown' AND b.fam <> 'unknown' AND a.fam < b.fam
    LIMIT 1;
    RAISE EXCEPTION 'No se pueden unir ingredientes de familias de unidad distintas: «%» (%) y «%» (%). Revisa que sean el mismo producto en la misma unidad.',
      v_bad.a_name,
      CASE v_bad.a_fam WHEN 'weight' THEN 'peso' WHEN 'volume' THEN 'volumen' WHEN 'count' THEN 'unidades' ELSE 'porciones' END,
      v_bad.b_name,
      CASE v_bad.b_fam WHEN 'weight' THEN 'peso' WHEN 'volume' THEN 'volumen' WHEN 'count' THEN 'unidades' ELSE 'porciones' END
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ingredients
             WHERE company_id = p_company_id AND id = p_survivor_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the survivor is archived: restore it first' USING ERRCODE = '22023';
  END IF;
  IF p_chosen_cost_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ingredient_cost_entries
    WHERE id = p_chosen_cost_entry_id AND company_id = p_company_id
      AND ingredient_id = ANY (v_losers || p_survivor_id)
  ) THEN
    RAISE EXCEPTION 'the chosen price is not one of these ingredients'' prices' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_survivor_name FROM public.ingredients
    WHERE id = p_survivor_id AND company_id = p_company_id;
  SELECT COALESCE(array_agg(name ORDER BY name), '{}') INTO v_loser_names
    FROM public.ingredients WHERE company_id = p_company_id AND id = ANY (v_losers);

  -- 1. Recipe lines of dishes and preparations: record, then repoint.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'from', ingredient_id, 'unit', unit, 'quantity', quantity)), '[]'::jsonb)
    INTO v_vi FROM public.recipe_version_inputs
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  UPDATE public.recipe_version_inputs SET ingredient_id = p_survivor_id
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'from', ingredient_id, 'unit', unit, 'quantity', quantity)), '[]'::jsonb)
    INTO v_ci FROM public.component_recipe_version_inputs
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  UPDATE public.component_recipe_version_inputs SET ingredient_id = p_survivor_id
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  v_lines := v_lines + COALESCE((SELECT jsonb_array_length(v_ci)), 0);

  -- 2. Price history and invoice-line matches follow the survivor.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'from', ingredient_id)), '[]'::jsonb)
    INTO v_ce FROM public.ingredient_cost_entries
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  UPDATE public.ingredient_cost_entries SET ingredient_id = p_survivor_id
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'from', ingredient_id)), '[]'::jsonb)
    INTO v_il FROM public.supplier_invoice_lines
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  UPDATE public.supplier_invoice_lines SET ingredient_id = p_survivor_id
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);

  -- 3. Names: the losers' own aliases follow, and each loser's name becomes an
  --    alias of the survivor (an alias that already points elsewhere is kept).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'from', ingredient_id)), '[]'::jsonb)
    INTO v_al FROM public.ingredient_aliases
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);
  UPDATE public.ingredient_aliases SET ingredient_id = p_survivor_id
    WHERE company_id = p_company_id AND ingredient_id = ANY (v_losers);

  WITH ins AS (
    INSERT INTO public.ingredient_aliases (company_id, alias_key, alias_name, ingredient_id, created_by)
    SELECT p_company_id, a->>'alias_key', a->>'alias_name', p_survivor_id, auth.uid()
    FROM jsonb_array_elements(COALESCE(p_aliases, '[]'::jsonb)) AS a
    WHERE COALESCE(a->>'alias_key', '') <> '' AND COALESCE(a->>'alias_name', '') <> ''
    ON CONFLICT (company_id, alias_key) DO NOTHING
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_ins FROM ins;

  -- 4. The price a person chose (never an average, never silent).
  SELECT jsonb_build_object('before_entry', chosen_cost_entry_id, 'before_by', chosen_by, 'before_at', chosen_at)
    INTO v_chosen FROM public.ingredients
    WHERE id = p_survivor_id AND company_id = p_company_id;
  IF p_chosen_cost_entry_id IS NOT NULL THEN
    UPDATE public.ingredients
      SET chosen_cost_entry_id = p_chosen_cost_entry_id, chosen_by = auth.uid(), chosen_at = now()
      WHERE id = p_survivor_id AND company_id = p_company_id;
  END IF;

  -- 5. The losers are archived, never deleted.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'before', archived_at)), '[]'::jsonb)
    INTO v_arch FROM public.ingredients
    WHERE company_id = p_company_id AND id = ANY (v_losers);
  UPDATE public.ingredients SET archived_at = now()
    WHERE company_id = p_company_id AND id = ANY (v_losers);

  IF p_suggestion_id IS NOT NULL THEN
    UPDATE public.ingredient_duplicate_suggestions
      SET status = 'accepted', decided_by = auth.uid(), decided_at = now()
      WHERE id = p_suggestion_id AND company_id = p_company_id;
  END IF;

  INSERT INTO public.ingredient_merges (
    company_id, survivor_id, loser_ids, survivor_name, loser_names,
    suggestion_id, payload, created_by
  ) VALUES (
    p_company_id, p_survivor_id, v_losers, v_survivor_name, v_loser_names,
    p_suggestion_id,
    jsonb_build_object(
      'version_inputs', v_vi, 'component_inputs', v_ci, 'cost_entries', v_ce,
      'invoice_lines', v_il, 'aliases_moved', v_al, 'aliases_inserted', v_ins,
      'archived', v_arch, 'chosen', v_chosen
    ),
    auth.uid()
  ) RETURNING id INTO v_merge_id;

  RETURN jsonb_build_object(
    'merge_id', v_merge_id,
    'lines_repointed', v_lines,
    'cost_entries_moved', jsonb_array_length(v_ce),
    'aliases_added', jsonb_array_length(v_ins)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- ingredient_merge_undo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingredient_merge_undo(
  p_company_id uuid,
  p_merge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  m public.ingredient_merges%ROWTYPE;
  v_lines integer := 0;
  n integer;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.ingredient_merges
    WHERE id = p_merge_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown merge' USING ERRCODE = '22023';
  END IF;
  IF m.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'this merge was already undone' USING ERRCODE = '22023';
  END IF;

  -- Lines go back to the ingredient they came from (only those still on the
  -- survivor: a line someone moved elsewhere since is left alone).
  UPDATE public.recipe_version_inputs t SET ingredient_id = (e->>'from')::uuid
    FROM jsonb_array_elements(m.payload->'version_inputs') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id
      AND t.ingredient_id = m.survivor_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_lines := v_lines + n;
  UPDATE public.component_recipe_version_inputs t SET ingredient_id = (e->>'from')::uuid
    FROM jsonb_array_elements(m.payload->'component_inputs') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id
      AND t.ingredient_id = m.survivor_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_lines := v_lines + n;

  UPDATE public.ingredient_cost_entries t SET ingredient_id = (e->>'from')::uuid
    FROM jsonb_array_elements(m.payload->'cost_entries') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id
      AND t.ingredient_id = m.survivor_id;
  UPDATE public.supplier_invoice_lines t SET ingredient_id = (e->>'from')::uuid
    FROM jsonb_array_elements(m.payload->'invoice_lines') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id
      AND t.ingredient_id = m.survivor_id;
  UPDATE public.ingredient_aliases t SET ingredient_id = (e->>'from')::uuid
    FROM jsonb_array_elements(m.payload->'aliases_moved') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id
      AND t.ingredient_id = m.survivor_id;
  DELETE FROM public.ingredient_aliases t
    USING jsonb_array_elements_text(m.payload->'aliases_inserted') e
    WHERE t.id = e::uuid AND t.company_id = p_company_id;

  -- Archive state and the chosen price as they were.
  UPDATE public.ingredients t SET archived_at = NULLIF(e->>'before', '')::timestamptz
    FROM jsonb_array_elements(m.payload->'archived') e
    WHERE t.id = (e->>'id')::uuid AND t.company_id = p_company_id;
  UPDATE public.ingredients SET
      chosen_cost_entry_id = NULLIF(m.payload->'chosen'->>'before_entry', '')::uuid,
      chosen_by = NULLIF(m.payload->'chosen'->>'before_by', '')::uuid,
      chosen_at = NULLIF(m.payload->'chosen'->>'before_at', '')::timestamptz
    WHERE id = m.survivor_id AND company_id = p_company_id;

  IF m.suggestion_id IS NOT NULL THEN
    UPDATE public.ingredient_duplicate_suggestions
      SET status = 'pending', decided_by = NULL, decided_at = NULL
      WHERE id = m.suggestion_id AND company_id = p_company_id;
  END IF;

  UPDATE public.ingredient_merges SET undone_at = now(), undone_by = auth.uid()
    WHERE id = m.id;

  RETURN jsonb_build_object('merge_id', m.id, 'lines_restored', v_lines);
END;
$$;

-- ---------------------------------------------------------------------------
-- ingredient_duplicate_decide: "Ahora no" (skip) and "No son iguales" (reject)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingredient_duplicate_decide(
  p_company_id uuid,
  p_ingredient_ids uuid[],
  p_action text,
  p_source text DEFAULT 'name',
  p_score numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_key text;
  a uuid;
  b uuid;
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('skip', 'reject') THEN
    RAISE EXCEPTION 'action must be skip or reject' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_ids
    FROM (SELECT DISTINCT x FROM unnest(p_ingredient_ids) AS x WHERE x IS NOT NULL) s;
  IF cardinality(v_ids) < 2 OR cardinality(v_ids) > 12 THEN
    RAISE EXCEPTION 'a suggestion has 2 to 12 ingredients' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ingredients
      WHERE company_id = p_company_id AND id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'unknown ingredient for this company' USING ERRCODE = '22023';
  END IF;
  v_key := array_to_string(v_ids, ',');

  INSERT INTO public.ingredient_duplicate_suggestions (
    company_id, ingredient_ids, set_key, source, score, status,
    skipped_at, decided_by, decided_at
  ) VALUES (
    p_company_id, v_ids, v_key, COALESCE(NULLIF(p_source, ''), 'name'), p_score,
    CASE WHEN p_action = 'skip' THEN 'skipped' ELSE 'rejected' END,
    CASE WHEN p_action = 'skip' THEN now() ELSE NULL END,
    CASE WHEN p_action = 'reject' THEN auth.uid() ELSE NULL END,
    CASE WHEN p_action = 'reject' THEN now() ELSE NULL END
  )
  ON CONFLICT (company_id, set_key) DO UPDATE SET
    status = EXCLUDED.status,
    skipped_at = EXCLUDED.skipped_at,
    decided_by = EXCLUDED.decided_by,
    decided_at = EXCLUDED.decided_at
  RETURNING id INTO v_id;

  IF p_action = 'reject' THEN
    -- Every pair of the set is "not the same", for good.
    FOR a IN SELECT unnest(v_ids) LOOP
      FOR b IN SELECT unnest(v_ids) LOOP
        IF a < b THEN
          INSERT INTO public.ingredient_not_duplicates (company_id, ingredient_a, ingredient_b, decided_by)
          VALUES (p_company_id, a, b, auth.uid())
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('suggestion_id', v_id, 'status',
    CASE WHEN p_action = 'skip' THEN 'skipped' ELSE 'rejected' END);
END;
$$;

REVOKE ALL ON FUNCTION public.ingredient_merge(uuid, uuid, uuid[], uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingredient_merge_undo(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingredient_duplicate_decide(uuid, uuid[], text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingredient_merge(uuid, uuid, uuid[], uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingredient_merge_undo(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingredient_duplicate_decide(uuid, uuid[], text, text, numeric) TO authenticated, service_role;

-- Read-only checks (after applying):
--   select count(*) from public.ingredient_merges where company_id = '<company uuid>';
--   select has_function_privilege('anon', 'public.ingredient_merge(uuid,uuid,uuid[],uuid,jsonb,uuid)', 'execute');  -- must be false
--   select status, count(*) from public.ingredient_duplicate_suggestions
--   where company_id = '<company uuid>' group by 1;
