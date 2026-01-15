-- Create uploaded_files table to track individual file uploads
CREATE TABLE IF NOT EXISTS public.uploaded_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  dataset_type TEXT NOT NULL CHECK (dataset_type IN ('bank', 'crm', 'budget')),
  table_name TEXT NOT NULL, -- 'transactions', 'crm_deals', or 'budgets'
  row_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_name, uploaded_at) -- Allow same filename if uploaded at different times
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_user_id ON public.uploaded_files(user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_dataset_type ON public.uploaded_files(dataset_type);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_uploaded_at ON public.uploaded_files(uploaded_at DESC);

-- Enable RLS
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own uploaded files"
  ON public.uploaded_files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own uploaded files"
  ON public.uploaded_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploaded files"
  ON public.uploaded_files FOR DELETE
  USING (auth.uid() = user_id);

-- Add upload_file_id columns to data tables for tracking
-- Note: These will be nullable to support existing data
DO $$
BEGIN
  -- Add to transactions if column doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'transactions' 
    AND column_name = 'upload_file_id'
  ) THEN
    ALTER TABLE public.transactions 
    ADD COLUMN upload_file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_transactions_upload_file_id 
    ON public.transactions(upload_file_id);
  END IF;

  -- Add to crm_deals if column doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'crm_deals' 
    AND column_name = 'upload_file_id'
  ) THEN
    ALTER TABLE public.crm_deals 
    ADD COLUMN upload_file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_crm_deals_upload_file_id 
    ON public.crm_deals(upload_file_id);
  END IF;

  -- Add to budgets if column doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'budgets' 
    AND column_name = 'upload_file_id'
  ) THEN
    ALTER TABLE public.budgets 
    ADD COLUMN upload_file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_budgets_upload_file_id 
    ON public.budgets(upload_file_id);
  END IF;
END
$$;

