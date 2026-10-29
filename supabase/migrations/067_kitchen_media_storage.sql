-- 067_kitchen_media_storage.sql
--
-- Mobile P0a (issue #430, epic #429). Milton stores kitchen photos and voice
-- notes itself, so any channel (Telegram now, the app later) can put media in
-- one place. Until now the files lived only on Telegram
-- (kitchen_reports.telegram_file_id) and the web proxied them on every view.
--
--   kitchen-media (Storage)  private bucket, 25 MB per file.
--   kitchen_media            one row per stored file, linked to a kitchen
--                            report and/or a recipe draft. channel says where
--                            it came from; (channel, source_ref) is unique so
--                            retries never store the same file twice.
--
-- PATH CONVENTION (storage_path):
--   <company_id>/<location_id>/<yyyy>/<mm>/<kitchen_media.id>.<ext>
-- The first folder is ALWAYS the company id: the Storage read policy relies on
-- it.
--
-- DESIGN: Additive. One new company-scoped table, one bucket and read
-- policies only. No ALTER of existing tables, no DROP, no data changes.
-- Writes go through the service role only (same as kitchen_reports); there are
-- no insert/update/delete policies for users.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton
-- Staging first; production only after Fede says yes. Safe to paste before or
-- after the deploy: the code falls back to Telegram while this is missing.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kitchen-media',
  'kitchen-media',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kitchen_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id       uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  staff_id          uuid NULL REFERENCES public.kitchen_staff(id) ON DELETE SET NULL,
  kitchen_report_id uuid NULL REFERENCES public.kitchen_reports(id) ON DELETE CASCADE,
  recipe_draft_id   uuid NULL REFERENCES public.kitchen_recipe_drafts(id) ON DELETE CASCADE,
  channel           text NOT NULL,
  kind              text NOT NULL,
  storage_path      text NOT NULL UNIQUE,
  mime              text NULL,
  size_bytes        int NULL,
  duration_s        int NULL,
  -- Telegram file_unique_id; later the app's client id.
  source_ref        text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_media_channel_chk CHECK (channel IN ('telegram', 'app')),
  CONSTRAINT kitchen_media_kind_chk CHECK (kind IN ('photo', 'voice', 'document'))
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_media_channel_source_ref_key
  ON public.kitchen_media (channel, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS kitchen_media_company_location_created_idx
  ON public.kitchen_media (company_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS kitchen_media_report_idx
  ON public.kitchen_media (kitchen_report_id)
  WHERE kitchen_report_id IS NOT NULL;

ALTER TABLE public.kitchen_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitchen_media'
      AND policyname = 'kitchen_media_member_select'
  ) THEN
    CREATE POLICY kitchen_media_member_select ON public.kitchen_media
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'kitchen_media_member_read'
  ) THEN
    CREATE POLICY kitchen_media_member_read ON storage.objects
      FOR SELECT USING (
        bucket_id = 'kitchen-media'
        AND public.is_company_member(((storage.foldername(name))[1])::uuid)
      );
  END IF;
END $$;

COMMENT ON TABLE public.kitchen_media IS
  'Fotos y notas de voz de cocina guardadas en Storage (bucket kitchen-media). Escritura solo con service role.';
