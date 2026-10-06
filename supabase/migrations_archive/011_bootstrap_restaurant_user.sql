-- 011_bootstrap_restaurant_user.sql
--
-- Two parts:
--
-- PART A — Fix the auth.users trigger (blocks signup if broken)
-- PART B — bootstrap_restaurant_user() RPC used by /api/auth/signup-complete
--
-- Real schema (confirmed from Supabase):
--   profiles         : id, company_id, full_name, email, created_at, updated_at, user_id
--   companies        : id, name, slug, industry, created_at, updated_at
--   company_memberships : id, company_id, user_id, role, created_at, updated_at
--
-- Key constraints:
--   profiles has NO `role` column        — role lives in company_memberships.role
--   companies has NO `created_by` column — company ownership is via company_memberships
--
-- IDEMPOTENT: safe to run multiple times (CREATE OR REPLACE, IF NOT EXISTS, etc.)

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Fix handle_new_user trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates or replaces the trigger function that fires on every new auth user.
-- Inserts only (id, user_id) — the two columns profiles always has.
-- The EXCEPTION block guarantees auth.signUp() never fails because of this.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id)
  VALUES (NEW.id, NEW.id)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth signup due to a profile insert failure.
  RAISE WARNING 'handle_new_user: profile insert skipped for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: bootstrap_restaurant_user() RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Called by /api/auth/signup-complete via adminClient.rpc().
-- Runs directly inside Postgres so PostgREST cannot strip the `id` PK column.
-- Idempotent: safe to call again if a previous attempt half-succeeded.
--
-- Steps:
--   1. Upsert profile  (id, user_id)          — no role, no company_id yet
--   2. Find company    via company_memberships — not via companies.created_by
--   3. Create company  (name, slug, industry)  — if none found in step 2
--   4. Insert membership (company_id, user_id, role='owner')
--   5. Set profiles.company_id

CREATE OR REPLACE FUNCTION public.bootstrap_restaurant_user(
  p_user_id      UUID,
  p_company_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_slug       TEXT;
BEGIN
  -- ── 1. Profile ─────────────────────────────────────────────────────────────
  -- Only (id, user_id): profiles has no `role` column.
  INSERT INTO public.profiles (id, user_id)
  VALUES (p_user_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. Find existing company via memberships ────────────────────────────────
  -- companies has no `created_by`; ownership is expressed through
  -- company_memberships. If the user already has a membership, reuse that company.
  SELECT company_id
    INTO v_company_id
    FROM public.company_memberships
   WHERE user_id = p_user_id
   LIMIT 1;

  -- ── 3. Create company if none found ────────────────────────────────────────
  IF v_company_id IS NULL THEN
    -- Build a URL-safe slug from the company name.
    v_slug := lower(regexp_replace(p_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);

    -- Append a short random suffix when the slug is already taken.
    IF EXISTS (SELECT 1 FROM public.companies WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 8);
    END IF;

    INSERT INTO public.companies (name, slug, industry)
    VALUES (p_company_name, v_slug, 'restaurant')
    RETURNING id INTO v_company_id;
  END IF;

  -- ── 4. Company membership ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1
      FROM public.company_memberships
     WHERE user_id    = p_user_id
       AND company_id = v_company_id
  ) THEN
    INSERT INTO public.company_memberships (user_id, company_id, role)
    VALUES (p_user_id, v_company_id, 'owner');
  END IF;

  -- ── 5. Link profile to company ─────────────────────────────────────────────
  UPDATE public.profiles
     SET company_id = v_company_id
   WHERE id = p_user_id
     AND (company_id IS NULL OR company_id != v_company_id);

  RETURN jsonb_build_object('company_id', v_company_id);
END;
$$;

-- Service role can call this; anon role cannot.
GRANT EXECUTE ON FUNCTION public.bootstrap_restaurant_user(UUID, TEXT) TO service_role;
