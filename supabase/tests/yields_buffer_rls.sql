-- supabase/tests/yields_buffer_rls.sql
--
-- RLS and range checks for migration 075 (ingredient_yields,
-- kitchen_buffer_settings). Run on a database that has all migrations up to
-- 075; it creates its own synthetic companies, users, ingredients and
-- restaurants inside a transaction and ROLLS BACK, so nothing is kept.
--
--   psql "$DB_URL" -X -f supabase/tests/yields_buffer_rls.sql
--
-- Expected: every line prints `ok`; any `FAIL` raises an exception.
-- Needs a role that can SET ROLE authenticated (the postgres / service owner).

BEGIN;

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid);
INSERT INTO _ids VALUES
  ('company', gen_random_uuid()), ('other', gen_random_uuid()),
  ('owner', gen_random_uuid()), ('admin', gen_random_uuid()),
  ('manager', gen_random_uuid()), ('analyst', gen_random_uuid()),
  ('viewer', gen_random_uuid()), ('member', gen_random_uuid()),
  ('stranger', gen_random_uuid()),
  ('ing', gen_random_uuid()), ('ing_other', gen_random_uuid()),
  ('loc', gen_random_uuid()), ('loc_other', gen_random_uuid());
GRANT SELECT ON _ids TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@rls.test'
  FROM _ids WHERE k IN ('owner', 'admin', 'manager', 'analyst', 'viewer', 'member', 'stranger');
INSERT INTO public.companies (id, name) SELECT id, 'RLS test ' || k FROM _ids WHERE k IN ('company', 'other');
INSERT INTO public.company_memberships (company_id, user_id, role)
SELECT (SELECT id FROM _ids WHERE k = 'company'), id, k
  FROM _ids WHERE k IN ('owner', 'admin', 'manager', 'analyst', 'viewer', 'member');
INSERT INTO public.ingredients (id, company_id, name, default_unit)
SELECT i.id, c.id, 'Demo ' || i.k, 'kg'
  FROM _ids i JOIN _ids c ON c.k = CASE i.k WHEN 'ing' THEN 'company' ELSE 'other' END
 WHERE i.k IN ('ing', 'ing_other');
INSERT INTO public.restaurant_locations (id, company_id, name, status)
SELECT l.id, c.id, 'Demo ' || l.k, 'active'
  FROM _ids l JOIN _ids c ON c.k = CASE l.k WHEN 'loc' THEN 'company' ELSE 'other' END
 WHERE l.k IN ('loc', 'loc_other');

-- One existing row of each table (as the table owner) to read / update / delete.
INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, status, effective_from)
SELECT (SELECT id FROM _ids WHERE k = 'company'), (SELECT id FROM _ids WHERE k = 'ing'), 10, 'approved', date '2026-01-01';
INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
SELECT (SELECT id FROM _ids WHERE k = 'company'), (SELECT id FROM _ids WHERE k = 'loc'), 5, date '2026-01-01';

CREATE FUNCTION pg_temp.act_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM _ids WHERE k = who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- 1. Role matrix --------------------------------------------------------------
DO $$
DECLARE
  who text;
  writer boolean;
  co uuid := (SELECT id FROM _ids WHERE k = 'company');
  ing uuid := (SELECT id FROM _ids WHERE k = 'ing');
  loc uuid := (SELECT id FROM _ids WHERE k = 'loc');
  n int;
  denied boolean;
BEGIN
  FOREACH who IN ARRAY ARRAY['analyst', 'viewer', 'member', 'owner', 'admin', 'manager', 'stranger'] LOOP
    RESET ROLE;
    PERFORM pg_temp.act_as(who);
    writer := who IN ('owner', 'admin', 'manager');

    -- READ: every member sees both rows; a stranger sees nothing.
    SELECT count(*) INTO n FROM public.ingredient_yields WHERE company_id = co;
    IF (who = 'stranger') <> (n = 0) OR (who <> 'stranger' AND n <> 1) THEN
      RAISE EXCEPTION 'FAIL: % read % yield rows', who, n;
    END IF;
    SELECT count(*) INTO n FROM public.kitchen_buffer_settings WHERE company_id = co;
    IF (who = 'stranger') <> (n = 0) OR (who <> 'stranger' AND n <> 1) THEN
      RAISE EXCEPTION 'FAIL: % read % buffer rows', who, n;
    END IF;

    -- INSERT
    denied := false;
    BEGIN
      INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, effective_from)
      VALUES (co, ing, 20, date '2026-06-01');
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF writer = denied THEN RAISE EXCEPTION 'FAIL: yield insert as % (denied=%)', who, denied; END IF;

    denied := false;
    BEGIN
      INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
      VALUES (co, loc, 8, date '2026-06-01');
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF writer = denied THEN RAISE EXCEPTION 'FAIL: buffer insert as % (denied=%)', who, denied; END IF;

    -- UPDATE (RLS filters rows: 0 rows updated = blocked)
    UPDATE public.ingredient_yields SET loss_pct = loss_pct + 1
     WHERE company_id = co AND effective_from = date '2026-01-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF writer <> (n = 1) THEN RAISE EXCEPTION 'FAIL: yield update as % changed % rows', who, n; END IF;
    UPDATE public.kitchen_buffer_settings SET buffer_pct = buffer_pct + 1
     WHERE company_id = co AND effective_from = date '2026-01-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF writer <> (n = 1) THEN RAISE EXCEPTION 'FAIL: buffer update as % changed % rows', who, n; END IF;

    -- DELETE the June rows (they exist only if this user inserted them)
    DELETE FROM public.ingredient_yields WHERE company_id = co AND effective_from = date '2026-06-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF writer <> (n = 1) THEN RAISE EXCEPTION 'FAIL: yield delete as % removed % rows', who, n; END IF;
    DELETE FROM public.kitchen_buffer_settings WHERE company_id = co AND effective_from = date '2026-06-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF writer <> (n = 1) THEN RAISE EXCEPTION 'FAIL: buffer delete as % removed % rows', who, n; END IF;

    RAISE NOTICE 'ok  roles  %', who;
  END LOOP;
