-- 006_costing_foundation.sql
--
-- Deterministic costing foundation: ingredient cost history.
--
-- Why a separate table:
--   ingredients.current_unit_cost is a single-value cache that loses
--   history. We want to keep every cost observation — manual entries
--   today, supplier-invoice lines later — so the cockpit can:
--     * pick the most recent cost as-of any date,
--     * audit how a cost moved over time,
--     * back out a misclick by deleting one entry rather than overwriting.
--
-- Layout:
--   * (quantity, unit, total_cost, unit_cost) describe the observation
--     in the SUPPLIER's units (e.g. 10 kg for 3,700 MXN → 370 MXN/kg).
--   * (normalized_unit, normalized_unit_cost) re-express that cost in
--     the cockpit's canonical unit for the ingredient (typically the
--     ingredient's `default_unit`). The costing engine reads ONLY the
--     normalized fields — keeping the original observation alongside
--     lets us audit conversions and let future LLM agents reason about
--     the raw invoice line.
--
-- IMPORTANT: paste this file into the Supabase SQL Editor and run it.
-- The migration is idempotent so re-running is safe.

CREATE TABLE IF NOT EXISTS public.ingredient_cost_entries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ingredient_id          uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  supplier_id            uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,

  -- Provenance. We anticipate the same shape feeding from supplier
  -- invoices and (later) an importer or third-party API; the dashboard
  -- already filters by source_type in mixed datasets.
  source_type            text NOT NULL DEFAULT 'manual',
  source_id              uuid,

  cost_date              date NOT NULL,

  -- Observation as recorded (e.g. "10 kg for 3,700"). All fields are
  -- needed because supplier invoices won't always pre-normalize.
  quantity               numeric(14,4) NOT NULL,
  unit                   text NOT NULL,
  total_cost             numeric(14,4) NOT NULL,
  unit_cost              numeric(14,6) NOT NULL,

  -- Cockpit-canonical projection. The costing engine reads these.
  normalized_unit        text NOT NULL,
  normalized_unit_cost   numeric(14,6) NOT NULL,

  currency               text NOT NULL DEFAULT 'MXN',
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingredient_cost_entries_source_type_chk
    CHECK (source_type IN ('manual', 'invoice_line', 'import', 'api')),
  CONSTRAINT ingredient_cost_entries_quantity_chk
    CHECK (quantity > 0),
  CONSTRAINT ingredient_cost_entries_total_cost_chk
    CHECK (total_cost >= 0),
  CONSTRAINT ingredient_cost_entries_unit_cost_chk
    CHECK (unit_cost >= 0),
  CONSTRAINT ingredient_cost_entries_norm_unit_cost_chk
    CHECK (normalized_unit_cost >= 0)
);

-- Read patterns the cockpit uses:
--   1. "Latest cost for this ingredient (asc by date desc)"     → index 1
--   2. "All entries from supplier X"                            → index 2
--   3. "All entries from invoice lines / manual"                → index 3
CREATE INDEX IF NOT EXISTS idx_ingredient_cost_entries_company_ing_date
  ON public.ingredient_cost_entries (company_id, ingredient_id, cost_date DESC);

CREATE INDEX IF NOT EXISTS idx_ingredient_cost_entries_company_supplier
  ON public.ingredient_cost_entries (company_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_cost_entries_company_source
  ON public.ingredient_cost_entries (company_id, source_type);

-- Row Level Security ---------------------------------------------------------
ALTER TABLE public.ingredient_cost_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredient_cost_entries_select ON public.ingredient_cost_entries;
CREATE POLICY ingredient_cost_entries_select ON public.ingredient_cost_entries
  FOR SELECT USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS ingredient_cost_entries_insert ON public.ingredient_cost_entries;
CREATE POLICY ingredient_cost_entries_insert ON public.ingredient_cost_entries
  FOR INSERT WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS ingredient_cost_entries_update ON public.ingredient_cost_entries;
CREATE POLICY ingredient_cost_entries_update ON public.ingredient_cost_entries
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS ingredient_cost_entries_delete ON public.ingredient_cost_entries;
CREATE POLICY ingredient_cost_entries_delete ON public.ingredient_cost_entries
  FOR DELETE USING (public.is_company_member(company_id));
