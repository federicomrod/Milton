-- 055_restaurant_archive.sql
--
-- R1 prod bugs 1 (item 7). A restaurant can be ARCHIVED: it disappears from the
-- restaurant switcher, but nothing is deleted — its sales, recipes, costs and
-- goals stay exactly as they are, and it can be restored.
--
-- WHAT CHANGES (additive; no row is changed)
--   * restaurant_locations.archived_at timestamptz NULL (NULL = active).
--   * restaurant_set_archived(company, restaurant, archived): archive / restore
--     in one call. SECURITY DEFINER with a pinned search_path: a non-member gets
--     42501; an unknown restaurant, or archiving the LAST active restaurant of a
--     company, gets 22023 with a Spanish message. Closed to anon / PUBLIC.
--
-- SAFETY
--   * RLS of restaurant_locations is unchanged (is_company_member, 001).
--   * Until this is applied the app keeps working: «Archivar» says
--     «falta aplicar la migración 055» and every restaurant is active.
--
-- IMPORTANT: not applied by CI. Paste into the Supabase SQL Editor.

ALTER TABLE public.restaurant_locations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

COMMENT ON COLUMN public.restaurant_locations.archived_at IS
  'When the restaurant was archived (hidden from the switcher). NULL = active. Never deleted.';

CREATE OR REPLACE FUNCTION public.restaurant_set_archived(
  p_company_id uuid,
  p_location_id uuid,
  p_archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_others integer;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_locations
    WHERE id = p_location_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Ese restaurante no es de tu empresa.' USING ERRCODE = '22023';
  END IF;

  IF p_archived THEN
    SELECT count(*) INTO v_active_others
    FROM public.restaurant_locations
    WHERE company_id = p_company_id
      AND id <> p_location_id
      AND archived_at IS NULL;
    IF v_active_others = 0 THEN
      RAISE EXCEPTION 'No puedes archivar tu único restaurante activo.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.restaurant_locations
       SET archived_at = coalesce(archived_at, now()), updated_at = now()
     WHERE id = p_location_id AND company_id = p_company_id;
  ELSE
    UPDATE public.restaurant_locations
       SET archived_at = NULL, updated_at = now()
     WHERE id = p_location_id AND company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object('archived', p_archived);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurant_set_archived(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_set_archived(uuid, uuid, boolean) TO authenticated, service_role;

-- Read-only checks (after applying):
--   select id, name, archived_at from public.restaurant_locations where company_id = '<company uuid>';
--   select has_function_privilege('anon', 'public.restaurant_set_archived(uuid,uuid,boolean)', 'execute');  -- must be false
