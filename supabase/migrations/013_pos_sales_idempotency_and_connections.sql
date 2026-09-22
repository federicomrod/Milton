-- 013_pos_sales_idempotency_and_connections.sql
--
-- Foundation for POS-source sync jobs (GitHub Issue #3, first consumer:
-- Odoo 18). Two additive, independent changes:
--
--   1. A generic idempotency index on pos_sales_items. The uniqueness rule
--      (company_id, pos_source, external_line_id) is canonical — it is not
--      Odoo-specific, so any future source that can supply a stable
--      external_line_id (not just Odoo) gets safe upsert-based dedup for
--      free. Partial (WHERE external_line_id IS NOT NULL) so existing
--      Revel rows, which never populate external_line_id, are completely
--      unaffected — Postgres never evaluates this index against them.
--
--   2. restaurant_pos_connections: per-restaurant NON-SECRET connection
--      configuration for POS sources that require live API access (as
--      opposed to Revel's file-upload flow, which needs no stored
--      connection at all). Deliberately excludes any credential/secret
--      column — for the Odoo sandbox implementation the API key is read
--      from a server-side environment variable
--      (ODOO_SANDBOX_API_KEY), never stored in the database and never
--      sent to the browser. Production per-tenant secret storage is a
--      separate, later decision (see Issue #3 analysis) and is
--      intentionally not implemented here.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

-- ---------------------------------------------------------------------------
-- 1. Idempotency index
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_items_source_line_uniq
  ON public.pos_sales_items (company_id, pos_source, external_line_id)
  WHERE external_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. restaurant_pos_connections — non-secret per-restaurant config
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_pos_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Matches pos_sales_items.pos_source in spirit (free text, no CHECK —
  -- onboarding a new POS source should never require a migration here
  -- either).
  pos_source     text NOT NULL,

  base_url       text NOT NULL,
  database_name  text NOT NULL,
  username       text NOT NULL,

  -- IANA timezone name (e.g. "America/Mexico_City"). Required to derive
  -- pos_sales_items.sale_date correctly from Odoo's UTC date_order —
  -- deliberately NOT hard-coded anywhere in application code.
  timezone       text NOT NULL,

  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- One connection row per (company, source). Re-configuring is an
  -- UPDATE, not a second row.
  CONSTRAINT restaurant_pos_connections_uniq
    UNIQUE (company_id, pos_source)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_connections_company
  ON public.restaurant_pos_connections(company_id);

-- Row Level Security ---------------------------------------------------------
ALTER TABLE public.restaurant_pos_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_pos_connections_select ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_select ON public.restaurant_pos_connections
  FOR SELECT USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_insert ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_insert ON public.restaurant_pos_connections
  FOR INSERT WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_update ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_update ON public.restaurant_pos_connections
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_delete ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_delete ON public.restaurant_pos_connections
  FOR DELETE USING (public.is_company_member(company_id));
