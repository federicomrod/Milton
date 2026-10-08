-- seed.sql
-- Fake data for local development and testing ONLY
-- DO NOT run this against production

-- Create a test company
INSERT INTO public.companies (id, name, slug, industry, created_at, updated_at)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Test Restaurant', 'test-restaurant', 'restaurant', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create a test user profile (assuming auth.users is managed separately)
-- Note: In real development, create auth.users first via Supabase auth, then this profile
INSERT INTO public.profiles (id, user_id, company_id, full_name, email, created_at, updated_at)
VALUES 
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test User', 'test@example.com', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create company membership
INSERT INTO public.company_memberships (id, company_id, user_id, role, created_at, updated_at)
VALUES 
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'owner', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create a test restaurant brand
INSERT INTO public.restaurant_brands (id, company_id, name, created_at, updated_at)
VALUES 
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Main Brand', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create a test location
INSERT INTO public.restaurant_locations (id, company_id, brand_id, name, address, city, country, created_at, updated_at)
VALUES 
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'Downtown Location', '123 Main St', 'San Francisco', 'USA', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Enable some agents for the test company
INSERT INTO public.agent_configs (id, company_id, agent_key, enabled, run_frequency, config, created_at, updated_at)
VALUES 
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'pos_agent', true, 'daily', '{"revenue_drop_threshold_pct": 15}'::jsonb, now(), now()),
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'recipe_margin_agent', true, 'manual', '{}'::jsonb, now(), now())
ON CONFLICT (company_id, agent_key) DO NOTHING;

-- Add a test supplier
INSERT INTO public.suppliers (id, company_id, name, contact_email, created_at, updated_at)
VALUES 
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'Test Supplier Co', 'supplier@example.com', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Add a test ingredient
INSERT INTO public.ingredients (id, company_id, name, unit, category, created_at, updated_at)
VALUES 
  ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'Test Tomatoes', 'kg', 'vegetables', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Link supplier and ingredient
INSERT INTO public.supplier_ingredients (id, supplier_id, ingredient_id, unit_cost, unit, created_at, updated_at)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 2.50, 'kg', now(), now())
ON CONFLICT (id) DO NOTHING;
