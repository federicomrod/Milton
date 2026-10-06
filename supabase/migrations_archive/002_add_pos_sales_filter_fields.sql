-- 002_add_pos_sales_filter_fields.sql
--
-- Adds payment_type, category, sub_category to pos_sales_items so the
-- restaurant cockpit (components/restaurant/RestaurantSalesExplorer.tsx)
-- can offer payment/category breakdowns and filters.
--
-- All columns are nullable so existing rows remain valid (they will simply
-- show as "Unknown payment type" / "Uncategorized" in the UI until the POS
-- file is re-uploaded with the new mapping).
--
-- Indexes are composite (company_id, <field>) because every restaurant
-- cockpit query is scoped by company_id first; this matches the existing
-- access pattern and supports both straight `WHERE company_id = X` and
-- `WHERE company_id = X AND category = Y` lookups.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- being applied from the repo by CI yet, so the SQL below must also be
-- pasted manually into the Supabase SQL Editor (see the task report).

ALTER TABLE public.pos_sales_items
  ADD COLUMN IF NOT EXISTS payment_type text NULL,
  ADD COLUMN IF NOT EXISTS category text NULL,
  ADD COLUMN IF NOT EXISTS sub_category text NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_payment_type
  ON public.pos_sales_items(company_id, payment_type);

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_category
  ON public.pos_sales_items(company_id, category);

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_sub_category
  ON public.pos_sales_items(company_id, sub_category);
