-- 041_recipe_version_approval_audit.sql
--
-- Recipes & Costing PR A: who approved which recipe version, and when.
--
-- Approval is a trust event: only an approved version counts toward
-- margins. Until now the app only wrote "Aprobada" (and, for Milton staff,
-- how the client confirmed) into notes. These columns record the approver
-- on the version itself, for dish recipes and for preparations.
--
--   approved_by   the user who approved (auth user id)
--   approved_at   when
--   approved_how  how it was confirmed: "en_pantalla" for an owner/admin,
--                 or how the client confirmed (whatsapp, correo, …) when
--                 Milton staff approve on the client's behalf
--
-- DESIGN: Additive. Three new nullable columns on two existing tables.
-- No DROP, no ALTER of existing columns, no constraint changes, no data
-- changes. Versions approved before 041 keep NULL here (their notes still
-- say "Aprobada").
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access.
-- Apply on Milton Staging (r1-staging) after 040. No production apply as
-- part of this PR.

ALTER TABLE public.recipe_versions
  ADD COLUMN IF NOT EXISTS approved_by uuid NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approved_how text NULL;

ALTER TABLE public.component_recipe_versions
  ADD COLUMN IF NOT EXISTS approved_by uuid NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approved_how text NULL;

COMMENT ON COLUMN public.recipe_versions.approved_by IS
  'User who approved this version. NULL while in review, and for versions approved before migration 041.';
COMMENT ON COLUMN public.recipe_versions.approved_at IS
  'When this version was approved.';
COMMENT ON COLUMN public.recipe_versions.approved_how IS
  'en_pantalla (owner/admin) or how the client confirmed when Milton staff approved on their behalf.';

COMMENT ON COLUMN public.component_recipe_versions.approved_by IS
  'User who approved this preparation version. NULL while in review, and for versions approved before migration 041.';
COMMENT ON COLUMN public.component_recipe_versions.approved_at IS
  'When this preparation version was approved.';
COMMENT ON COLUMN public.component_recipe_versions.approved_how IS
  'en_pantalla (owner/admin) or how the client confirmed when Milton staff approved on their behalf.';
