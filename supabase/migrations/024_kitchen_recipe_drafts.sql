-- 024_kitchen_recipe_drafts.sql
--
-- Recipe drafts from cook photos/voice/text (R1 issues #72 / #18). A cook
-- sends the kitchen bot a photo, voice note or text message describing a
-- dish and portions; Milton estimates ingredients, quantities and per-portion
-- cost from the company's existing ingredient catalog; a manager reviews,
-- edits and confirms. DRAFT recipes do NOT affect costs, margins or KPIs
-- until confirmed. Low-confidence extractions are flagged for extra review.
--
--   1. kitchen_recipe_drafts: one row per draft, linked to kitchen_reports,
    10|--      with Telegram ids for idempotency, dish name, portions, status
--      (awaiting_portions, draft, confirmed, rejected), overall confidence,
--      cached totals, and confirmed_recipe_id when moved to `recipes`.
--
--   2. kitchen_recipe_draft_lines: ingredient inputs, matched ingredient_id,
--      estimated quantities, per-portion, line confidence, snapshot cost.
--
-- Drafts stay in these tables until confirmed or rejected. Only a confirm
-- moves data into `recipes` / `menu_recipe_inputs`. This keeps the costing
-- engine, profitability and Ask Milton insulated from unreviewed drafts.
--
    20|-- ORDER OF OPERATIONS: apply this migration BEFORE deploying the code that
-- uses it. It applies cleanly after 021.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access (apply manually to Milton Staging first; production only after 
-- backup #21 and Federico's yes) — it is NOT applied automatically 
-- by this change.

-- ---------------------------------------------------------------------------
    30|-- 1. kitchen_recipe_drafts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_recipe_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id           uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  staff_id              uuid NOT NULL REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  kitchen_report_id     uuid NULL REFERENCES public.kitchen_reports(id) ON DELETE SET NULL,
  telegram_chat_id      bigint NOT NULL,
    40|  telegram_message_id   bigint NOT NULL,
  menu_item_id          uuid NULL REFERENCES public.menu_items(id) ON DELETE SET NULL,
  dish_name             text NOT NULL,
  portions              int NULL CHECK (portions IS NULL OR portions > 0),
  status                text NOT NULL DEFAULT 'awaiting_portions' 
                          CHECK (status IN ('awaiting_portions', 'draft', 'confirmed', 'rejected')),
  confidence            text NOT NULL DEFAULT 'low' 
                          CHECK (confidence IN ('high', 'medium', 'low')),
  total_cost            numeric(10, 2) NULL,
  per_portion_cost      numeric(10, 2) NULL,
    50|  currency              text NULL,
  confirmed_by          uuid NULL,
  confirmed_at          timestamptz NULL,
  confirmed_recipe_id   uuid NULL REFERENCES public.recipes(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS kitchen_recipe_drafts_company_location_status_idx
    60|  ON public.kitchen_recipe_drafts (company_id, location_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS kitchen_recipe_drafts_staff_idx
  ON public.kitchen_recipe_drafts (staff_id, created_at DESC);

ALTER TABLE public.kitchen_recipe_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    70|      AND tablename = 'kitchen_recipe_drafts' AND policyname = 'kitchen_recipe_drafts_member_select') THEN
    CREATE POLICY kitchen_recipe_drafts_member_select ON public.kitchen_recipe_drafts
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. kitchen_recipe_draft_lines
-- ---------------------------------------------------------------------------
    80|
CREATE TABLE IF NOT EXISTS public.kitchen_recipe_draft_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id              uuid NOT NULL REFERENCES public.kitchen_recipe_drafts(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  line_number           int NOT NULL,
  raw_name              text NOT NULL,
  ingredient_id         uuid NULL REFERENCES public.ingredients(id) ON DELETE SET NULL,
  total_quantity        numeric(10, 3) NULL,
  unit                  text NULL,
    90|  per_portion_quantity  numeric(10, 3) NULL,
  confidence            text NOT NULL DEFAULT 'low' 
                          CHECK (confidence IN ('high', 'medium', 'low')),
  unit_cost_snapshot    numeric(10, 4) NULL,
  line_cost             numeric(10, 2) NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kitchen_recipe_draft_lines_draft_idx
   100|  ON public.kitchen_recipe_draft_lines (draft_id, line_number);

ALTER TABLE public.kitchen_recipe_draft_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'kitchen_recipe_draft_lines' AND policyname = 'kitchen_recipe_draft_lines_member_select') THEN
    CREATE POLICY kitchen_recipe_draft_lines_member_select ON public.kitchen_recipe_draft_lines
      FOR SELECT USING (public.is_company_member(company_id));
   110|  END IF;
END
$$;
