-- 061-fix-shifts-delete-where.sql
-- Prod enforces pg_safeupdate: a DELETE without WHERE fails. Identical to 054's
-- restaurant_shifts_save except the temp-table DELETE now has WHERE true.
-- Idempotent (CREATE OR REPLACE + REVOKE/GRANT). Safe to re-run.

CREATE OR REPLACE FUNCTION public.restaurant_shifts_save(
  p_company_id uuid,
  p_restaurant_id uuid,
  p_shifts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  i int := 0;
  v_name text;
  v_start time;
  v_end time;
  v_days int[];
  v_active boolean;
  a record;
  b record;
BEGIN
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_locations
    WHERE id = p_restaurant_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Ese restaurante no es de tu empresa.' USING ERRCODE = '22023';
  END IF;
  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR jsonb_array_length(p_shifts) > 12 THEN
    RAISE EXCEPTION 'Los turnos deben ser una lista de 12 como máximo.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _shifts_in (
    pos int, name text, s time, e time, days int[], active boolean
  ) ON COMMIT DROP;
  DELETE FROM _shifts_in WHERE true;

  FOR r IN SELECT * FROM jsonb_array_elements(p_shifts) LOOP
    i := i + 1;
    v_name := btrim(coalesce(r->>'name', ''));
    IF length(v_name) = 0 OR length(v_name) > 40 THEN
      RAISE EXCEPTION 'Cada turno necesita un nombre (hasta 40 letras).' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_start := (r->>'start_time')::time;
      v_end := (r->>'end_time')::time;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'El turno «%» tiene una hora no válida.', v_name USING ERRCODE = '22023';
    END;
    IF v_start IS NULL OR v_end IS NULL OR v_start = v_end THEN
      RAISE EXCEPTION 'El turno «%» necesita una hora de inicio y otra de fin distintas.', v_name
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(r->'weekdays') = 'array' AND jsonb_array_length(r->'weekdays') > 0 THEN
      SELECT array_agg(DISTINCT x::int ORDER BY x::int) INTO v_days
      FROM jsonb_array_elements_text(r->'weekdays') x;
    ELSE
      v_days := ARRAY[1,2,3,4,5,6,7];
    END IF;
    IF NOT (v_days <@ ARRAY[1,2,3,4,5,6,7]) THEN
      RAISE EXCEPTION 'El turno «%» tiene un día de la semana no válido.', v_name USING ERRCODE = '22023';
    END IF;
    v_active := coalesce((r->>'active')::boolean, true);
    INSERT INTO _shifts_in VALUES (i, v_name, v_start, v_end, v_days, v_active);
  END LOOP;

  -- Active shifts may not overlap on the same weekday.
  FOR a IN SELECT * FROM _shifts_in WHERE active LOOP
    FOR b IN SELECT * FROM _shifts_in WHERE active AND pos > a.pos LOOP
      IF a.days && b.days
         AND public.restaurant_shift_overlap(a.s, a.e, b.s, b.e) THEN
        RAISE EXCEPTION 'Los turnos «%» y «%» se solapan el mismo día. Ajusta las horas.', a.name, b.name
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  DELETE FROM public.restaurant_shifts
  WHERE company_id = p_company_id AND restaurant_id = p_restaurant_id;
  INSERT INTO public.restaurant_shifts
    (company_id, restaurant_id, name, start_time, end_time, weekdays, active, sort_order)
  SELECT p_company_id, p_restaurant_id, name, s, e, days, active, pos FROM _shifts_in;

  RETURN jsonb_build_object(
    'saved', i,
    'cutoff', to_char(public.restaurant_business_day_cutoff(p_restaurant_id), 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restaurant_shifts_save(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_shifts_save(uuid, uuid, jsonb) TO authenticated, service_role;
