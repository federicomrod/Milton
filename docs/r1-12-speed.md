# R1-12 — Speed: what changed, how to apply 046, how to check indexes

No client data in this file. Replace `:company_id` with the company's uuid in
the SQL editor.

## 1. Migration 046 (optional for correctness, needed for the speed-up)

`supabase/migrations/046_pos_product_sales_rollup.sql` adds two functions and
touches no table, column or row:

- `pos_odoo_product_id(jsonb)` — the integer product id from a line's
  `source_metadata` (same rule as `odooProductIdFromMetadata`).
- `pos_product_sales_groups(company, restaurant, from, to, product)` — returns
  **one jsonb array** with the Odoo POS lines summed per (restaurant, product,
  combo parent, POS name, tip flag, category). ~20,000 lines become ~1,900
  groups. The app turns each group back into lines and feeds the same
  `buildPosProductList`, so tip rules, rounding and combo roll-up are not
  copied into SQL.

It is a function, not a refreshed table, on purpose: a table would go stale if
a POS sync or CSV upload missed the refresh, and the numbers on screen must
never differ from the raw lines. The function is always exact and needs no
backfill.

**If 046 is not applied** the app logs `[pos-sales-groups] rpc unavailable`
once a minute and reads the raw rows exactly as before. Same numbers, slower.

### Apply (staging first)

Paste the file into the Supabase SQL editor and run it. It is idempotent
(`CREATE OR REPLACE`), so re-running is safe.

### Check it after applying

The function checks `is_company_member()`, which needs a signed-in user (a
non-member gets error 42501 and the app falls back to rows), so in the SQL
editor impersonate a member first (replace both uuids):

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"<a member user uuid>","role":"authenticated"}', true);
set local role authenticated;

with groups as (
  select g from jsonb_array_elements(
    public.pos_product_sales_groups('<company uuid>')) g
),
raw as (
  select * from public.pos_sales_items
  where company_id = '<company uuid>' and pos_source = 'odoo'
    and public.pos_odoo_product_id(source_metadata) is not null
)
select
  (select count(*) from raw)                                   as raw_lines,
  (select sum((g->>'line_count')::int) from groups)            as group_lines,
  (select sum(gross_revenue) from raw)                         as raw_gross,
  (select sum((g->>'gross_revenue')::numeric) from groups)     as group_gross,
  (select sum(quantity) from raw)                              as raw_qty,
  (select sum((g->>'quantity')::numeric) from groups)          as group_qty;
rollback;
```

`raw_lines = group_lines`, `raw_gross = group_gross`, `raw_qty = group_qty`.

## 2. EXPLAIN queries for the hot paths

Run each with `EXPLAIN (ANALYZE, BUFFERS)` in the SQL editor. PostgREST turns
`.eq("company_id", x).order("id").range(a, b)` into `WHERE company_id = x
ORDER BY id LIMIT 1000 OFFSET a`.

What to look for in each plan:

- **Seq Scan** on a table with more than ~10k rows, or an **Index Scan using
  `<table>_pkey` with a large "Rows Removed by Filter"** — that is the case
  that justifies a `(company_id, id)` index (see section 3).
- A Seq Scan on a table of a few thousand rows is the planner's right choice;
  do not add an index for it.

```sql
-- A. Menú load -------------------------------------------------------------

-- A1. The sales sum (the body of pos_product_sales_groups, all restaurants).
-- Needs 046 applied (uses pos_odoo_product_id).
EXPLAIN (ANALYZE, BUFFERS)
WITH lines AS (
  SELECT psi.id, psi.location_id, psi.raw_item_name, psi.quantity,
         psi.gross_revenue, psi.is_tip, NULLIF(btrim(psi.category), '') AS category,
         public.pos_odoo_product_id(psi.source_metadata) AS own_product_id,
         psi.combo_parent_odoo_product_id,
         NULLIF(btrim(psi.combo_parent_external_line_id), '') AS parent_line_id
  FROM public.pos_sales_items psi
  WHERE psi.company_id = ':company_id' AND psi.pos_source = 'odoo'
),
resolved AS (
  SELECT l.*, COALESCE(l.combo_parent_odoo_product_id, (
    SELECT public.pos_odoo_product_id(pl.source_metadata)
    FROM public.pos_sales_items pl
    WHERE pl.company_id = ':company_id' AND pl.pos_source = 'odoo'
      AND pl.external_line_id = l.parent_line_id LIMIT 1)) AS parent_product_id
  FROM lines l WHERE l.own_product_id IS NOT NULL
)
SELECT location_id, own_product_id, parent_product_id, raw_item_name, is_tip, category,
       SUM(quantity), SUM(gross_revenue), COUNT(*), MIN(id::text), MAX(id::text)
