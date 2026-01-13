-- Create user_data_sources table to track which tools/systems users declare they use
CREATE TABLE IF NOT EXISTS public.user_data_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('online_banking', 'crm', 'accounting', 'expense_management', 'hr', 'cms', 'g_docs')),
  tool_name TEXT NOT NULL,
  other_text TEXT, -- For free-text "other" entries
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_user_data_sources_user_id ON public.user_data_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_sources_category ON public.user_data_sources(category);

-- Enable RLS
ALTER TABLE public.user_data_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own data sources"
  ON public.user_data_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own data sources"
  ON public.user_data_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own data sources"
  ON public.user_data_sources FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own data sources"
  ON public.user_data_sources FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at (create function if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $function$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $function$ LANGUAGE plpgsql;
  END IF;
END
$$;

CREATE TRIGGER update_user_data_sources_updated_at
  BEFORE UPDATE ON public.user_data_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

