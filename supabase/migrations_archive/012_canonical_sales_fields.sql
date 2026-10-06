-- 012_canonical_sales_fields.sql
--
-- Canonical sales model foundation (GitHub Issue #1).
--
-- Milton's first real pilot uses Odoo 18 Enterprise. Before building any
-- Odoo-specific ingestion, sales data from every source (Revel today;
-- Odoo, other POS systems, and CSV uploads later) needs to land in a
-- consistent internal shape. This migration adds the columns that shape
-- needs on top of the existing pos_sales_items table — no new tables, no
-- adapter framework, no changes to ingestion or costing logic.
--
-- pos_source identifies the ORIGINATING POS/business system (e.g.
-- "revel", "odoo", "toast", "square"). It is deliberately free text with
-- NO CHECK constraint: onboarding a new POS source should never require a
-- database migration. This is distinct from the existing `source_type`
-- column (CHECK'd to 'manual' | 'csv' | 'xlsx' | 'api'), which records
-- the ingestion MECHANISM, not the originating system, and is untouched
-- by this migration.
--
-- All changes are additive:
--   * pos_source is NOT NULL with a DEFAULT, so the ADD COLUMN backfills
--     every existing row to 'revel' (the only source ingested so far) in
--     the same statement — no separate UPDATE needed.
--   * every other new column is nullable, so existing rows are valid with
--     no backfill at all.
-- No existing column, constraint, index, or RLS policy is modified. The
-- existing demo/mock data path does not read this table and is
-- unaffected.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

ALTER TABLE public.pos_sales_items
  ADD COLUMN IF NOT EXISTS pos_source text NOT NULL DEFAULT 'revel',
  ADD COLUMN IF NOT EXISTS external_line_id text NULL,
  ADD COLUMN IF NOT EXISTS unit_price numeric NULL,
  ADD COLUMN IF NOT EXISTS order_placed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NULL;
