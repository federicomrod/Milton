-- 007_supplier_ingredient_management.sql
--
-- Adds optional contact and metadata columns to the suppliers table.
-- The table already exists (created outside migrations or in an earlier
-- session). This migration is idempotent — all ALTER TABLE statements
-- use IF NOT EXISTS.
--
-- IMPORTANT: paste this file into the Supabase SQL Editor and run it.

-- Contact fields -------------------------------------------------------
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact_name   text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone          text;

-- Metadata -------------------------------------------------------------
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS notes          text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address        text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_terms  text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tax_id         text;

-- updated_at (may already exist — add only if missing) -----------------
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS updated_at
  timestamptz NOT NULL DEFAULT now();

-- Normalise the status column default to 'active' if not already set.
-- (The bulk-cost upload already inserts status='active'; this ensures
--  any supplier rows that somehow have NULL status render correctly.)
UPDATE public.suppliers SET status = 'active' WHERE status IS NULL;

-- RLS: suppliers must already have RLS policies from the original schema.
-- We do NOT recreate them here to avoid clobbering existing config.
-- If RLS was not enabled on suppliers, enable it now:
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Only add policies if they do not exist yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'suppliers'
      AND policyname = 'suppliers_select'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY suppliers_select ON public.suppliers
        FOR SELECT USING (public.is_company_member(company_id));
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'suppliers'
      AND policyname = 'suppliers_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY suppliers_insert ON public.suppliers
        FOR INSERT WITH CHECK (public.is_company_member(company_id));
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'suppliers'
      AND policyname = 'suppliers_update'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY suppliers_update ON public.suppliers
        FOR UPDATE USING (public.is_company_member(company_id))
                    WITH CHECK (public.is_company_member(company_id));
    $pol$;
  END IF;
END $$;
