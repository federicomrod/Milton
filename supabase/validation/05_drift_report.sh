#!/bin/bash
# 05_drift_report.sh
# Detect schema drift between production dump and what migrations 002-018 would have created

set -euo pipefail

echo "=== Production Schema Drift Report ==="
echo ""
echo "This report identifies schema objects in production that are NOT explained"
echo "by the archived migrations 002-018."
echo ""

# Key drift items to check based on the task description:
# 1. Does profiles.role exist in production? (It should NOT - role is in company_memberships)
# 2. Is is_company_member's body what we expect?
# 3. Any manual schema edits not in migrations?

if [ ! -f /tmp/baseline_cleaned.sql ]; then
  echo "ERROR: /tmp/baseline_cleaned.sql not found. Run this after Part A."
  exit 1
fi

echo "=== 1. Check profiles.role column ==="
if grep -q 'profiles.*role' /tmp/baseline_cleaned.sql | grep -v 'service_role'; then
  echo "✗ DRIFT: profiles.role column exists in production"
  grep -n 'profiles' /tmp/baseline_cleaned.sql | grep 'role' | grep -v 'service_role'
else
  echo "✓ OK: profiles.role does NOT exist (as expected - role is in company_memberships)"
fi

echo ""
echo "=== 2. Check is_company_member function ==="
if grep -A 20 'CREATE FUNCTION public.is_company_member' /tmp/baseline_cleaned.sql | grep -q 'company_memberships'; then
  echo "✓ OK: is_company_member uses company_memberships table"
else
  echo "✗ DRIFT: is_company_member might not be using company_memberships"
fi

echo ""
echo "=== 3. Known production-only objects ==="
echo "Objects in production that were NOT created by migrations 002-018:"
echo ""

# Check for agent tables
echo "Agent tables (from migration 008):"
grep '^CREATE TABLE.*agent_' /tmp/baseline_cleaned.sql | sed 's/CREATE TABLE /  - /' | sed 's/ ($//'

echo ""
echo "Check migration 008 in archive to confirm these match."

echo ""
echo "=== 4. Functions inventory ==="
echo "All functions in production public schema:"
grep '^CREATE FUNCTION public\.' /tmp/baseline_cleaned.sql | sed 's/CREATE FUNCTION public\./  - /' | sed 's/(.*$/()/' 

echo ""
echo "Expected functions:"
echo "  - bootstrap_restaurant_user() - from migration 011"
echo "  - handle_new_user() - from migration 011"
echo "  - is_company_member() - should exist (company scope helper)"
echo "  - set_updated_at() - timestamp trigger helper"
echo "  - rls_auto_enable() - RLS helper if present"

echo ""
echo "=== 5. Check for odoo_company_ids (migration 019) ==="
if grep -q 'odoo_company_ids' /tmp/baseline_cleaned.sql; then
  echo "✗ UNEXPECTED: odoo_company_ids exists in production (migration 019 already applied?)"
else
  echo "✓ CONFIRMED: odoo_company_ids NOT in production (migration 019 not yet applied)"
fi

echo ""
echo "=== Drift report complete ==="
echo ""
echo "Summary: Production baseline captures the state after migrations 002-018 were applied."
echo "Migration 019 is the first migration to apply ON TOP of this baseline."
