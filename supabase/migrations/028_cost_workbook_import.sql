-- 028_cost_workbook_import.sql
--
-- Smart workbook import for ingredient costs (GitHub #113, step 1).
-- High-confidence rows save immediately into ingredient_cost_entries
-- (source_type='import', source_id=cost_import_batches.id). Low-confidence
-- or invalid rows are held in cost_import_review_items so they never
-- save silently and never block the cockpit. Confirmed tab/column maps
-- are remembered per restaurant + header layout so next month's file
-- skips the AI call. Each upload is one undoable batch.
--
-- DESIGN: Additive. No DROP. No changes to existing cost-entry columns
-- (batch linkage reuses source_id). RLS mirrors other company-scoped
-- tables via is_company_member.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- r1-staging before relying on workbook import, mapping memory, review
-- items, or undo. No production apply as part of this PR.

-- ---------------------------------------------------------------------------
-- 1. cost_import_batches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_import_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  filename        text NOT NULL,
  file_month      date NULL,
  currency        text NOT NULL,
  imported_count  int NOT NULL DEFAULT 0,
  review_count    int NOT NULL DEFAULT 0,
  tab_summaries   jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping_source  text NOT NULL DEFAULT 'ai'
                    CHECK (mapping_source IN ('ai', 'saved', 'mixed')),
  created_by      uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz NULL
);

CREATE INDEX IF NOT EXISTS cost_import_batches_company_created_idx
  ON public.cost_import_batches (company_id, created_at DESC);

ALTER TABLE public.cost_import_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_batches'
      AND policyname = 'cost_import_batches_select') THEN
    CREATE POLICY cost_import_batches_select ON public.cost_import_batches
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_batches'
      AND policyname = 'cost_import_batches_insert') THEN
    CREATE POLICY cost_import_batches_insert ON public.cost_import_batches
      FOR INSERT WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_batches'
      AND policyname = 'cost_import_batches_update') THEN
    CREATE POLICY cost_import_batches_update ON public.cost_import_batches
      FOR UPDATE USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_batches'
      AND policyname = 'cost_import_batches_delete') THEN
    CREATE POLICY cost_import_batches_delete ON public.cost_import_batches
      FOR DELETE USING (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.cost_import_batches TO anon;
GRANT ALL ON TABLE public.cost_import_batches TO authenticated;
GRANT ALL ON TABLE public.cost_import_batches TO service_role;

-- ---------------------------------------------------------------------------
-- 2. cost_import_layout_maps (confirmed mapping memory)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_import_layout_maps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  layout_key          text NOT NULL,
  tab_name            text NOT NULL,
  tab_type            text NOT NULL
                        CHECK (tab_type IN (
                          'price_list',
                          'category_cost',
                          'purchases',
                          'recipe',
                          'ignore'
                        )),
  column_mapping      jsonb NOT NULL DEFAULT '{}'::jsonb,
  header_fingerprint  text NOT NULL,
  tab_confidence      numeric(4,3) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, layout_key)
);

CREATE INDEX IF NOT EXISTS cost_import_layout_maps_company_idx
  ON public.cost_import_layout_maps (company_id);

ALTER TABLE public.cost_import_layout_maps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_layout_maps'
      AND policyname = 'cost_import_layout_maps_select') THEN
    CREATE POLICY cost_import_layout_maps_select ON public.cost_import_layout_maps
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_layout_maps'
      AND policyname = 'cost_import_layout_maps_insert') THEN
    CREATE POLICY cost_import_layout_maps_insert ON public.cost_import_layout_maps
      FOR INSERT WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_layout_maps'
      AND policyname = 'cost_import_layout_maps_update') THEN
    CREATE POLICY cost_import_layout_maps_update ON public.cost_import_layout_maps
      FOR UPDATE USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_layout_maps'
      AND policyname = 'cost_import_layout_maps_delete') THEN
    CREATE POLICY cost_import_layout_maps_delete ON public.cost_import_layout_maps
      FOR DELETE USING (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.cost_import_layout_maps TO anon;
GRANT ALL ON TABLE public.cost_import_layout_maps TO authenticated;
GRANT ALL ON TABLE public.cost_import_layout_maps TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_cost_import_layout_maps'
  ) THEN
    CREATE TRIGGER set_updated_at_cost_import_layout_maps
      BEFORE UPDATE ON public.cost_import_layout_maps
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. cost_import_review_items (needs-a-look list)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_import_review_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES public.cost_import_batches(id) ON DELETE CASCADE,
  tab_name      text NOT NULL,
  row_index     int NOT NULL,
  reason        text NOT NULL,
  raw_values    jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested     jsonb NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'skipped')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz NULL
);

CREATE INDEX IF NOT EXISTS cost_import_review_items_company_status_idx
  ON public.cost_import_review_items (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS cost_import_review_items_batch_idx
  ON public.cost_import_review_items (batch_id);

ALTER TABLE public.cost_import_review_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_review_items'
      AND policyname = 'cost_import_review_items_select') THEN
    CREATE POLICY cost_import_review_items_select ON public.cost_import_review_items
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_review_items'
      AND policyname = 'cost_import_review_items_insert') THEN
    CREATE POLICY cost_import_review_items_insert ON public.cost_import_review_items
      FOR INSERT WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_review_items'
      AND policyname = 'cost_import_review_items_update') THEN
    CREATE POLICY cost_import_review_items_update ON public.cost_import_review_items
      FOR UPDATE USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'cost_import_review_items'
      AND policyname = 'cost_import_review_items_delete') THEN
    CREATE POLICY cost_import_review_items_delete ON public.cost_import_review_items
      FOR DELETE USING (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.cost_import_review_items TO anon;
GRANT ALL ON TABLE public.cost_import_review_items TO authenticated;
GRANT ALL ON TABLE public.cost_import_review_items TO service_role;
