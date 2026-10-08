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
--      with Telegram ids for idempotency, dish name, portions, status
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
-- ORDER OF OPERATIONS: apply this migration BEFORE deploying the code that
-- uses it. It applies cleanly after 021.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access (apply manually to Milton Staging first; production only after
-- backup #21 and Federico's yes) — it is NOT applied automatically
-- by this change.

-- ---------------------------------------------------------------------------
-- 1. kitchen_recipe_drafts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_recipe_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id           uuid NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  staff_id              uuid NOT NULL REFERENCES public.kitchen_staff(id) ON DELETE CASCADE,
  kitchen_report_id     uuid NULL REFERENCES public.kitchen_reports(id) ON DELETE SET NULL,
  telegram_chat_id      bigint NOT NULL,
  telegram_message_id   bigint NOT NULL,
  menu_item_id          uuid NULL REFERENCES public.menu_items(id) ON DELETE SET NULL,
  dish_name             text NOT NULL,
  portions              int NULL CHECK (portions IS NULL OR portions > 0),
  status                text NOT NULL DEFAULT 'awaiting_portions'
                          CHECK (status IN ('awaiting_portions', 'draft', 'confirmed', 'rejected')),
  confidence            text NOT NULL DEFAULT 'low'
                          CHECK (confidence IN ('high', 'medium', 'low')),
  total_cost            numeric(10, 2) NULL,
  per_portion_cost      numeric(10, 2) NULL,
  currency              text NULL,
  confirmed_by          uuid NULL,
  confirmed_at          timestamptz NULL,
  confirmed_recipe_id   uuid NULL REFERENCES public.recipes(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS kitchen_recipe_drafts_company_location_status_idx
  ON public.kitchen_recipe_drafts (company_id, location_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS kitchen_recipe_drafts_staff_idx
  ON public.kitchen_recipe_drafts (staff_id, created_at DESC);

ALTER TABLE public.kitchen_recipe_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'kitchen_recipe_drafts' AND policyname = 'kitchen_recipe_drafts_member_select') THEN
    CREATE POLICY kitchen_recipe_drafts_member_select ON public.kitchen_recipe_drafts
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. kitchen_recipe_draft_lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kitchen_recipe_draft_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id              uuid NOT NULL REFERENCES public.kitchen_recipe_drafts(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  line_number           int NOT NULL,
  raw_name              text NOT NULL,
  ingredient_id         uuid NULL REFERENCES public.ingredients(id) ON DELETE SET NULL,
  total_quantity        numeric(10, 3) NULL,
  unit                  text NULL,
  per_portion_quantity  numeric(10, 3) NULL,
  confidence            text NOT NULL DEFAULT 'low'
                          CHECK (confidence IN ('high', 'medium', 'low')),
  unit_cost_snapshot    numeric(10, 4) NULL,
  line_cost             numeric(10, 2) NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kitchen_recipe_draft_lines 
  ADD COLUMN IF NOT EXISTS unit_cost_unit text;

CREATE INDEX IF NOT EXISTS kitchen_recipe_draft_lines_draft_idx
  ON public.kitchen_recipe_draft_lines (draft_id, line_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'kitchen_recipe_draft_lines_draft_id_line_number_key'
  ) THEN
    ALTER TABLE public.kitchen_recipe_draft_lines 
      ADD CONSTRAINT kitchen_recipe_draft_lines_draft_id_line_number_key 
      UNIQUE (draft_id, line_number);
  END IF;
END
$$;

ALTER TABLE public.kitchen_recipe_draft_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'kitchen_recipe_draft_lines' AND policyname = 'kitchen_recipe_draft_lines_member_select') THEN
    CREATE POLICY kitchen_recipe_draft_lines_member_select ON public.kitchen_recipe_draft_lines
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Updated-at triggers (use existing set_updated_at function from 001)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'set_updated_at_kitchen_recipe_drafts'
  ) THEN
    CREATE TRIGGER set_updated_at_kitchen_recipe_drafts
      BEFORE UPDATE ON public.kitchen_recipe_drafts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'set_updated_at_kitchen_recipe_draft_lines'
  ) THEN
    CREATE TRIGGER set_updated_at_kitchen_recipe_draft_lines
      BEFORE UPDATE ON public.kitchen_recipe_draft_lines
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Confirm draft function (atomic, idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_kitchen_recipe_draft(
  p_draft_id uuid,
  p_confirmed_by uuid,
  p_dish_name text,
  p_portions int,
  p_menu_item_id uuid,
  p_selling_price numeric,
  p_lines jsonb
)
RETURNS TABLE(out_recipe_id uuid, out_menu_item_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft RECORD;
  v_menu_item_id uuid;
  v_recipe_id uuid;
  v_line jsonb;
  v_ingredient_count int;
BEGIN
  -- Lock and fetch the draft
  SELECT d.id, d.company_id, d.status, d.confirmed_recipe_id, d.menu_item_id
  INTO v_draft
  FROM public.kitchen_recipe_drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  -- If already confirmed, return existing recipe
  IF v_draft.status = 'confirmed' AND v_draft.confirmed_recipe_id IS NOT NULL THEN
    out_recipe_id := v_draft.confirmed_recipe_id;
    out_menu_item_id := COALESCE(v_draft.menu_item_id, p_menu_item_id);
    RETURN NEXT;
    RETURN;
  END IF;

  -- Must be in draft status
  IF v_draft.status != 'draft' THEN
    RAISE EXCEPTION 'Draft must be in draft status to confirm';
  END IF;

  -- Validate inputs
  IF p_portions < 1 THEN
    RAISE EXCEPTION 'Portions must be at least 1';
  END IF;

  IF p_lines IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one ingredient line is required';
  END IF;

  -- Validate menu item belongs to company
  IF p_menu_item_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ingredient_count
    FROM public.menu_items mi
    WHERE mi.id = p_menu_item_id AND mi.company_id = v_draft.company_id;
    IF v_ingredient_count = 0 THEN
      RAISE EXCEPTION 'Menu item does not belong to this company';
    END IF;
  END IF;

  -- Validate all ingredients belong to company and quantities are valid
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    IF (v_line->>'per_portion_quantity')::numeric IS NULL 
       OR (v_line->>'per_portion_quantity')::numeric <= 0 THEN
      RAISE EXCEPTION 'All lines must have positive per-portion quantities';
    END IF;

    SELECT COUNT(*) INTO v_ingredient_count
    FROM public.ingredients ing
    WHERE ing.id = (v_line->>'ingredient_id')::uuid 
      AND ing.company_id = v_draft.company_id;
    IF v_ingredient_count = 0 THEN
      RAISE EXCEPTION 'Ingredient % does not belong to this company', v_line->>'ingredient_id';
    END IF;
  END LOOP;

  -- Create or use menu item
  v_menu_item_id := COALESCE(p_menu_item_id, v_draft.menu_item_id);

  IF v_menu_item_id IS NULL THEN
    INSERT INTO public.menu_items (company_id, name, category, selling_price)
    VALUES (v_draft.company_id, p_dish_name, 'Main', COALESCE(p_selling_price, 0))
    RETURNING id INTO v_menu_item_id;
  END IF;

  -- Create or replace recipe (respect UNIQUE constraint)
  INSERT INTO public.recipes (
    company_id,
    menu_item_id,
    name,
    status,
    yield_quantity,
    serving_quantity,
    serving_unit
  ) VALUES (
    v_draft.company_id,
    v_menu_item_id,
    p_dish_name,
    'active',
    1,
    1,
    'portion'
  )
  ON CONFLICT (company_id, menu_item_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    status = 'active',
    yield_quantity = EXCLUDED.yield_quantity,
    serving_quantity = EXCLUDED.serving_quantity,
    serving_unit = EXCLUDED.serving_unit,
    updated_at = now()
  RETURNING id INTO v_recipe_id;

  -- Delete old inputs
  DELETE FROM public.menu_recipe_inputs WHERE recipe_id = v_recipe_id;

  -- Insert new inputs
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.menu_recipe_inputs (
      recipe_id,
      company_id,
      input_type,
      ingredient_id,
      component_id,
      quantity,
      unit
    ) VALUES (
      v_recipe_id,
      v_draft.company_id,
      'ingredient',
      (v_line->>'ingredient_id')::uuid,
      NULL,
      (v_line->>'per_portion_quantity')::numeric,
      v_line->>'unit'
    );
  END LOOP;

  -- Mark draft as confirmed
  UPDATE public.kitchen_recipe_drafts
  SET
    status = 'confirmed',
    confirmed_by = p_confirmed_by,
    confirmed_at = now(),
    confirmed_recipe_id = v_recipe_id,
    menu_item_id = v_menu_item_id,
    dish_name = p_dish_name,
    portions = p_portions
  WHERE kitchen_recipe_drafts.id = p_draft_id;

  -- Return results
  out_recipe_id := v_recipe_id;
  out_menu_item_id := v_menu_item_id;
  RETURN NEXT;
END;
$$;

-- Secure the function: only service_role can call it
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.confirm_kitchen_recipe_draft(uuid, uuid, text, int, uuid, numeric, jsonb)
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.confirm_kitchen_recipe_draft(uuid, uuid, text, int, uuid, numeric, jsonb)
    TO service_role;
EXCEPTION WHEN undefined_object THEN
  REVOKE EXECUTE ON FUNCTION public.confirm_kitchen_recipe_draft(uuid, uuid, text, int, uuid, numeric, jsonb)
    FROM PUBLIC;
END
$$;
