-- 042_restaurant_menu_sources.sql
--
-- Recipes & Costing: "Leer menú (opcional)". A restaurant's menu (its web
-- page, or text the person pastes) is read once by the AI into a list of
-- dishes and what each plate carries. This table keeps that reading so a
-- second run over the same menu does not call the AI again, and so
-- Plato por plato can show the original menu description next to a draft.
--
--   kind          where the menu came from: url | text (pdf | photo later)
--   source_ref    the URL for kind = url; NULL for pasted text
--   content_hash  sha256 of the menu text that was read
--   menu_text     the text that was read (capped by the app)
--   dishes        what the AI read: [{name, section, price, description,
--                 variants[{label, price}], components[]}]
--   model         the model that read it
--
-- Nothing here is a recipe. Drafts made from it are Sugerido links that a
-- person reviews; quantities and costs stay Pendiente.
--
-- DESIGN: Additive. One new company-scoped table with RLS, same rule as
-- 038/039. No DROP, no ALTER of existing tables, no data changes.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 041. No production apply as
-- part of this PR.

CREATE TABLE IF NOT EXISTS public.restaurant_menu_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  source_ref    text NULL,
  content_hash  text NOT NULL,
  menu_text     text NOT NULL,
  dishes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  model         text NULL,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_menu_sources_kind_chk
    CHECK (kind IN ('url', 'text', 'pdf', 'photo')),
  CONSTRAINT restaurant_menu_sources_hash_chk CHECK (content_hash <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_menu_sources_company_hash_uniq
  ON public.restaurant_menu_sources (company_id, content_hash);

CREATE INDEX IF NOT EXISTS restaurant_menu_sources_company_created_idx
  ON public.restaurant_menu_sources (company_id, created_at DESC);

COMMENT ON TABLE public.restaurant_menu_sources IS
  'Per-company reading of the restaurant menu (web page or pasted text): the dishes and what each plate carries, as read by the AI. Cached by content_hash so the same menu is never read twice. Drafts made from it stay Sugerido until a person confirms.';

ALTER TABLE public.restaurant_menu_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_menu_sources'
      AND policyname = 'restaurant_menu_sources_member'
  ) THEN
    CREATE POLICY restaurant_menu_sources_member ON public.restaurant_menu_sources
      FOR ALL
      USING (public.is_company_member(company_id))
      WITH CHECK (public.is_company_member(company_id));
  END IF;
END
$$;

GRANT ALL ON TABLE public.restaurant_menu_sources TO anon, authenticated, service_role;
