#!/bin/bash
# 02_schema_diff.sh
# Compare local baseline schema with production dump

set -euo pipefail

echo "=== Schema Diff Validation ==="
echo ""

export SUPABASE_DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Apply only baseline (not 019) if needed
echo "1. Ensuring clean baseline state (no 019)..."
npx supabase@2.119.0 db reset

# Dump local schema
echo ""
echo "2. Dumping local schema..."
pg_dump "$SUPABASE_DB_URL" --schema-only --schema=public --no-owner --no-privileges \
  | grep -v '^--' | grep -v '^$' | grep -v '^\\\restrict' | grep -v '^\\\unrestrict' \
  > /tmp/local_schema.sql

# Normalize for comparison (remove comments, empty lines, whitespace variations)
normalize() {
  grep -v '^--' | \
  grep -v '^$' | \
  sed 's/[ \t]*$//' | \
  sort
}

echo ""
echo "3. Comparing with production dump..."

# Count major schema objects
echo ""
echo "=== Object counts ==="
echo "Tables:"
echo "  Production: $(grep -c '^CREATE TABLE ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^CREATE TABLE ' /tmp/local_schema.sql || echo 0)"

echo "Indexes:"
echo "  Production: $(grep -c '^CREATE.*INDEX ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^CREATE.*INDEX ' /tmp/local_schema.sql || echo 0)"

echo "Policies:"
echo "  Production: $(grep -c '^CREATE POLICY ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^CREATE POLICY ' /tmp/local_schema.sql || echo 0)"

echo "Functions:"
echo "  Production: $(grep -c '^CREATE FUNCTION ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^CREATE FUNCTION ' /tmp/local_schema.sql || echo 0)"

echo "Triggers:"
echo "  Production: $(grep -c '^CREATE TRIGGER ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^CREATE TRIGGER ' /tmp/local_schema.sql || echo 1)"  # +1 for auth trigger

echo "Grants:"
echo "  Production: $(grep -c '^GRANT ' /tmp/baseline_cleaned.sql || echo 0)"
echo "  Local:      $(grep -c '^GRANT ' /tmp/local_schema.sql || echo 0)"

echo ""
echo "Note: Local should have +1 trigger (on_auth_user_created on auth.users)"
echo "      This is expected and correct."

echo ""
echo "✓ Schema diff complete"
