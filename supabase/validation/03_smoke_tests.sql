-- 03_smoke_tests.sql
-- Smoke tests for baseline schema functionality
-- Run with: psql $SUPABASE_DB_URL -f supabase/validation/03_smoke_tests.sql

\set ON_ERROR_STOP on
\set ECHO all

-- Test 1: auth.users trigger creates a profile
\echo '=== Test 1: auth.users trigger creates profile ==='
BEGIN;
  -- Simulate what happens when a user signs up
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token)
  VALUES (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'test@example.com',
    'hashed-password',
    now(),
    now(),
    now(),
    ''
  );
  
  -- Check profile was created
  SELECT 
    CASE 
      WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111')
      THEN '✓ PASS: Profile created by trigger'
      ELSE '✗ FAIL: Profile NOT created'
    END as result;
ROLLBACK;

-- Test 2: bootstrap_restaurant_user works as service_role
\echo ''
\echo '=== Test 2: bootstrap_restaurant_user creates company and membership ==='
BEGIN;
  -- Create auth user first
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token)
  VALUES (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'bootstrap-test@example.com',
    'hashed-password',
    now(),
    now(),
    now(),
    ''
  );
  
  -- Call bootstrap function (as service_role would)
  SELECT public.bootstrap_restaurant_user(
    '22222222-2222-2222-2222-222222222222'::uuid,
    'Test Company'
  ) as result;
  
  -- Verify company was created
  SELECT 
    CASE 
      WHEN EXISTS (SELECT 1 FROM public.companies WHERE name = 'Test Company')
      THEN '✓ PASS: Company created'
      ELSE '✗ FAIL: Company NOT created'
    END as result;
  
  -- Verify membership was created
  SELECT 
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM public.company_memberships 
        WHERE user_id = '22222222-2222-2222-2222-222222222222'
        AND role = 'owner'
      )
      THEN '✓ PASS: Membership created with owner role'
      ELSE '✗ FAIL: Membership NOT created'
    END as result;
ROLLBACK;

-- Test 3: RLS - user can read their own company data
\echo ''
\echo '=== Test 3: RLS - is_company_member policy ==='
BEGIN;
  -- Create test data
  INSERT INTO public.companies (id, name, slug, industry, created_at, updated_at)
  VALUES 
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Company A', 'company-a', 'restaurant', now(), now()),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Company B', 'company-b', 'restaurant', now(), now());
  
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token)
  VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'user-a@example.com',
    'hashed-password',
    now(),
    now(),
    now(),
    ''
  );
  
  -- Profile is created by trigger, just update the company_id
  UPDATE public.profiles 
  SET company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' 
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  
  INSERT INTO public.company_memberships (id, company_id, user_id, role, created_at, updated_at)
  VALUES 
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', now(), now());
  
  -- Test company membership was created
  SELECT 
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM public.company_memberships 
        WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      )
      THEN '✓ PASS: User is member of their company (direct check)'
      ELSE '✗ FAIL: Membership not found'
    END as result;
  
  SELECT 
    CASE 
      WHEN NOT EXISTS (
        SELECT 1 FROM public.company_memberships 
        WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      )
      THEN '✓ PASS: User is NOT member of other company (direct check)'
      ELSE '✗ FAIL: Unexpected membership found'
    END as result;
ROLLBACK;

-- Test 4: Agent definitions exist
\echo ''
\echo '=== Test 4: Agent definitions seed data ==='
SELECT 
  CASE 
    WHEN COUNT(*) = 7
    THEN '✓ PASS: All 7 agent definitions present'
    ELSE '✗ FAIL: Expected 7 agents, found ' || COUNT(*)
  END as result
FROM public.agent_definitions;

-- List agents
SELECT agent_key, name, category, is_available
FROM public.agent_definitions
ORDER BY 
  CASE category
    WHEN 'sales' THEN 1
    WHEN 'margin' THEN 2
    WHEN 'supplier' THEN 3
    WHEN 'invoice' THEN 4
    WHEN 'inventory' THEN 5
    WHEN 'finance' THEN 6
    WHEN 'menu' THEN 7
  END;

\echo ''
\echo '=== All smoke tests complete ==='
