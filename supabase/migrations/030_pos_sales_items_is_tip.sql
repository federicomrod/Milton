-- 030_pos_sales_items_is_tip.sql
--
-- Cockpit redesign step 1 (GitHub #123): mark Propina / tip lines so
-- revenue KPIs can exclude them. Tips stay in the table — they are not
-- deleted — and the cockpit reports them on their own line.
--
-- DESIGN: Additive and idempotent. No DROP. Existing rows stay NULL
-- until the best-effort name backfill below (or a later Odoo re-sync,
-- which sets is_tip from the same name matcher in
-- lib/restaurant/odoo/sync.ts).
--
-- Re-sync: NOT required for cockpit numbers. The app also classifies
-- tips from raw_item_name (Propina / tip) when is_tip is NULL, so the
-- already-synced July staging rows work immediately after this
-- migration is applied. Re-sync only if you want the column populated
-- for names the SQL backfill cannot accent-fold.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 029. No production apply as part
-- of this PR.

ALTER TABLE public.pos_sales_items
  ADD COLUMN IF NOT EXISTS is_tip boolean NULL;

COMMENT ON COLUMN public.pos_sales_items.is_tip IS
  'True when the POS line is a tip / Propina. NULL on legacy rows; readers fall back to the product name.';

CREATE INDEX IF NOT EXISTS idx_pos_sales_items_company_is_tip
  ON public.pos_sales_items (company_id, is_tip)
  WHERE is_tip IS TRUE;

-- Best-effort backfill for already-synced Propina / tip product names.
-- Accented variants (Propína) are classified at read time in
-- lib/restaurant/sales-revenue.ts until a re-sync writes is_tip.
UPDATE public.pos_sales_items
SET is_tip = true
WHERE is_tip IS NULL
  AND lower(trim(raw_item_name)) IN (
    'propina',
    'propinas',
    'tip',
    'tips',
    'gratuity',
    'gratuities'
  );
