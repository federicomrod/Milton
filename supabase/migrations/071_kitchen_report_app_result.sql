-- 071_kitchen_report_app_result.sql
--
-- Cocina app messages go through the same pipeline as Telegram ones (voice is
-- transcribed, then the kitchen AI reads it). The phone shows what Milton did
-- on the message's card: «Anotado», «Espera aprobación», «Milton te pregunta».
-- That small result is kept on the cook's own report row.
--
--   kitchen_reports.app_result   jsonb, null until the app message is being
--                                processed. Only what happened and product
--                                names: never an amount (cooks do not see
--                                prices). It also marks the row as claimed, so
--                                a message is processed once.
--
-- DESIGN: Additive. One new nullable column on an existing company-scoped
-- table that already has RLS (is_company_member); no policy changes, no DROP,
-- no data changes, nothing NOT NULL. Writes go through the service role only
-- (same as the rest of kitchen_reports).
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI, so this SQL must be pasted manually into the
-- Supabase SQL Editor by someone with staging access. Apply on Milton Staging
-- first; production only after Fede says yes. Until it is applied, app
-- messages are saved but not processed, and history simply omits the result.

ALTER TABLE public.kitchen_reports
  ADD COLUMN IF NOT EXISTS app_result jsonb NULL;

COMMENT ON COLUMN public.kitchen_reports.app_result IS
  'Resultado de un mensaje de la app de cocina: que hizo Milton (sin importes). Solo service role.';
