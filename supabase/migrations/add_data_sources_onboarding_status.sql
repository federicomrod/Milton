-- Add 'data_sources' to the allowed values for companies.onboarding_status
-- First, drop the existing constraint (if it exists)
DO $$
DECLARE
    constraint_name text;
BEGIN
    -- Find the constraint name on onboarding_status column
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.companies'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%onboarding_status%';
    
    -- Drop it if found
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.companies DROP CONSTRAINT %I', constraint_name);
    END IF;
END
$$;

-- Add new constraint with 'data_sources' included
ALTER TABLE public.companies
ADD CONSTRAINT companies_onboarding_status_check 
CHECK (onboarding_status IN (
    'not_started',
    'chat',
    'data_sources',
    'kpi_selection',
    'upload',
    'model',
    'completed'
));

