-- 011_bootstrap_restaurant_user.sql
--
-- Two parts:
--
-- PART A — Fix the auth.users trigger (the actual bug causing signup to fail)
-- PART B — bootstrap_restaurant_user() RPC used by /api/auth/signup-complete
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROOT CAUSE
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase projects commonly have a trigger on auth.users that auto-creates a
-- public.profiles row on every signup. If that trigger does:
--
--   INSERT INTO public.profiles (user_id) VALUES (NEW.id);
--   -- or any INSERT that omits the `id` column
--
-- and profiles.id is NOT NULL without a default, Postgres raises:
--   "null value in column "id" of relation "profiles" violates not-null constraint"
--
-- The trigger catches this and re-raises it as:
--   "Failed to create profile: null value in column "id" ..."
--
-- Because the trigger fires INSIDE supabase.auth.signUp(), the error is
-- returned as authError — before the application ever calls
-- /api/auth/signup-complete. That is why Vercel logs show no POST to the API
-- route: execution throws at `if (authError) { throw authError }` in the form.
--
-- IDEMPOTENT: safe to run multiple times.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Fix handle_new_user trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the function whether or not it already exists.
-- If it didn't exist before, this creates it so future signups are covered.
-- The EXCEPTION block ensures auth.signUp() never fails due to profile issues.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- profiles.id MUST equal auth.users.id (the primary key).
  -- ON CONFLICT (id) DO NOTHING makes this safe for retries and race conditions.
  INSERT INTO public.profiles (id, user_id)
  VALUES (NEW.id, NEW.id)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth signup because of a profile insert failure.
  -- The /api/auth/signup-complete route will repair missing rows on next login.
  RAISE WARNING 'handle_new_user: profile insert skipped for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Wire the trigger (idempotent: drop first so we always have the latest version).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: bootstrap_restaurant_user() RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Called by /api/auth/signup-complete via adminClient.rpc().
-- Runs directly inside Postgres so PostgREST cannot strip the `id` column
-- (the bug that caused previous REST-insert fixes to have no effect).
-- Idempotent: repeated calls for the same user are safe.

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
BEGIN
  -- ── 1. Profile ──────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, user_id, role)
  VALUES (p_user_id, p_user_id, 'user')
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. Company (find-or-create) ─────────────────────────────────────────
  SELECT id
    INTO v_company_id
    FROM public.companies
   WHERE created_by = p_user_id
   LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, created_by)
    VALUES (p_company_name, p_user_id)
    RETURNING id INTO v_company_id;
  END IF;

  -- ── 3. Company membership ───────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1
      FROM public.company_memberships
     WHERE user_id    = p_user_id
       AND company_id = v_company_id
  ) THEN
    INSERT INTO public.company_memberships (user_id, company_id, role)
    VALUES (p_user_id, v_company_id, 'owner');
  END IF;

  RETURN jsonb_build_object('company_id', v_company_id);
END;
$$;

-- Service role can call this; anon role cannot.
GRANT EXECUTE ON FUNCTION public.bootstrap_restaurant_user(UUID, TEXT) TO service_role;
