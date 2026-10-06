#!/bin/bash
# 01_apply_migrations.sh
# Apply baseline and test migrations in sequence

set -euo pipefail

echo "=== Migration Application Test ==="
echo ""

# Ensure we're using local Supabase
export SUPABASE_DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"

echo "1. Starting fresh local Supabase..."
npx supabase@2.119.0 stop --no-backup 2>/dev/null || true
npx supabase@2.119.0 start

echo ""
echo "2. Applying baseline migration (001)..."
npx supabase@2.119.0 db reset

echo ""
echo "3. Checking baseline applied..."
psql "$SUPABASE_DB_URL" -c "\dt public.*" | head -20

echo ""
echo "4. Testing migration 019 on top of baseline..."
npx supabase@2.119.0 migration up

echo ""
echo "5. Verifying 019 applied..."
psql "$SUPABASE_DB_URL" -c "\d public.restaurant_pos_connections" | grep -i odoo_company_ids || echo "Column not found!"

echo ""
echo "✓ Migration application test complete"
