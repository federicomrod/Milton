-- 083_pos_sales_mappings.sql
--
-- Add pos_sales_mappings to restaurant_company_settings to store column
-- mapping configurations for sales file uploads from non-Revel POS systems.
--
-- Context: Issue #531 — clients without Odoo (Fuel, El Malevo) need to
-- upload sales exports with different column layouts. This stores the
-- user-confirmed column mapping per company, keyed by header fingerprint,
-- so the next upload of the same layout auto-applies the saved mapping.
--
-- Structure: JSONB array where each element is:
-- {
--   "header_fingerprint": "sha256_of_sorted_headers",
--   "mapping_name": "Fuel POS" (user-editable label),
--   "column_mapping": {
--     "date": "Fecha",
--     "product": "Producto",
--     "quantity": "Cantidad",
--     "net_amount": "Importe Neto",
--     ...
--   },
--   "date_format": "DD/MM/YYYY" (detected format hint),
--   "decimal_separator": "comma" | "dot",
--   "created_at": "2026-11-23T...",
--   "last_used": "2026-11-23T..."
-- }
--
-- Additive-only: adds one nullable JSONB column to an existing table.
-- Never applied to production — the PR explains the migration and leaves
-- it for manual review.

ALTER TABLE public.restaurant_company_settings
  ADD COLUMN IF NOT EXISTS pos_sales_mappings JSONB NULL;

COMMENT ON COLUMN public.restaurant_company_settings.pos_sales_mappings IS
  'Array of saved column mappings for sales file uploads. Each mapping is ' ||
  'identified by a header_fingerprint (hash of sorted column names) so ' ||
  'subsequent uploads of the same layout auto-apply the saved mapping. ' ||
  'Added by migration 083 for issue #531.';
