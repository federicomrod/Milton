-- 077_kitchen_waste_lines.sql
--
-- Issue #408 (Rentabilidad 1b): value unplanned waste. One row per item of a
-- waste report (kitchen_reports.report_type = 'waste'). The AI reads the report
-- into DRAFT lines (item, quantity, unit); a manager confirms or edits them in
-- Cocina. Only CONFIRMED lines are valued, at the effective cost of the
-- report's day (unit_cost, value are filled when the line is confirmed). A
-- confirmed line with no quantity or no price keeps value NULL: it is counted
-- and shown as «⚑ Falta», never as $0.
--
-- ADDITIVE ONLY: one new table, its indexes, RLS and grants. No existing
-- table, column, policy, function or data is touched. (Number 066 is taken and
-- 074 is reserved.) Re-running is safe (IF NOT EXISTS).
--
-- ACCESS (same shape as 075): read = any company member (is_company_member);
-- write = owner, admin, manager (has_company_role, created in 073) or a Milton
-- staff user who is also a member. A write must also point at a report,
-- restaurant, ingredient and preparation OF THE SAME company. No new function,
-- so supabase/tests/secdef_guard.sql is unaffected.
--
-- IMPORTANT: Supabase migrations are not applied from the repo by CI. Paste
-- this SQL into the Supabase SQL Editor on Milton Staging first (after 075 and
-- 073); production only after Fede says yes. The app does not break while the
-- table is missing: Rentabilidad shows «⚑ Falta».

BEGIN;

CREATE TABLE IF NOT EXISTS public.kitchen_waste_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES public.kitchen_reports(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  -- What the report said, as written («tomate», «salsa verde»).
  item_name     text NOT NULL,
  ingredient_id uuid NULL REFERENCES public.ingredients(id) ON DELETE SET NULL,
  component_id  uuid NULL REFERENCES public.prepared_components(id) ON DELETE SET NULL,
  quantity      numeric(14, 4) NULL,
  unit          text NULL,
  -- The business day of the report: the day whose cost values the line.
  report_date   date NOT NULL,
  -- Filled on confirm; NULL = no value (no quantity or no price).
  unit_cost     numeric(14, 6) NULL,
  value         numeric(14, 2) NULL,
  currency      text NULL,
  status        text NOT NULL DEFAULT 'draft',
  source        text NOT NULL DEFAULT 'ai',
  confirmed_by  uuid NULL,
  confirmed_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_waste_lines_status_chk CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT kitchen_waste_lines_source_chk CHECK (source IN ('ai', 'manual')),
  CONSTRAINT kitchen_waste_lines_one_item_chk CHECK (ingredient_id IS NULL OR component_id IS NULL),
  CONSTRAINT kitchen_waste_lines_quantity_chk CHECK (quantity IS NULL OR quantity > 0)
);

CREATE INDEX IF NOT EXISTS kitchen_waste_lines_company_location_date_idx
  ON public.kitchen_waste_lines (company_id, location_id, report_date);
CREATE INDEX IF NOT EXISTS kitchen_waste_lines_report_idx
  ON public.kitchen_waste_lines (report_id);

ALTER TABLE public.kitchen_waste_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  writers text := 'public.has_company_role(company_id, ARRAY[''owner'',''admin'',''manager''])'
    || ' OR (public.is_company_member(company_id) AND public.is_milton_admin())';
  same_company text :=
    'EXISTS (SELECT 1 FROM public.kitchen_reports r'
    || ' WHERE r.id = report_id AND r.company_id = kitchen_waste_lines.company_id)'
    || ' AND EXISTS (SELECT 1 FROM public.restaurant_locations l'
    || ' WHERE l.id = location_id AND l.company_id = kitchen_waste_lines.company_id)'
    || ' AND (ingredient_id IS NULL OR EXISTS (SELECT 1 FROM public.ingredients i'
    || ' WHERE i.id = ingredient_id AND i.company_id = kitchen_waste_lines.company_id))'
    || ' AND (component_id IS NULL OR EXISTS (SELECT 1 FROM public.prepared_components c'
    || ' WHERE c.id = component_id AND c.company_id = kitchen_waste_lines.company_id))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'kitchen_waste_lines'
                    AND policyname = 'kitchen_waste_lines_member_select') THEN
    EXECUTE 'CREATE POLICY kitchen_waste_lines_member_select ON public.kitchen_waste_lines'
      || ' FOR SELECT USING (public.is_company_member(company_id))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'kitchen_waste_lines'
                    AND policyname = 'kitchen_waste_lines_writers_insert') THEN
    EXECUTE format(
      'CREATE POLICY kitchen_waste_lines_writers_insert ON public.kitchen_waste_lines'
      || ' FOR INSERT WITH CHECK ((%s) AND %s)', writers, same_company);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'kitchen_waste_lines'
                    AND policyname = 'kitchen_waste_lines_writers_update') THEN
    EXECUTE format(
      'CREATE POLICY kitchen_waste_lines_writers_update ON public.kitchen_waste_lines'
      || ' FOR UPDATE USING (%s) WITH CHECK ((%s) AND %s)', writers, writers, same_company);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'kitchen_waste_lines'
                    AND policyname = 'kitchen_waste_lines_writers_delete') THEN
    EXECUTE format(
      'CREATE POLICY kitchen_waste_lines_writers_delete ON public.kitchen_waste_lines'
      || ' FOR DELETE USING (%s)', writers);
  END IF;
END
$$;

GRANT ALL ON TABLE public.kitchen_waste_lines TO authenticated, service_role;

COMMIT;
