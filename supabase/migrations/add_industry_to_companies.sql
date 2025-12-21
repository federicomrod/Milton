-- Add industry column to companies table if it doesn't exist
-- This migration is safe to run multiple times

-- Check if column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'companies' 
    AND column_name = 'industry'
  ) THEN
    ALTER TABLE public.companies ADD COLUMN industry TEXT;
  END IF;
END $$;

