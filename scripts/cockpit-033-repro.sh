#!/usr/bin/env bash
# Local RLS + realistic-row-count timing for cockpit rollups (#134 / 033).
# Not applied on staging. Safe to re-run: drops milton_cockpit_repro first.
set -euo pipefail

DB=milton_cockpit_repro
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGUSER="${PGUSER:-postgres}"
export PGHOST="${PGHOST:-/var/run/postgresql}"

psql_admin() { sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"; }
psql_db() { sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

echo "=== creating $DB ==="
psql_admin -c "DROP DATABASE IF EXISTS $DB;"
psql_admin -c "CREATE DATABASE $DB;"

echo "=== extensions + stub ==="
psql_db -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql_db -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
# PG 16: 001 dumps SET transaction_timeout (PG 17+).
psql_db -f "$ROOT/supabase/validation/supabase_stub.sql"

echo "=== migrations 001–033 (strip PG17-only SETs) ==="
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  applying $(basename "$f")"
  sed '/SET transaction_timeout/d' "$f" | psql_db -f -
done

echo "=== seed ~25k July POS rows + membership ==="
psql_db <<'SQL'
SET statement_timeout = '8s';

-- Minimal company / locations / member so is_company_member works.
INSERT INTO public.companies (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Repro Co')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurant_locations (id, company_id, name)
VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Los Ranchos'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Lavara')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'fede@repro.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'owner'
)
ON CONFLICT DO NOTHING;

-- 15k Los Ranchos + 10k Lavara July lines. Mix of dishes + Propina so
-- net+tips can be checked. is_tip set so pos_line_is_tip is cheap (030).
INSERT INTO public.pos_sales_items (
  company_id, location_id, sale_date, order_id, check_id, raw_item_name,
  quantity, gross_revenue, net_revenue, discount_amount, currency,
  sales_channel, payment_type, category, is_tip, order_placed_at
)
SELECT
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  DATE '2026-07-01' + (g % 31),
  'r-o-' || g,
  'r-c-' || g,
  CASE WHEN g % 40 = 0 THEN 'Propina' ELSE 'Pupusa ' || (g % 80) END,
  1,
  CASE WHEN g % 40 = 0 THEN 1.20 ELSE 5.50 END,
  CASE WHEN g % 40 = 0 THEN 1.20 ELSE 5.50 END,
  0,
  'USD',
  CASE WHEN g % 7 = 0 THEN 'delivery' ELSE 'in_store' END,
  'card',
  'mains',
  (g % 40 = 0),
  timestamptz '2026-07-01 12:00:00+00' + (g || ' minutes')::interval
FROM generate_series(1, 15000) AS g;

INSERT INTO public.pos_sales_items (
  company_id, location_id, sale_date, order_id, check_id, raw_item_name,
  quantity, gross_revenue, net_revenue, discount_amount, currency,
  sales_channel, payment_type, category, is_tip, order_placed_at
)
SELECT
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  DATE '2026-07-01' + (g % 31),
  'l-o-' || g,
  'l-c-' || g,
  CASE WHEN g % 40 = 0 THEN 'Propina' ELSE 'Taco ' || (g % 60) END,
  1,
  CASE WHEN g % 40 = 0 THEN 0.80 ELSE 5.00 END,
  CASE WHEN g % 40 = 0 THEN 0.80 ELSE 5.00 END,
  0,
  'USD',
  CASE WHEN g % 5 = 0 THEN 'delivery' ELSE 'in_store' END,
  'card',
  'mains',
  (g % 40 = 0),
  timestamptz '2026-07-01 18:00:00+00' + (g || ' minutes')::interval
FROM generate_series(1, 10000) AS g;

ANALYZE public.pos_sales_items;

SELECT location_id, count(*) FROM public.pos_sales_items GROUP BY 1 ORDER BY 1;
SQL

echo "=== indexes on pos_sales_items ==="
psql_db -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pos_sales_items' ORDER BY 1;"

echo "=== EXPLAIN (032-style filter vs 033 filter) ==="
psql_db <<'SQL'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*) FROM public.pos_sales_items psi
WHERE psi.company_id = '11111111-1111-1111-1111-111111111111'
  AND psi.location_id = '33333333-3333-3333-3333-333333333333'
  AND to_char(psi.sale_date, 'YYYY-MM-DD') ~ '^\d{4}-\d{2}-\d{2}$';

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*) FROM public.pos_sales_items psi
WHERE psi.company_id = '11111111-1111-1111-1111-111111111111'
  AND psi.location_id = '33333333-3333-3333-3333-333333333333';
SQL

echo "=== authenticated + RLS timings ==="
psql_db <<'SQL'
SET statement_timeout = '8s';
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', false);

\echo '--- cockpit_pos_rollup Los Ranchos ---'
\timing on
SELECT (public.cockpit_pos_rollup(
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'America/El_Salvador',
  'USD'
)->>'row_count') AS rows,
  ((public.cockpit_pos_rollup(
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'America/El_Salvador',
  'USD'
)->'revenue'->>'net_sales')::numeric
  + (public.cockpit_pos_rollup(
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'America/El_Salvador',
  'USD'
)->'revenue'->>'tips')::numeric) AS net_plus_tips;

\echo '--- cockpit_pos_rollup Lavara ---'
SELECT (public.cockpit_pos_rollup(
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'America/El_Salvador',
  'USD'
)->>'row_count') AS rows;

\echo '--- cockpit_pos_product_rollup Lavara ---'
SELECT (public.cockpit_pos_product_rollup(
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'USD'
)->>'row_count') AS rows,
  jsonb_array_length(public.cockpit_pos_product_rollup(
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'USD'
)->'products') AS products;

\echo '--- 25-page walk simulation (LIMIT 1000 x 10 for Lavara) ---'
SELECT count(*) FROM (
  SELECT 1 FROM public.pos_sales_items
  WHERE company_id = '11111111-1111-1111-1111-111111111111'
    AND location_id = '33333333-3333-3333-3333-333333333333'
  ORDER BY id
  LIMIT 10000
) s;

RESET ROLE;
SQL
