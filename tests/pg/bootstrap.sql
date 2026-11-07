-- tests/pg/bootstrap.sql
--
-- Minimal Supabase-shaped environment for the DISPOSABLE LOCAL test database.
-- Synthetic only. It stands in for the parts of 001_baseline/020/022 that the
-- fixed-cost migrations depend on (auth schema, roles, companies, memberships,
-- locations, is_company_member, is_milton_admin). The real migrations 064, 073,
-- 079 (and 080) are applied unchanged on top of it.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

-- Same contract as Supabase: read the JWT claims PostgREST sets per request.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    COALESCE(current_setting('request.jwt.claim.sub', true),
             (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
    '')::uuid
$$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Supabase's default privileges: new functions/tables are open to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.company_memberships (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, role text NOT NULL, PRIMARY KEY (company_id, user_id));
CREATE TABLE public.restaurant_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE, name text);
CREATE TABLE public.milton_admins (user_id uuid PRIMARY KEY);

CREATE FUNCTION public.is_company_member(target_company_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select exists (select 1 from public.company_memberships cm
    where cm.company_id = target_company_id and cm.user_id = auth.uid());
$$;
CREATE FUNCTION public.is_milton_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.milton_admins WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_milton_admin() FROM PUBLIC, anon;

GRANT SELECT ON public.companies, public.company_memberships, public.restaurant_locations TO authenticated;
