-- 048_item_groups.sql
--
-- R1-15b (Agrupaciones F1). User-defined grouping at any level: POS products
-- (Coca-Cola, Sprite → "Refrescos" → "Bebidas"), the values of a drill-down
-- dimension (Papas fritas, Puré, Papa al horno → "Papas"), preparations and
-- ingredients. Milton suggests groups; nothing is ever hidden or counted
-- twice.
--
-- 1. item_groups: a node of a hierarchy. Company-owned, with an optional
--    restaurant_id (NULL = shared by every restaurant; set = only that
--    restaurant, and it never includes another restaurant's sales).
--    Nesting is parent_id (Bebidas › Refrescos). The Plato del menú is the
--    default AUTO level: one row per menu_dish with source = 'auto'.
--    (Named item_groups, not "groups": GROUPS is a SQL keyword.)
-- 2. group_members: what a group holds. A member belongs to exactly ONE
--    group per hierarchy (and restaurant scope): the unique index below, so
--    nothing is counted twice. Products, preparations and ingredients are
--    one hierarchy each (the auto dish groups included); a dimension value
--    is one hierarchy per dimension, or per dimension and dish. hierarchy_key and restaurant_id are copied
--    from the group by a trigger, so a client cannot desync them.
-- 3. item_groups_sync_menu_dishes(): creates the missing AUTO group of each
--    menu dish, idempotently. It only INSERTS: it never renames, moves or
--    deletes anything a person touched.
--
-- Membership of a menu dish's own variants is NOT copied into group_members:
-- it stays pos_product_links.menu_dish_id (one source of truth, PR D). A
-- group_members row for a variant is an explicit choice (moved to another
-- group) and wins over its dish.
--
-- DESIGN: additive only. Two new company-scoped tables with RLS
-- (public.is_company_member, same rule as 038-046), four small triggers,
-- one SECURITY INVOKER function (RLS still applies). No DROP, no RENAME, no
-- ALTER of existing columns, no backfill. Until this file is applied the
-- app shows no group features and every number is what it was.
--
-- IMPORTANT: this file is for repo history. Supabase migrations are not
-- applied from the repo by CI: paste it into the Supabase SQL Editor (needs
-- PostgreSQL 15+ for ON DELETE SET NULL with a column list, as 045).

-- ---------------------------------------------------------------------------
-- 1. item_groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.item_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  restaurant_id uuid NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  parent_id     uuid NULL,
  name          text NOT NULL,
  scope         text NOT NULL,
  dimension     text NULL,
  menu_dish_id  uuid NULL,
  source        text NOT NULL DEFAULT 'user',
  status        text NOT NULL DEFAULT 'confirmed',
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_groups_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT item_groups_scope_chk
    CHECK (scope IN ('product', 'dimension_value', 'preparation', 'ingredient')),
  CONSTRAINT item_groups_dimension_chk
    CHECK (dimension IS NULL OR dimension IN ('side', 'size', 'cooking_point', 'channel')),
  CONSTRAINT item_groups_dimension_scope_chk
    CHECK ((scope = 'dimension_value') = (dimension IS NOT NULL)),
  CONSTRAINT item_groups_source_chk
    CHECK (source IN ('auto', 'ai_suggested', 'user')),
  CONSTRAINT item_groups_status_chk
    CHECK (status IN ('suggested', 'confirmed')),
  CONSTRAINT item_groups_not_own_parent_chk CHECK (parent_id IS NULL OR parent_id <> id),
  -- A menu dish only ties a product group (the auto level) or a dimension
  -- group limited to that dish.
  CONSTRAINT item_groups_menu_dish_scope_chk
    CHECK (menu_dish_id IS NULL OR scope IN ('product', 'dimension_value'))
);

COMMENT ON TABLE public.item_groups IS
  'A group in a hierarchy of products, dimension values, preparations or ingredients. source auto = the Plato del menu level kept by Milton; ai_suggested = a suggestion that only counts once a person confirms it; user = made by a person.';
COMMENT ON COLUMN public.item_groups.restaurant_id IS
  'NULL = shared by every restaurant; set = only that restaurant (its sales only).';

