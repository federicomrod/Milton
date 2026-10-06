# Database Baseline Validation

This directory contains validation scripts to verify the integrity and correctness of the database baseline migration `001_baseline.sql`.

## Scripts

### 01_apply_migrations.sh

Tests that migrations apply cleanly in sequence:

- Baseline (001)
- Migration 019 (odoo_company_scope)
- Future migrations (020, 021, etc.)

```bash
cd supabase/validation
./01_apply_migrations.sh
```

### 02_schema_diff.sh

Compares the local schema (after applying baseline) with the production dump to ensure they match.

Reports object counts for:

- Tables
- Indexes
- Policies
- Functions
- Triggers
- Grants

```bash
./02_schema_diff.sh
```

### 03_smoke_tests.sql

Functional smoke tests:

- auth.users trigger creates profiles
- bootstrap_restaurant_user creates company and membership
- RLS policies work (is_company_member)
- Agent definitions seed data exists (7 agents)

```bash
export SUPABASE_DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"
psql $SUPABASE_DB_URL -f 03_smoke_tests.sql
```

### 04_security_definer_check.sql

Security audit of SECURITY DEFINER functions:

- Lists all SECURITY DEFINER functions
- Checks which roles can execute them
- Verifies search_path is pinned (prevents privilege escalation)
- Confirms bootstrap_restaurant_user is restricted to service_role only

```bash
psql $SUPABASE_DB_URL -f 04_security_definer_check.sql
```

### 05_drift_report.sh

Detects schema drift between production and archived migrations:

- Checks if profiles.role exists (should NOT)
- Verifies is_company_member uses company_memberships
- Confirms migration 019 not yet applied
- Lists all functions

```bash
./05_drift_report.sh
```

## Running All Validations

```bash
cd /workspace/supabase/validation

# 1. Apply and test migrations
./01_apply_migrations.sh

# 2. Schema diff
./02_schema_diff.sh

# 3. Smoke tests
export SUPABASE_DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"
psql $SUPABASE_DB_URL -f 03_smoke_tests.sql

# 4. Security check
psql $SUPABASE_DB_URL -f 04_security_definer_check.sql

# 5. Drift report
./05_drift_report.sh
```

## Expected Results

✓ All migrations apply cleanly without errors
✓ Schema diff shows matching object counts (±1 trigger for auth)
✓ All smoke tests pass
✓ bootstrap_restaurant_user restricted to service_role only
✓ All SECURITY DEFINER functions have search_path pinned
✓ No unexpected drift (profiles.role should NOT exist)
✓ Migration 019 not yet applied to production

## Prerequisites

- Docker running (for Supabase local stack)
- Node.js and npx available
- psql client installed
- Production dump available at `/tmp/baseline_cleaned.sql`