END $$;

-- 2. Cross-company writes are blocked (a manager of `company`) ---------------
RESET ROLE;
SELECT pg_temp.act_as('manager');
DO $$
DECLARE
  other uuid := (SELECT id FROM _ids WHERE k = 'other');
  co uuid := (SELECT id FROM _ids WHERE k = 'company');
  denied boolean;
BEGIN
  -- Into another company.
  denied := false;
  BEGIN
    INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, effective_from)
    VALUES (other, (SELECT id FROM _ids WHERE k = 'ing_other'), 10, date '2026-06-01');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: yield written into another company'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
    VALUES (other, (SELECT id FROM _ids WHERE k = 'loc_other'), 5, date '2026-06-01');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: buffer written into another company'; END IF;

  -- Own company, but pointing at another company's ingredient / restaurant.
  denied := false;
  BEGIN
    INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, effective_from)
    VALUES (co, (SELECT id FROM _ids WHERE k = 'ing_other'), 10, date '2026-06-01');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: yield points at another company''s ingredient'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
    VALUES (co, (SELECT id FROM _ids WHERE k = 'loc_other'), 5, date '2026-06-01');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: buffer points at another company''s restaurant'; END IF;

  RAISE NOTICE 'ok  cross-company';
END $$;

-- 3. Range checks (as a writer, so only the CHECK can say no) ----------------
DO $$
DECLARE
  co uuid := (SELECT id FROM _ids WHERE k = 'company');
  ing uuid := (SELECT id FROM _ids WHERE k = 'ing');
  loc uuid := (SELECT id FROM _ids WHERE k = 'loc');
  v numeric;
  bad boolean;
BEGIN
  FOREACH v IN ARRAY ARRAY[-0.01, 100, 150] LOOP
    bad := false;
    BEGIN
      INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, effective_from)
      VALUES (co, ing, v, date '2026-07-01');
    EXCEPTION WHEN check_violation THEN bad := true;
    END;
    IF NOT bad THEN RAISE EXCEPTION 'FAIL: loss_pct % accepted', v; END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY[0, 99.99] LOOP
    INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, effective_from)
    VALUES (co, ing, v, date '2026-07-01');
  END LOOP;

  FOREACH v IN ARRAY ARRAY[-1, 30.01, 50] LOOP
    bad := false;
    BEGIN
      INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
      VALUES (co, loc, v, date '2026-07-01');
    EXCEPTION WHEN check_violation THEN bad := true;
    END;
    IF NOT bad THEN RAISE EXCEPTION 'FAIL: buffer_pct % accepted', v; END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY[0, 30] LOOP
    INSERT INTO public.kitchen_buffer_settings (company_id, location_id, buffer_pct, effective_from)
    VALUES (co, loc, v, date '2026-07-01');
  END LOOP;

  -- The buffer defaults to 5, a yield starts as a draft.
  INSERT INTO public.kitchen_buffer_settings (company_id, location_id, effective_from)
  VALUES (co, loc, date '2026-08-01');
  IF (SELECT buffer_pct FROM public.kitchen_buffer_settings
       WHERE location_id = loc AND effective_from = date '2026-08-01') <> 5 THEN
    RAISE EXCEPTION 'FAIL: buffer_pct default is not 5';
  END IF;

  bad := false;
  BEGIN
    INSERT INTO public.ingredient_yields (company_id, ingredient_id, loss_pct, status, effective_from)
    VALUES (co, ing, 10, 'final', date '2026-09-01');
  EXCEPTION WHEN check_violation THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'FAIL: status ''final'' accepted'; END IF;

  RAISE NOTICE 'ok  ranges';
END $$;

RESET ROLE;
ROLLBACK;