-- Target of the company-safe references below.
CREATE UNIQUE INDEX IF NOT EXISTS item_groups_id_company_uniq
  ON public.item_groups (id, company_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_parent_company_fk') THEN
    ALTER TABLE public.item_groups
      ADD CONSTRAINT item_groups_parent_company_fk
      FOREIGN KEY (parent_id, company_id)
      REFERENCES public.item_groups (id, company_id)
      ON DELETE SET NULL (parent_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_menu_dish_company_fk') THEN
    ALTER TABLE public.item_groups
      ADD CONSTRAINT item_groups_menu_dish_company_fk
      FOREIGN KEY (menu_dish_id, company_id)
      REFERENCES public.menu_dishes (id, company_id)
      ON DELETE SET NULL (menu_dish_id);
  END IF;
END
$$;

-- One auto group per menu dish.
CREATE UNIQUE INDEX IF NOT EXISTS item_groups_auto_dish_uniq
  ON public.item_groups (company_id, menu_dish_id)
  WHERE source = 'auto' AND scope = 'product' AND menu_dish_id IS NOT NULL;

-- Siblings do not repeat a name (same parent, same hierarchy, same restaurant).
CREATE UNIQUE INDEX IF NOT EXISTS item_groups_sibling_name_uniq
  ON public.item_groups (
    company_id,
    scope,
    COALESCE(dimension, ''),
    COALESCE(menu_dish_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

CREATE INDEX IF NOT EXISTS item_groups_company_idx
  ON public.item_groups (company_id, scope);
CREATE INDEX IF NOT EXISTS item_groups_parent_idx
  ON public.item_groups (parent_id) WHERE parent_id IS NOT NULL;

-- A group can never sit under its own descendant.
CREATE OR REPLACE FUNCTION public.item_groups_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE up AS (
      SELECT g.id, g.parent_id FROM public.item_groups g WHERE g.id = NEW.parent_id
      UNION
      SELECT g.id, g.parent_id FROM public.item_groups g JOIN up ON g.id = up.parent_id
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a group cannot be inside itself' USING ERRCODE = '23514';
  END IF;
  -- Same hierarchy as its parent.
  IF NOT EXISTS (
    SELECT 1 FROM public.item_groups p
    WHERE p.id = NEW.parent_id
      AND p.company_id = NEW.company_id
      AND p.scope = NEW.scope
      AND p.dimension IS NOT DISTINCT FROM NEW.dimension
  ) THEN
    RAISE EXCEPTION 'a group goes inside a group of the same kind' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_groups_no_cycle_trg ON public.item_groups;
CREATE TRIGGER item_groups_no_cycle_trg
  BEFORE INSERT OR UPDATE OF parent_id ON public.item_groups
  FOR EACH ROW EXECUTE FUNCTION public.item_groups_no_cycle();

-- The restaurant must belong to the group's company. (restaurant_locations
-- has no (id, company_id) key to reference, and this file does not alter
-- existing tables, so the database checks it here.)
CREATE OR REPLACE FUNCTION public.item_groups_check_restaurant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.restaurant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_locations r
    WHERE r.id = NEW.restaurant_id AND r.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'that restaurant belongs to another company'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_groups_check_restaurant_trg ON public.item_groups;
CREATE TRIGGER item_groups_check_restaurant_trg
  BEFORE INSERT OR UPDATE OF restaurant_id, company_id ON public.item_groups
  FOR EACH ROW EXECUTE FUNCTION public.item_groups_check_restaurant();

ALTER TABLE public.item_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'item_groups'
      AND policyname = 'item_groups_member'
  ) THEN
    CREATE POLICY item_groups_member ON public.item_groups
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

REVOKE ALL ON TABLE public.item_groups FROM anon;
GRANT ALL ON TABLE public.item_groups TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. group_members
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.group_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL,
  member_type   text NOT NULL,
  member_ref    text NOT NULL,
  -- Copied from the group by a trigger (never trusted from the client).
  hierarchy_key text NOT NULL DEFAULT '',
  restaurant_id uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_members_type_chk
    CHECK (member_type IN ('pos_product', 'group', 'dimension_value', 'preparation', 'ingredient')),
  CONSTRAINT group_members_ref_chk CHECK (btrim(member_ref) <> '')
);

COMMENT ON TABLE public.group_members IS
  'What a group holds: a POS product (member_ref = odoo_product_id), a dimension value (the value text), a preparation or ingredient (its uuid). One group per member per hierarchy and restaurant scope. A POS product of a menu dish is a member of that dish through pos_product_links, not here; a row here is a person''s explicit choice and wins.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_group_company_fk') THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT group_members_group_company_fk
      FOREIGN KEY (group_id, company_id)
      REFERENCES public.item_groups (id, company_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- A member belongs to exactly one group per hierarchy and restaurant scope.
CREATE UNIQUE INDEX IF NOT EXISTS group_members_one_group_uniq
  ON public.group_members (
    company_id,
    hierarchy_key,
    member_type,
    member_ref,
    COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS group_members_group_idx
  ON public.group_members (group_id);
CREATE INDEX IF NOT EXISTS group_members_company_idx
  ON public.group_members (company_id, member_type);

-- hierarchy_key / restaurant_id come from the group; the member kind must fit
-- the group's scope.
CREATE OR REPLACE FUNCTION public.group_members_from_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  g public.item_groups%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.item_groups
  WHERE id = NEW.group_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group not found' USING ERRCODE = '23503';
  END IF;
  IF NOT (
    (g.scope = 'product' AND NEW.member_type IN ('pos_product', 'group')) OR
    (g.scope = 'dimension_value' AND NEW.member_type IN ('dimension_value', 'group')) OR
    (g.scope = 'preparation' AND NEW.member_type IN ('preparation', 'group')) OR
    (g.scope = 'ingredient' AND NEW.member_type IN ('ingredient', 'group'))
  ) THEN
    RAISE EXCEPTION 'a % cannot be a member of a % group', NEW.member_type, g.scope
      USING ERRCODE = '23514';
  END IF;
  -- ONE hierarchy per scope. Only a dimension group tied to a menu dish is
  -- its own hierarchy (the same side value may be grouped differently in
  -- one dish). Every auto group carries its own menu_dish_id, so the dish
  -- must NOT be part of the key for product groups: otherwise one product
  -- could be a member of a user group and of several auto groups at once.
  NEW.hierarchy_key :=
    g.scope || ':' || COALESCE(g.dimension, '') || ':' ||
    CASE WHEN g.scope = 'dimension_value'
         THEN COALESCE(g.menu_dish_id::text, '')
         ELSE '' END;
  NEW.restaurant_id := g.restaurant_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_members_from_group_trg ON public.group_members;
CREATE TRIGGER group_members_from_group_trg
  BEFORE INSERT OR UPDATE OF group_id, member_type ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_from_group();

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'group_members'
      AND policyname = 'group_members_member'
  ) THEN
    CREATE POLICY group_members_member ON public.group_members
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

REVOKE ALL ON TABLE public.group_members FROM anon;
GRANT ALL ON TABLE public.group_members TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The Plato del menú level, kept in sync (insert-only)
-- ---------------------------------------------------------------------------
-- Creates the missing auto group of each menu dish that is not excluded.
-- Never renames, moves, re-parents or deletes a group, and never touches a
-- member: a person's rename, nesting or move is final. Returns how many auto
-- groups were created.

CREATE OR REPLACE FUNCTION public.item_groups_sync_menu_dishes(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  created integer;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.item_groups
    (company_id, restaurant_id, name, scope, menu_dish_id, source, status)
  SELECT d.company_id, d.restaurant_id, d.name, 'product', d.id, 'auto', 'confirmed'
  FROM public.menu_dishes d
  WHERE d.company_id = p_company_id
    AND d.status <> 'excluded'
    AND NOT EXISTS (
      SELECT 1 FROM public.item_groups g
      WHERE g.company_id = d.company_id
        AND g.menu_dish_id = d.id
        AND g.source = 'auto'
        AND g.scope = 'product'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS created = ROW_COUNT;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.item_groups_sync_menu_dishes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.item_groups_sync_menu_dishes(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.item_groups_sync_menu_dishes(uuid)
  TO authenticated, service_role;
