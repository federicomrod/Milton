-- 064_restaurant_fixed_costs.sql
--
-- Rentabilidad + Costos fijos, Fase 1a (issue #396, epic #415). Monthly fixed
-- costs per restaurant (or shared by the whole group), the change history and
-- the draft storage for uploaded cost files (used later by #409).
--
--   restaurant_fixed_costs       one row per (company, restaurant|group, month,
--                                category). planilla / alquiler / servicios /
--                                otros store an AMOUNT; impuestos stores a
--                                PERCENT of sales (sales tax) and no amount.
--                                A typed 0 is stored as 0; an empty field is
--                                no row (missing is never $0).
--   restaurant_fixed_costs_log   one row per change, for the history list.
--   fixed_cost_upload_drafts     draft -> approve storage for uploaded files.
--                                NOT the 044 table (044 is one draft per
--                                company, specific to the cost workbook).
--
-- DESIGN: Additive. Three new company-scoped tables with RLS
-- (public.is_company_member), same pattern as 062. No DROP, no ALTER of
-- existing tables, no data changes.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton
-- Staging first; production only after Fede says yes.

CREATE TABLE IF NOT EXISTS public.restaurant_fixed_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NULL = shared by the whole group (split across restaurants by split_rule).
  location_id    uuid NULL,
  -- First day of the month.
  month          date NOT NULL,
  category       text NOT NULL,
  label          text NULL,
  amount         numeric(14, 2) NULL,
  pct_of_sales   numeric(5, 2) NULL,
  currency       text NOT NULL,
  source         text NOT NULL DEFAULT 'manual',
  status         text NOT NULL DEFAULT 'draft',
  repeats        boolean NOT NULL DEFAULT false,
  split_rule     text NULL,
  estimate_meta  jsonb NULL,
  created_by     uuid NULL,
  updated_by     uuid NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_fixed_costs_category_chk
    CHECK (category IN ('planilla', 'alquiler', 'servicios', 'otros', 'impuestos')),
  CONSTRAINT restaurant_fixed_costs_source_chk
    CHECK (source IN ('manual', 'repeat', 'estimate', 'upload')),
  CONSTRAINT restaurant_fixed_costs_status_chk
    CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT restaurant_fixed_costs_split_rule_chk
    CHECK (split_rule IS NULL OR split_rule IN ('sales', 'equal')),
  CONSTRAINT restaurant_fixed_costs_month_chk
    CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT restaurant_fixed_costs_amount_chk
    CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT restaurant_fixed_costs_pct_chk
    CHECK (pct_of_sales IS NULL OR (pct_of_sales >= 0 AND pct_of_sales <= 100)),
  -- impuestos: a % and no amount. Every other category: an amount and no %.
  CONSTRAINT restaurant_fixed_costs_shape_chk
    CHECK (
      (category = 'impuestos' AND pct_of_sales IS NOT NULL AND amount IS NULL)
      OR
      (category <> 'impuestos' AND amount IS NOT NULL AND pct_of_sales IS NULL)
    )
);

-- One line per category in each scope (a restaurant, or the group) and month.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_fixed_costs_scope_month_category_uniq
  ON public.restaurant_fixed_costs (
    company_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    month,
    category
  );

CREATE INDEX IF NOT EXISTS restaurant_fixed_costs_company_location_month_idx
  ON public.restaurant_fixed_costs (company_id, location_id, month);

COMMENT ON TABLE public.restaurant_fixed_costs IS
  'Costos fijos por mes. planilla/alquiler/servicios/otros guardan un monto; impuestos guarda un % de las ventas y nunca un monto. Un 0 escrito cuenta como dato; un campo vacío es una fila que no existe, nunca $0.';

CREATE TABLE IF NOT EXISTS public.restaurant_fixed_costs_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- No FK: the history outlives a deleted line.
  fixed_cost_id  uuid NULL,
  location_id    uuid NULL,
  month          date NOT NULL,
  category       text NOT NULL,
  actor          uuid NULL,
  action         text NOT NULL,
  old_value      jsonb NULL,
  new_value      jsonb NULL,
  source         text NOT NULL DEFAULT 'manual',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_fixed_costs_log_action_chk
    CHECK (action IN ('create', 'update', 'delete', 'repeat')),
  CONSTRAINT restaurant_fixed_costs_log_source_chk
    CHECK (source IN ('manual', 'repeat', 'estimate', 'upload'))
);

CREATE INDEX IF NOT EXISTS restaurant_fixed_costs_log_company_created_idx
  ON public.restaurant_fixed_costs_log (company_id, created_at DESC);

COMMENT ON TABLE public.restaurant_fixed_costs_log IS
  'Historial de cambios de costos fijos: quién, cuándo, valor anterior y nuevo, y de dónde vino.';

CREATE TABLE IF NOT EXISTS public.fixed_cost_upload_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id    uuid NULL,
  month          date NULL,
  file_name      text NULL,
  storage_path   text NULL,
  parsed_lines   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'draft',
  created_by     uuid NULL,
  approved_by    uuid NULL,
  approved_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_cost_upload_drafts_status_chk
    CHECK (status IN ('draft', 'approved', 'discarded'))
);

CREATE INDEX IF NOT EXISTS fixed_cost_upload_drafts_company_status_idx
  ON public.fixed_cost_upload_drafts (company_id, status);

COMMENT ON TABLE public.fixed_cost_upload_drafts IS
  'Archivo de costos fijos subido: borrador hasta que alguien lo aprueba. No es la tabla de 044.';

ALTER TABLE public.restaurant_fixed_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_fixed_costs_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_cost_upload_drafts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  op text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'restaurant_fixed_costs',
    'restaurant_fixed_costs_log',
    'fixed_cost_upload_drafts'
  ]
  LOOP
    FOREACH op IN ARRAY ARRAY['select', 'insert', 'update', 'delete']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
          AND policyname = t || '_member_' || op
      ) THEN
        IF op = 'select' OR op = 'delete' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR %s USING (public.is_company_member(company_id))',
            t || '_member_' || op, t, upper(op));
        ELSIF op = 'insert' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_company_member(company_id))',
            t || '_member_' || op, t);
        ELSE
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id))',
            t || '_member_' || op, t);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

GRANT ALL ON TABLE public.restaurant_fixed_costs TO authenticated, service_role;
GRANT ALL ON TABLE public.restaurant_fixed_costs_log TO authenticated, service_role;
GRANT ALL ON TABLE public.fixed_cost_upload_drafts TO authenticated, service_role;
