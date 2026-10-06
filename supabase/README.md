# Milton Database

This directory contains the Milton database schema, migrations, and local development tooling.

## Database Baseline

The database baseline (`migrations/001_baseline.sql`) is a complete snapshot of the Milton production database schema captured on **October 6, 2026**. This baseline supersedes all previous migrations (002-018), which have been archived.

It carries exactly two Supabase-compatibility edits relative to the raw `pg_dump` (see the file header): `CREATE SCHEMA public;` is `CREATE SCHEMA IF NOT EXISTS public;`, and the 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` lines are removed (the `postgres` role cannot change them, and Supabase already sets them). Without these edits the file fails on a real Supabase project. The baseline is never applied to production, which already has this schema.

## Directory Structure

```
supabase/
├── config.toml                 # Local Supabase configuration
├── seed.sql                    # Fake data for local development
├── migrations/                 # Database migrations
│   ├── 001_baseline.sql       # Production schema baseline (Oct 2026)
│   └── 019_odoo_company_scope.sql  # First migration on top of baseline
├── migrations_archive/         # Historical migrations (superseded by baseline)
│   ├── README.md              # Why these are archived
│   └── 002-018, create_dashboard_insights_table.sql
└── validation/                 # Validation scripts
    ├── README.md
    ├── 01_apply_migrations.sh
    ├── 02_schema_diff.sh
    ├── 03_smoke_tests.sql
    ├── 04_security_definer_check.sql
    └── 05_drift_report.sh
```

## Quick Start: Local Development

### Prerequisites

- Docker installed and running
- Node.js 24.x (see package.json engines)
- PostgreSQL client tools (psql, pg_dump)

### 1. Start Local Supabase

```bash
# From repo root
npx supabase@2.119.0 start
```

This starts:

- PostgreSQL database (port 54322)
- Supabase Studio (port 54323)
- PostgREST API (port 54321)
- Inbucket mail testing (port 54324)

### 2. Apply Migrations

The baseline and all subsequent migrations are applied automatically:

```bash
npx supabase@2.119.0 db reset
```

This applies:

1. `001_baseline.sql` - Full production schema
2. `019_odoo_company_scope.sql` - Odoo company isolation
3. Any newer migrations (020+)

### 3. Seed Test Data

```bash
psql postgresql://postgres:postgres@localhost:54322/postgres < supabase/seed.sql
```

### 4. Access Supabase Studio

Open http://localhost:54323 to use the Supabase Studio UI for exploring the schema, running queries, and managing data.

## Rebuilding a Clean Database

To start completely fresh:

```bash
# Stop and remove all containers
npx supabase@2.119.0 stop --no-backup

# Start fresh
npx supabase@2.119.0 start

# Migrations are applied automatically
# Optionally add seed data
psql postgresql://postgres:postgres@localhost:54322/postgres < supabase/seed.sql
```

## Migration Workflow

### Creating a New Migration

```bash
npx supabase@2.119.0 migration new descriptive_name
```

This creates `supabase/migrations/YYYYMMDDHHMMSS_descriptive_name.sql`.

### Testing a Migration Locally

```bash
# Apply all pending migrations
npx supabase@2.119.0 db reset

# Or apply specific migration
npx supabase@2.119.0 migration up --version YYYYMMDDHHMMSS
```

### Production Migration Process

⚠️ **IMPORTANT**: Supabase migrations are **not yet automated** via CI/CD.

To apply a migration to production:

1. Test locally first with `npx supabase db reset`
2. Manually paste the SQL into the Supabase Dashboard SQL Editor
3. Run and verify the changes
4. Update documentation if schema changes affect application code

## Validation

Before committing schema changes, run the validation suite:

```bash
cd supabase/validation
./01_apply_migrations.sh  # Test migrations apply cleanly
./02_schema_diff.sh       # Compare with baseline
psql $SUPABASE_DB_URL -f 03_smoke_tests.sql  # Functional tests
psql $SUPABASE_DB_URL -f 04_security_definer_check.sql  # Security audit
./05_drift_report.sh      # Check for drift
```

See `validation/README.md` for details.

## Schema Overview

### Core Tables

- **companies** - Restaurant businesses
- **profiles** - User profiles (linked to auth.users)
- **company_memberships** - User→Company associations with roles
- **restaurant_brands** - Restaurant brands within a company
- **restaurant_locations** - Physical restaurant locations

### POS Integration

- **restaurant_pos_connections** - Odoo/POS system connections
- **restaurant_pos_secrets** - Encrypted POS credentials
- **pos_sales_items** - Raw POS transaction data
- **pos_item_mappings** - POS item → menu item mappings

### Inventory & Costing

- **ingredients** - Ingredient catalog
- **suppliers** - Supplier directory
- **supplier_ingredients** - Supplier→Ingredient pricing
- **supplier_invoices** - Invoice headers
- **supplier_invoice_lines** - Invoice line items
- **ingredient_cost_entries** - Historical ingredient costs
- **recipes** - Dish recipes
- **recipe_ingredients** - Recipe→Ingredient relationships
- **menu_items** - Menu items
- **menu_recipe_inputs** - Menu→Recipe relationships
- **prepared_components** - Batch-prepared components
- **component_recipes** - Component recipes

### Agent System

- **agent_definitions** - Agent catalog (7 agents)
- **agent_configs** - Per-company agent configuration
- **agent_runs** - Agent execution history
- **agent_recommendations** - Agent findings/suggestions
- **agent_recommendation_events** - Recommendation audit trail
- **agent_actions** - Automated actions (from agent_action_workflow)
- **agent_action_events** - Action execution events

### Other

- **restaurant_kpi_snapshots** - KPI time-series data
- **restaurant_kpi_targets** - Target KPIs
- **restaurant_telegram_connections** - Telegram bot integration
- **restaurant_telegram_pairing_codes** - Telegram pairing flow
- **recommendations** - Legacy recommendations table

## Security

### Row Level Security (RLS)

All tables have RLS enabled. Policies use `is_company_member(company_id)` to restrict access to the authenticated user's company.

### SECURITY DEFINER Functions

Two functions run with elevated privileges:

1. **bootstrap_restaurant_user** - Creates company and membership on signup (service_role only)
2. **handle_new_user** - Creates profile on auth.users insert (trigger function)

Both have `search_path` pinned to prevent privilege escalation.

See `validation/04_security_definer_check.sql` for the security audit.

## Postgres Version

Production runs **PostgreSQL 17.6**.

Local development via Supabase CLI uses **PostgreSQL 17** (configured in `config.toml`).

## Troubleshooting

### "relation does not exist" errors

Reset the database:

```bash
npx supabase@2.119.0 db reset
```

### Migrations out of sync

Check which migrations are applied:

```bash
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;"
```

### Port conflicts

If ports 54321-54326 are in use:

```bash
npx supabase@2.119.0 stop
# Change ports in config.toml if needed
npx supabase@2.119.0 start
```

### Can't connect to database

Ensure Docker is running:

```bash
docker ps
```

Should show containers prefixed with `supabase_db_milton-local`.

## Resources

- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [Supabase Migrations](https://supabase.com/docs/guides/cli/managing-migrations)
- [PostgreSQL 17 Documentation](https://www.postgresql.org/docs/17/)
