-- 049_item_groups_apply.sql
--
-- R1-15c (Agrupaciones F2). One grouping action (create a group, add to a
-- group, rename, combine, dissolve, move; and the "Deshacer" of each) is a
-- handful of row changes. PostgREST has no transaction across requests, so a
-- failure half way would leave a group half built. This function applies a
-- whole action in ONE transaction: all of it or none of it.
--
-- p_ops = {
--   delete_member_ids: [uuid],
--   upsert_groups:  [{id, name, parent_id, restaurant_id, scope, dimension,
--                     menu_dish_id, source, status, sort_order}],
--   upsert_members: [{id, group_id, member_type, member_ref}],
--   delete_group_ids: [uuid]
-- }
-- Order (so nothing is lost to a cascade): delete the members that go, upsert
-- groups, upsert members (a member that moves keeps its row), then delete
-- groups. A group's parent is set in a second pass so a new parent and its new
-- children can arrive in the same call.
--
-- SAFETY (additive; no table touched)
--   * SECURITY INVOKER: every statement runs through the caller's RLS, and the
--     unique index, checks and triggers of 048 re-validate everything. The
--     function trusts nothing in p_ops: company_id is always p_company_id, and a
--     row of another company is never read or changed (ids are matched
--     together with the company).
--   * Not a member of the company: error 42501.
--   * Closed to anon/PUBLIC.
--   * Needs 048.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor after 048.

CREATE OR REPLACE FUNCTION public.item_groups_apply(
  p_company_id uuid,
  p_ops jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  g jsonb;
  m jsonb;
  del_members integer := 0;
  up_groups integer := 0;
  up_members integer := 0;
  del_groups integer := 0;
  n integer;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'object' THEN
    RAISE EXCEPTION 'ops must be an object' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_array_length(p_ops -> 'upsert_groups'), 0)
     + COALESCE(jsonb_array_length(p_ops -> 'upsert_members'), 0)
     + COALESCE(jsonb_array_length(p_ops -> 'delete_member_ids'), 0)
     + COALESCE(jsonb_array_length(p_ops -> 'delete_group_ids'), 0) > 2000 THEN
    RAISE EXCEPTION 'too many changes in one action' USING ERRCODE = '22023';
  END IF;

  -- 1. members that go away
  DELETE FROM public.group_members gm
  WHERE gm.company_id = p_company_id
    AND gm.id IN (
      SELECT (x)::uuid FROM jsonb_array_elements_text(
        COALESCE(p_ops -> 'delete_member_ids', '[]'::jsonb)) x);
  GET DIAGNOSTICS del_members = ROW_COUNT;

  -- 2. groups: first without their parent...
  FOR g IN SELECT * FROM jsonb_array_elements(COALESCE(p_ops -> 'upsert_groups', '[]'::jsonb))
  LOOP
    INSERT INTO public.item_groups
      (id, company_id, restaurant_id, parent_id, name, scope, dimension,
       menu_dish_id, source, status, sort_order, created_by)
    VALUES (
      (g ->> 'id')::uuid, p_company_id,
      NULLIF(g ->> 'restaurant_id', '')::uuid, NULL,
      g ->> 'name', g ->> 'scope', NULLIF(g ->> 'dimension', ''),
      NULLIF(g ->> 'menu_dish_id', '')::uuid,
      COALESCE(NULLIF(g ->> 'source', ''), 'user'),
      COALESCE(NULLIF(g ->> 'status', ''), 'confirmed'),
      COALESCE((g ->> 'sort_order')::integer, 0),
      (SELECT auth.uid())
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          restaurant_id = EXCLUDED.restaurant_id,
          status = EXCLUDED.status,
          sort_order = EXCLUDED.sort_order,
          updated_at = now()
      WHERE public.item_groups.company_id = p_company_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'group not found for this company' USING ERRCODE = '42501';
    END IF;
    up_groups := up_groups + 1;
  END LOOP;
  -- ...then their parents (so a parent created in this call exists).
  FOR g IN SELECT * FROM jsonb_array_elements(COALESCE(p_ops -> 'upsert_groups', '[]'::jsonb))
  LOOP
    UPDATE public.item_groups ig
    SET parent_id = NULLIF(g ->> 'parent_id', '')::uuid, updated_at = now()
    WHERE ig.id = (g ->> 'id')::uuid
      AND ig.company_id = p_company_id
      AND ig.parent_id IS DISTINCT FROM NULLIF(g ->> 'parent_id', '')::uuid;
  END LOOP;

  -- 3. members (a member that moves keeps its row)
  FOR m IN SELECT * FROM jsonb_array_elements(COALESCE(p_ops -> 'upsert_members', '[]'::jsonb))
  LOOP
    INSERT INTO public.group_members (id, company_id, group_id, member_type, member_ref)
    VALUES (
      (m ->> 'id')::uuid, p_company_id, (m ->> 'group_id')::uuid,
      m ->> 'member_type', m ->> 'member_ref')
    ON CONFLICT (id) DO UPDATE
      SET group_id = EXCLUDED.group_id
      WHERE public.group_members.company_id = p_company_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'member not found for this company' USING ERRCODE = '42501';
    END IF;
    up_members := up_members + 1;
  END LOOP;

  -- 4. groups that go away (their members are already moved or deleted)
  DELETE FROM public.item_groups ig
  WHERE ig.company_id = p_company_id
    AND ig.id IN (
      SELECT (x)::uuid FROM jsonb_array_elements_text(
        COALESCE(p_ops -> 'delete_group_ids', '[]'::jsonb)) x);
  GET DIAGNOSTICS del_groups = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_members', del_members,
    'upserted_groups', up_groups,
    'upserted_members', up_members,
    'deleted_groups', del_groups
  );
END;
$$;

REVOKE ALL ON FUNCTION public.item_groups_apply(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.item_groups_apply(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.item_groups_apply(uuid, jsonb)
  TO authenticated, service_role;
