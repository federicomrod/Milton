-- Create dashboard_insights table to persist AI-generated insights
CREATE TABLE IF NOT EXISTS public.dashboard_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('positive', 'warning', 'info', 'action')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_user_id ON public.dashboard_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_insights_created_at ON public.dashboard_insights(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.dashboard_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own insights"
  ON public.dashboard_insights FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own insights"
  ON public.dashboard_insights FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own insights"
  ON public.dashboard_insights FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own insights"
  ON public.dashboard_insights FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_dashboard_insights_updated_at
  BEFORE UPDATE ON public.dashboard_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

