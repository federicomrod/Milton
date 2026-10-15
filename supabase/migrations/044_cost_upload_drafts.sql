-- 044_cost_upload_drafts.sql
--
-- Recipes & Costing: the cost-file upload survives leaving the page.
-- One row per company keeps the file a person picked in "Subir Excel de
-- costos", every choice they made in the preview (units, which of two
-- costs, which items they buy ready-made) as they make it, and what was
-- already saved from it (price list, recipes). Opening the page again
-- restores the preview and the choices; nobody re-selects the file.
--
--   filename         the file's name as picked
--   file_base64      the file itself (base64), read again by the preview
--                    and by the save; capped by the app at 15 MB
--   decisions        the person's choices so far (JSON)
--   catalog_result   what "Subir y preparar mis platos" saved, or NULL
--   recipes_result   what "Importar" saved, or NULL
--
-- DESIGN: Additive. One new company-scoped table with RLS (same rule as
-- 038/039/042/043). No DROP, no ALTER of existing tables, no data changes.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 043. No production apply as
-- part of this PR.

CREATE TABLE IF NOT EXISTS public.cost_upload_drafts (
  company_id      uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  filename        text NOT NULL,
  file_base64     text NOT NULL,
  file_size       integer NOT NULL DEFAULT 0,
  decisions       jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog_result  jsonb NULL,
  recipes_result  jsonb NULL,
  updated_by      uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_upload_drafts_filename_chk CHECK (filename <> '')
);

COMMENT ON TABLE public.cost_upload_drafts IS
  'Per-company draft of the cost-file upload: the picked file, the person''s choices in the preview (saved as they go), and what was already saved from it. Restored when the page opens again.';

ALTER TABLE public.cost_upload_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_upload_drafts'
      AND policyname = 'cost_upload_drafts_member'
  ) THEN
    CREATE POLICY cost_upload_drafts_member ON public.cost_upload_drafts
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.cost_upload_drafts TO anon, authenticated, service_role;
