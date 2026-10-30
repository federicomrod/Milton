-- 070: legal details of the company, edited in Configuración › Ajustes.
-- Additive and idempotent. No RLS or default change: the existing
-- companies policies already cover every column.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS address text;
