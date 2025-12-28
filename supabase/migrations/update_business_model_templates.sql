-- Migration: Update business_model_templates table structure
-- Adds new fields based on Confluence structure:
-- name, description, required_tables_data, required_relationships, kpi_ids, filters, mvp_guardrails, data_categories

-- Add new columns
ALTER TABLE public.business_model_templates
  -- Basic info
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  
  -- New structure fields
  ADD COLUMN IF NOT EXISTS required_tables_data JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_relationships JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kpi_ids JSONB DEFAULT '[]'::jsonb, -- Array of KPI IDs referencing separate KPIs table
  ADD COLUMN IF NOT EXISTS filters JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mvp_guardrails JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS data_categories JSONB DEFAULT '[]'::jsonb;

-- Drop the legacy kpi_recipes column (since no one uses the app yet)
ALTER TABLE public.business_model_templates
  DROP COLUMN IF EXISTS kpi_recipes;

-- Add comments for documentation
COMMENT ON COLUMN public.business_model_templates.key IS 'Unique identifier for the business model template (e.g., "saas", "agency")';
COMMENT ON COLUMN public.business_model_templates.name IS 'Display name of the business model template';
COMMENT ON COLUMN public.business_model_templates.description IS 'Detailed description of the business model template';
COMMENT ON COLUMN public.business_model_templates.required_tables_data IS 'JSONB array of required tables/data sources for this business model';
COMMENT ON COLUMN public.business_model_templates.required_relationships IS 'JSONB array of required relationships between tables';
COMMENT ON COLUMN public.business_model_templates.kpi_ids IS 'JSONB array of KPI IDs that reference the KPIs table';
COMMENT ON COLUMN public.business_model_templates.filters IS 'JSONB array of filter definitions for this business model';
COMMENT ON COLUMN public.business_model_templates.mvp_guardrails IS 'JSONB object containing MVP guardrails and validation rules';
COMMENT ON COLUMN public.business_model_templates.data_categories IS 'JSONB array of data categories required for this business model';

-- Create index on name for faster lookups
CREATE INDEX IF NOT EXISTS idx_business_model_templates_name ON public.business_model_templates(name);

