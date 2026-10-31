-- supabase/tests/fixed_costs_rls.sql
--
-- RLS check for migration 073 (fixed costs write roles). Run on a database that
-- has all migrations; it creates its own synthetic company and users inside a
-- transaction and ROLLS BACK, so nothing is kept.
--
--   psql "$DB_URL" -X -f supabase/tests/fixed_costs_rls.sql
--
-- Expected: every line prints `ok`; any `FAIL` raises an exception.
-- Needs a role that can SET ROLE authenticated (the postgres / service owner).

BEGIN;

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid);
INSERT INTO _ids VALUES
  ('company', gen_random_uuid()), ('other', gen_random_uuid()),
  ('owner', gen_random_uuid()), ('admin', gen_random_uuid()),
  ('manager', gen_random_uuid()), ('member', gen_random_uuid()),
  ('stranger', gen_random_uuid());
GRANT SELECT ON _ids TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@rls.test'
  FROM _ids WHERE k IN ('owner', 'admin', 'manager', 'member', 'stranger');
INSERT INTO public.companies (id, name) SELECT id, 'RLS test ' || k FROM _ids WHERE k IN ('company', 'other');
INSERT INTO public.company_memberships (company_id, user_id, role)
SELECT (SELECT id FROM _ids WHERE k = 'company'), id, k FROM _ids WHERE k IN ('owner', 'admin', 'manager', 'member');

-- One existing line to read / update / delete.
INSERT INTO public.restaurant_fixed_costs (company_id, month, category, amount, currency, status)
SELECT id, date '2026-10-01', 'alquiler', 1000, 'USD', 'confirmed' FROM _ids WHERE k = 'company';

CREATE FUNCTION pg_temp.act_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM _ids WHERE k = who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

DO $$
DECLARE
  who text;
  co uuid := (SELECT id FROM _ids WHERE k = 'company');
  n int;
  denied boolean;
BEGIN
  FOREACH who IN ARRAY ARRAY['member', 'owner', 'admin', 'manager', 'stranger'] LOOP
    RESET ROLE;
    PERFORM pg_temp.act_as(who);

    -- READ: any member sees the line; a stranger sees nothing.
    SELECT count(*) INTO n FROM public.restaurant_fixed_costs WHERE company_id = co;
    IF who = 'stranger' THEN
      IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % can read another company', who; END IF;
    ELSIF n <> 1 THEN
      RAISE EXCEPTION 'FAIL: % cannot read (saw % rows)', who, n;
    END IF;

    -- INSERT
    denied := false;
    BEGIN
      INSERT INTO public.restaurant_fixed_costs (company_id, month, category, amount, currency, status)
      VALUES (co, date '2026-09-01', 'servicios', 50, 'USD', 'confirmed');
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF (who IN ('owner', 'admin', 'manager')) = denied THEN
      RAISE EXCEPTION 'FAIL: insert as % (denied=%)', who, denied;
    END IF;

    -- UPDATE (RLS filters rows: 0 rows updated = blocked)
    UPDATE public.restaurant_fixed_costs SET amount = amount + 1
     WHERE company_id = co AND month = date '2026-10-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF (who IN ('owner', 'admin', 'manager')) <> (n = 1) THEN
      RAISE EXCEPTION 'FAIL: update as % changed % rows', who, n;
    END IF;

    -- DELETE the September line (only writers can; it exists only if they inserted it)
    DELETE FROM public.restaurant_fixed_costs WHERE company_id = co AND month = date '2026-09-01';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF who IN ('owner', 'admin', 'manager') AND n <> 1 THEN
      RAISE EXCEPTION 'FAIL: delete as % removed % rows', who, n;
    END IF;
    IF who NOT IN ('owner', 'admin', 'manager') AND n <> 0 THEN
      RAISE EXCEPTION 'FAIL: delete as % removed % rows', who, n;
    END IF;

    RAISE NOTICE 'ok  %', who;
  END LOOP;
END $$;

ROLLBACK;
