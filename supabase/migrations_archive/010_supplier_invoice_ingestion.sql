-- 010_supplier_invoice_ingestion.sql
--
-- Milestone 2 / Stage 1 schema for Milton's supplier invoice ingestion.
--
--   supplier_invoices         — invoice header (manual or uploaded).
--   supplier_invoice_lines    — line items, with match/review status.
--   invoice_events            — audit trail (created/uploaded/approved/posted...).
--
-- Cost entries (ingredient_cost_entries) are NOT written by this schema —
-- they are written by the /api/restaurant/invoices/:id/approve route only
-- after a human reviews and approves the invoice lines. That route stamps
-- ingredient_cost_entries.source_type='invoice_line' and source_id with the
-- supplier_invoice_lines.id so cost history is fully traceable.
--
-- IMPORTANT — manual application:
--   Paste this file into the Supabase SQL Editor and run it. Repo CI does
--   NOT apply migrations automatically. All statements are idempotent.

-- ===========================================================================
-- A. supplier_invoices  (header)
--
-- Replaces / supersedes any legacy `supplier_invoices` table defined in
-- types/restaurant.ts. The drop-then-create dance is gated by EXISTS so
-- environments that have never had the legacy table are unaffected; the
-- legacy table was never wired to product code (no INSERTs in the repo),
-- so this is safe.
-- ===========================================================================

-- If a legacy `supplier_invoices` table exists without the columns we need
-- below, drop it (CASCADE picks up any legacy `supplier_invoice_lines`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_invoices'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_invoices'
      AND column_name = 'source_type'
  ) THEN
    DROP TABLE IF EXISTS public.supplier_invoice_lines CASCADE;
    DROP TABLE IF EXISTS public.supplier_invoices       CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id             uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_number          text,
  invoice_date            date NOT NULL,
  due_date                date,
  currency                text NOT NULL DEFAULT 'MXN',
  subtotal                numeric(14,4),
  tax_amount              numeric(14,4),
  total_amount            numeric(14,4),
  status                  text NOT NULL DEFAULT 'draft',
  source_type             text NOT NULL DEFAULT 'manual',
  original_file_name      text,
  notes                   text,
  created_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_invoices_status_chk
    CHECK (status IN ('draft','needs_review','approved','rejected','posted')),
  CONSTRAINT supplier_invoices_source_type_chk
    CHECK (source_type IN ('manual','csv','xlsx','pdf','image','email','api'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_status_date
  ON public.supplier_invoices (company_id, status, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_supplier_date
  ON public.supplier_invoices (company_id, supplier_id, invoice_date DESC);

-- ===========================================================================
-- B. supplier_invoice_lines  (line items)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.supplier_invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id            uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  supplier_id           uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ingredient_id         uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  supplier_item_name    text,
  supplier_sku          text,
  description           text NOT NULL,
  quantity              numeric(14,4) NOT NULL,
  unit                  text NOT NULL,
  unit_cost             numeric(14,6),
  line_total            numeric(14,4) NOT NULL,
  tax_amount            numeric(14,4),
  normalized_unit       text,
  normalized_unit_cost  numeric(14,6),
  match_status          text NOT NULL DEFAULT 'unmatched',
  review_status         text NOT NULL DEFAULT 'pending',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_invoice_lines_match_chk
    CHECK (match_status IN ('unmatched','matched','auto_matched','ignored')),
  CONSTRAINT supplier_invoice_lines_review_chk
    CHECK (review_status IN ('pending','approved','rejected')),
  CONSTRAINT supplier_invoice_lines_quantity_chk
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company_invoice
  ON public.supplier_invoice_lines (company_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company_ingredient
  ON public.supplier_invoice_lines (company_id, ingredient_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company_match_review
  ON public.supplier_invoice_lines (company_id, match_status, review_status);

-- ===========================================================================
-- C. invoice_events  (audit trail)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.invoice_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_events_event_type_chk
    CHECK (event_type IN (
      'created',
      'uploaded',
      'line_matched',
      'line_approved',
      'approved',
      'posted',
      'rejected',
      'note_added'
    ))
);

CREATE INDEX IF NOT EXISTS idx_invoice_events_company_invoice_created
  ON public.invoice_events (company_id, invoice_id, created_at DESC);

-- ===========================================================================
-- updated_at trigger (only if helper exists)
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_supplier_invoices_updated_at ON public.supplier_invoices;
    CREATE TRIGGER trg_supplier_invoices_updated_at
      BEFORE UPDATE ON public.supplier_invoices
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_supplier_invoice_lines_updated_at ON public.supplier_invoice_lines;
    CREATE TRIGGER trg_supplier_invoice_lines_updated_at
      BEFORE UPDATE ON public.supplier_invoice_lines
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
ALTER TABLE public.supplier_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events         ENABLE ROW LEVEL SECURITY;

-- supplier_invoices
DROP POLICY IF EXISTS supplier_invoices_select ON public.supplier_invoices;
CREATE POLICY supplier_invoices_select ON public.supplier_invoices
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoices_insert ON public.supplier_invoices;
CREATE POLICY supplier_invoices_insert ON public.supplier_invoices
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoices_update ON public.supplier_invoices;
CREATE POLICY supplier_invoices_update ON public.supplier_invoices
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoices_delete ON public.supplier_invoices;
CREATE POLICY supplier_invoices_delete ON public.supplier_invoices
  FOR DELETE USING (public.is_company_member(company_id));

-- supplier_invoice_lines
DROP POLICY IF EXISTS supplier_invoice_lines_select ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_select ON public.supplier_invoice_lines
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoice_lines_insert ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_insert ON public.supplier_invoice_lines
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoice_lines_update ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_update ON public.supplier_invoice_lines
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS supplier_invoice_lines_delete ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_delete ON public.supplier_invoice_lines
  FOR DELETE USING (public.is_company_member(company_id));

-- invoice_events
DROP POLICY IF EXISTS invoice_events_select ON public.invoice_events;
CREATE POLICY invoice_events_select ON public.invoice_events
  FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS invoice_events_insert ON public.invoice_events;
CREATE POLICY invoice_events_insert ON public.invoice_events
  FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS invoice_events_update ON public.invoice_events;
CREATE POLICY invoice_events_update ON public.invoice_events
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS invoice_events_delete ON public.invoice_events;
CREATE POLICY invoice_events_delete ON public.invoice_events
  FOR DELETE USING (public.is_company_member(company_id));

-- ===========================================================================
-- ingredient_cost_entries.source_type — allow 'invoice_line'
--
-- The cost-history table was created with a CHECK constraint that limits
-- source_type to ('manual','invoice_line','import','api'). 'invoice_line'
-- is already in the allowed list per the original migration; the approve
-- route below relies on it. No alteration needed here. If a future
-- environment was built without 'invoice_line' in the allowed list, that
-- migration is the place to extend it.
-- ===========================================================================