FROM resolved GROUP BY 1,2,3,4,5,6;

-- A1b. Same, one restaurant and a month (the period filter)
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM public.pos_sales_items
WHERE company_id = ':company_id' AND pos_source = 'odoo'
  AND location_id = ':location_id'
  AND sale_date >= '2026-09-01' AND sale_date <= '2026-09-30';

-- A2. Paged reads of the cost context (first page and a deep page)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, recipe_version_id, input_type, ingredient_id, component_id,
       quantity, unit, unit_cost, cost_source
FROM public.recipe_version_inputs
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 0;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, recipe_version_id, input_type, ingredient_id, component_id,
       quantity, unit, unit_cost, cost_source
FROM public.recipe_version_inputs
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 8000;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, menu_item_id, version_number, status, effective_date, approved_at, created_at
FROM public.recipe_versions
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 0;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, company_id, location_id, odoo_product_id, odoo_name, classification,
       menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence
FROM public.pos_product_links
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 0;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.ingredient_cost_entries
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 0;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, category, selling_price FROM public.menu_items
WHERE company_id = ':company_id' ORDER BY id LIMIT 1000 OFFSET 0;

-- B. Dish open --------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, company_id, location_id, odoo_product_id, evidence
FROM public.pos_product_links
WHERE company_id = ':company_id' AND odoo_product_id = 12345;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, menu_item_id, version_number FROM public.recipe_versions
WHERE company_id = ':company_id' AND menu_item_id = ':menu_item_id'
ORDER BY version_number DESC LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, input_type, ingredient_id, component_id, quantity, unit, unit_cost, cost_source
FROM public.recipe_version_inputs
WHERE company_id = ':company_id' AND recipe_version_id = ':version_id' ORDER BY id;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, reason, raw_values FROM public.cost_import_review_items
WHERE company_id = ':company_id' AND status = 'pending'
  AND raw_values->>'kind' = 'catalog_row';

-- C. Line save and Aprobar y siguiente -------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, version_number, effective_date FROM public.recipe_versions
WHERE company_id = ':company_id' AND recipe_id = ':recipe_id';

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(id) FROM public.recipe_version_inputs
WHERE company_id = ':company_id' AND recipe_version_id = ':version_id';
```

Row counts, to read the plans against:

```sql
select relname, n_live_tup from pg_stat_user_tables
where relname in ('pos_sales_items','recipe_version_inputs','recipe_versions',
  'pos_product_links','ingredient_cost_entries','menu_items','menu_dishes')
order by n_live_tup desc;
```

## 3. Indexes: none added by this PR

At the sizes in staging (about 20k sales lines, about 8.5k recipe lines) a
sequential scan is the right plan, and the lookups by dish already have
indexes (`pos_product_links_company_idx`, `recipe_versions_company_menu_idx`,
`recipe_version_inputs_version_idx`, `pos_sales_items_source_line_uniq`,
`idx_pos_sales_items_company_location_date`). This PR therefore adds **no**
index: the plans have to be read first (section 2).

If section 2 shows the paged reads as a Seq Scan or a primary-key scan that
discards most rows (the case once several companies share a table), these are
the additive, idempotent fixes, same shape as the existing
`idx_pos_sales_items_company_id` (031). Run only the ones the plan justifies:

```sql
CREATE INDEX IF NOT EXISTS recipe_version_inputs_company_id_idx
  ON public.recipe_version_inputs (company_id, id);
CREATE INDEX IF NOT EXISTS recipe_versions_company_id_idx
  ON public.recipe_versions (company_id, id);
CREATE INDEX IF NOT EXISTS pos_product_links_company_id_id_idx
  ON public.pos_product_links (company_id, id);
CREATE INDEX IF NOT EXISTS ingredient_cost_entries_company_id_id_idx
  ON public.ingredient_cost_entries (company_id, id);
```

## 4. How the numbers in the PR were measured

`READ` requests go to staging with the read-only key; every `WRITE` the
operation would make (the line update, the evidence save, the link
confirmation, the approval) is counted and answered locally with a fake
success, never sent, so staging data and row counts are untouched. A "wave" is
a set of requests that overlap in time; waves are the sequential round trips.
The machine used had about 119 ms round trip to Supabase, so the absolute
milliseconds are higher than a server next to the database would see; counts
and waves are what carry over.
