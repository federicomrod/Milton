-- 075_ingredient_yield_kitchen_buffer.sql
--
-- Issue #404 (Rentabilidad 1b). Two effective-dated HISTORY tables:
--   ingredient_yields         the yield loss (merma de limpieza / rendimiento)
--                             of an ingredient, in %.
--   kitchen_buffer_settings   the kitchen buffer (colchón de cocina) of a
--                             restaurant, in % of food cost.
--
-- Both are history: the value at a date is the row with the latest
-- effective_from <= that date (lib/restaurant/yield-buffer.ts does exactly
-- that). So «a semanas anteriores» vs «solo desde hoy» is only the choice of
-- effective_from; nothing is ever updated in place to change the past.
--
-- ADDITIVE ONLY: two new tables, their indexes, RLS and grants. No existing
-- table, column, policy, function or data is touched. (Number 065 is taken and
-- 074 is reserved for the COGS split.) Re-running is safe (IF NOT EXISTS).
--
-- ACCESS (matches 073): read = any company member (is_company_member); write
-- (insert / update / delete) = owner, admin, manager (has_company_role, created
-- in 073), or a Milton staff user who is also a member, exactly like 073. A
-- write must also point at an ingredient / restaurant OF THE SAME company.
-- No new function, so supabase/tests/secdef_guard.sql is unaffected.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton Staging
-- first (after 073); production only after Fede says yes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ingredient_yields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  -- Share of the purchased weight that is lost when cleaning: 0 <= x < 100.
  loss_pct       numeric(5, 2) NOT NULL,
  source         text NOT NULL DEFAULT 'manual',
  status         text NOT NULL DEFAULT 'draft',
  effective_from date NOT NULL,
  created_by     uuid NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_yields_loss_pct_chk CHECK (loss_pct >= 0 AND loss_pct < 100),
  CONSTRAINT ingredient_yields_status_chk CHECK (status IN ('draft', 'approved'))
);

CREATE TABLE IF NOT EXISTS public.kitchen_buffer_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id    uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  buffer_pct     numeric(5, 2) NOT NULL DEFAULT 5,
  effective_from date NOT NULL,
  created_by     uuid NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_buffer_settings_buffer_pct_chk CHECK (buffer_pct >= 0 AND buffer_pct <= 30)
);

CREATE INDEX IF NOT EXISTS ingredient_yields_company_ingredient_from_idx
  ON public.ingredient_yields (company_id, ingredient_id, effective_from);
CREATE INDEX IF NOT EXISTS kitchen_buffer_settings_company_location_from_idx
  ON public.kitchen_buffer_settings (company_id, location_id, effective_from);

ALTER TABLE public.ingredient_yields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_buffer_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  writers text := 'public.has_company_role(company_id, ARRAY[''owner'',''admin'',''manager''])'
    || ' OR (public.is_company_member(company_id) AND public.is_milton_admin())';
  ingredient_ok text := 'EXISTS (SELECT 1 FROM public.ingredients i'
    || ' WHERE i.id = ingredient_id AND i.company_id = ingredient_yields.company_id)';
  location_ok text := 'EXISTS (SELECT 1 FROM public.restaurant_locations l'
    || ' WHERE l.id = location_id AND l.company_id = kitchen_buffer_settings.company_id)';
  t text;
  extra text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ingredient_yields', 'kitchen_buffer_settings'] LOOP
    extra := CASE t WHEN 'ingredient_yields' THEN ingredient_ok ELSE location_ok END;

    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_company_member(company_id))',
        t || '_member_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_insert') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK ((%s) AND %s)',
        t || '_writers_insert', t, writers, extra);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_update') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK ((%s) AND %s)',
        t || '_writers_update', t, writers, writers, extra);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_writers_delete') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE USING (%s)',
        t || '_writers_delete', t, writers);
    END IF;
  END LOOP;
END
$$;

GRANT ALL ON TABLE public.ingredient_yields TO authenticated, service_role;
GRANT ALL ON TABLE public.kitchen_buffer_settings TO authenticated, service_role;

COMMIT;
