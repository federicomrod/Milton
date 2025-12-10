-- Add product column to crm_deals table
-- This column stores the product/service type for each deal

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS product text;

-- Add index for better query performance when filtering by product
CREATE INDEX IF NOT EXISTS idx_crm_deals_product ON crm_deals(product);

-- Add comment for documentation
COMMENT ON COLUMN crm_deals.product IS 'Product or service type associated with the deal';

