# Archived Migrations

This directory contains migrations 002-018 and `create_dashboard_insights_table.sql`, which have been **archived** as part of the R1 database baseline consolidation (October 2026).

## Why these migrations are archived

On 2026-10-06, a one-time read-only snapshot of the Milton production database was captured. That snapshot became the new baseline migration `001_baseline.sql`, which supersedes all migrations that had been applied before it.

These archived migrations represent the **historical development path** from the initial schema to the production state captured in the baseline. They are preserved here for:

- Historical reference and understanding of how the schema evolved
- Audit trail of past changes
- Debugging if needed to understand why certain schema decisions were made

## What this means

- **DO NOT apply** these migrations to any new environment
- **DO NOT edit** these migrations
- **Start fresh** with `001_baseline.sql` instead
- **Apply only** migrations numbered 019 and higher on top of the baseline

## Archived migrations

1. `002_add_pos_sales_filter_fields.sql` - POS sales filtering fields
2. `003_create_restaurant_kpi_targets.sql` - KPI targets table
3. `004_menu_recipe_foundation.sql` - Menu and recipe schema
4. `005_prepared_components_unique_ci.sql` - Unique constraints on prepared components
5. `006_costing_foundation.sql` - Ingredient costing foundation
6. `007_supplier_ingredient_management.sql` - Supplier and ingredient management
7. `008_agent_coordination_foundation.sql` - Agent system foundation
8. `009_agent_action_workflow.sql` - Agent action workflow
9. `010_supplier_invoice_ingestion.sql` - Supplier invoice ingestion
10. `011_bootstrap_restaurant_user.sql` - User signup and company bootstrap _(extracted into baseline)_
11. `012_canonical_sales_fields.sql` - Canonical POS sales fields
12. `013_pos_sales_idempotency_and_connections.sql` - POS idempotency and connection management
13. `014_onboarding_profile_fields.sql` - Profile onboarding fields
14. `015_pos_item_mappings_location_aware.sql` - Location-aware POS item mappings
15. `016_company_preferred_language.sql` - Company language preference
16. `017_telegram_connections.sql` - Telegram integration
17. `018_briefing_email_delivery.sql` - Email delivery preferences
18. `create_dashboard_insights_table.sql` - Dashboard insights (unnumbered)

## Current migration path

```
001_baseline.sql           ← Production snapshot (2026-10-06)
019_odoo_company_scope.sql ← First new migration on top of baseline
020_*.sql                  ← Future migrations...
```

## Baseline components extracted from archived migrations

The baseline includes:

- **auth.users trigger** from migration 011 (handle_new_user)
- **agent_definitions seed data** from migration 008 (7 agent catalog entries)

All other schema objects came directly from the production snapshot.
