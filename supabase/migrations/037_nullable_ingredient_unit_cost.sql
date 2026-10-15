-- 037_nullable_ingredient_unit_cost.sql
--
-- A new ingredient created from a recipe line without a unit cost has
-- no price (NULL, pending), never $0. Additive: drop NOT NULL only.
-- Existing rows keep their values. DEFAULT 0 stays for inserts that
-- omit the column.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change. Apply on
-- Milton Staging (r1-staging) after 036. No production apply as part
-- of this PR.

ALTER TABLE public.ingredients
  ALTER COLUMN current_unit_cost DROP NOT NULL;
