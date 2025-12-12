-- Comprehensive migration to create all necessary tables for Milton
-- This migration creates all tables referenced in the application

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  description TEXT,
  category TEXT,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date);

-- ============================================================================
-- 2. CRM_DEALS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.crm_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_name TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  stage TEXT NOT NULL,
  phase TEXT NOT NULL, -- Legacy field, required NOT NULL
  company TEXT,
  owner TEXT,
  product TEXT,
  created_date TIMESTAMPTZ,
  close_date TIMESTAMPTZ,
  closing_date TIMESTAMPTZ, -- Alternative column name used in some queries
  client_name TEXT, -- Used in report-data-service
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_user_id ON public.crm_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_product ON public.crm_deals(product);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON public.crm_deals(stage);
CREATE INDEX IF NOT EXISTS idx_crm_deals_close_date ON public.crm_deals(close_date);

-- ============================================================================
-- 3. BUDGETS TABLE (This is the missing table causing the error)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- e.g., "2025-01" or "Jan 2025"
  category TEXT NOT NULL,
  value NUMERIC(15, 2) NOT NULL,
  planned_amount NUMERIC(15, 2), -- Used in semantic-query-service
  actual_amount NUMERIC(15, 2), -- Used in semantic-query-service
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON public.budgets(month);
CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON public.budgets(user_id, month);

-- ============================================================================
-- 4. PROFILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  industry TEXT,
  timezone TEXT,
  currency TEXT,
  date_format TEXT,
  number_format TEXT,
  theme TEXT,
  email TEXT,
  billing_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- ============================================================================
-- 5. BUSINESS_MODELS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.business_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_type TEXT,
  selected_kpi_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_models_user_id ON public.business_models(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_models_user_unique ON public.business_models(user_id);

-- ============================================================================
-- 6. KPI_SNAPSHOTS_DATA TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.kpi_snapshots_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- e.g., "2025-01-01"
  revenue NUMERIC(15, 2) DEFAULT 0,
  expenses NUMERIC(15, 2) DEFAULT 0,
  net_income NUMERIC(15, 2) DEFAULT 0,
  burn_rate NUMERIC(15, 2),
  cash_runway NUMERIC(15, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_user_id ON public.kpi_snapshots_data(user_id);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_period ON public.kpi_snapshots_data(period);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_user_period ON public.kpi_snapshots_data(user_id, period);

-- ============================================================================
-- 7. CUSTOM_DATASETS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.custom_datasets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_type TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  schema_json JSONB DEFAULT '[]'::jsonb,
  rows_json JSONB DEFAULT '[]'::jsonb,
  source_meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_datasets_user_id ON public.custom_datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_datasets_type ON public.custom_datasets(dataset_type);

-- ============================================================================
-- 8. TABLE_STATUS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.table_status (
  table_name TEXT PRIMARY KEY,
  readiness_state TEXT NOT NULL DEFAULT 'pending' CHECK (readiness_state IN ('pending', 'linked', 'insightable')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 9. BUSINESS_MODEL_TEMPLATES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.business_model_templates (
  key TEXT PRIMARY KEY,
  kpi_recipes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_snapshots_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_model_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users can view their own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);

-- CRM Deals policies
CREATE POLICY "Users can view their own crm_deals"
  ON public.crm_deals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own crm_deals"
  ON public.crm_deals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own crm_deals"
  ON public.crm_deals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own crm_deals"
  ON public.crm_deals FOR DELETE
  USING (auth.uid() = user_id);

-- Budgets policies
CREATE POLICY "Users can view their own budgets"
  ON public.budgets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own budgets"
  ON public.budgets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own budgets"
  ON public.budgets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own budgets"
  ON public.budgets FOR DELETE
  USING (auth.uid() = user_id);

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Business Models policies
CREATE POLICY "Users can view their own business_models"
  ON public.business_models FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own business_models"
  ON public.business_models FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own business_models"
  ON public.business_models FOR UPDATE
  USING (auth.uid() = user_id);

-- KPI Snapshots policies
CREATE POLICY "Users can view their own kpi_snapshots_data"
  ON public.kpi_snapshots_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own kpi_snapshots_data"
  ON public.kpi_snapshots_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own kpi_snapshots_data"
  ON public.kpi_snapshots_data FOR UPDATE
  USING (auth.uid() = user_id);

-- Custom Datasets policies
CREATE POLICY "Users can view their own custom_datasets"
  ON public.custom_datasets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own custom_datasets"
  ON public.custom_datasets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own custom_datasets"
  ON public.custom_datasets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own custom_datasets"
  ON public.custom_datasets FOR DELETE
  USING (auth.uid() = user_id);

-- Table Status policies (users can view all, but only modify their own table statuses)
CREATE POLICY "Users can view table_status"
  ON public.table_status FOR SELECT
  USING (true);

CREATE POLICY "Users can insert table_status"
  ON public.table_status FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update table_status"
  ON public.table_status FOR UPDATE
  USING (true);

-- Business Model Templates policies (read-only for all authenticated users)
CREATE POLICY "Users can view business_model_templates"
  ON public.business_model_templates FOR SELECT
  USING (true);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crm_deals_updated_at
  BEFORE UPDATE ON public.crm_deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_business_models_updated_at
  BEFORE UPDATE ON public.business_models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kpi_snapshots_data_updated_at
  BEFORE UPDATE ON public.kpi_snapshots_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_datasets_updated_at
  BEFORE UPDATE ON public.custom_datasets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE public.transactions IS 'Bank and financial transactions for each user';
COMMENT ON TABLE public.crm_deals IS 'CRM deals and pipeline data for each user';
COMMENT ON TABLE public.budgets IS 'Budget planning data with monthly categories and amounts';
COMMENT ON TABLE public.profiles IS 'User profile and preferences';
COMMENT ON TABLE public.business_models IS 'User business model configuration and selected KPIs';
COMMENT ON TABLE public.kpi_snapshots_data IS 'Monthly KPI snapshots aggregated from transactions';
COMMENT ON TABLE public.custom_datasets IS 'Custom datasets uploaded by users';
COMMENT ON TABLE public.table_status IS 'Tracks readiness state of datasets (pending/linked/insightable)';
COMMENT ON TABLE public.business_model_templates IS 'Template definitions for business models and KPI recipes';

