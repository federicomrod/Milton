# R1-16 — Cockpit v2 + Objetivos (phase 1)

## R1-16a — Objetivos (migration 052)

**File:** `supabase/migrations/052_kpi_targets_v2.sql` — paste by hand. **Needed** for Objetivos to save; until
applied Objetivos says «falta aplicar la migración 052» and the Cockpit works without targets (old daily rows
keep loading).

Additive, in the EXISTING table `restaurant_kpi_targets` (no new table for goals):

| Change | Detail |
|---|---|
| `metric_key` | also `food_cost_pct`, `gross_margin_pct` (the four old keys keep working) |
| `target_period` | also `monthly` (`daily` keeps working) |
| `location_id` | null = whole company; composite FK `(location_id, company_id)` → `restaurant_locations` (same company) |
| `effective_from` | a target applies from that day; existing rows backfilled to `1900-01-01` (valid for all history), new rows default to today |
| `weekday_weights` | jsonb, 7 numbers (Mon..Sun) summing to 1, or null = flat (check function `kpi_weekday_weights_ok`) |
| key | `UNIQUE NULLS NOT DISTINCT (company_id, location_id, metric_key, target_period, effective_from)` (PostgreSQL 15+) |
| `restaurant_company_settings` | one row per company: default «Comparar con» (RLS member, anon revoked) |
| `kpi_targets_save(...)` | saves the whole form in ONE transaction; `SECURITY INVOKER`; 42501 for a non-member; 22023 for bad input; revoked from anon/PUBLIC |

RLS of `restaurant_kpi_targets` is unchanged (`is_company_member`).

Read-only checks after applying:

```sql
select count(*) as rows, count(*) filter (where effective_from = date '1900-01-01') as old_rows
from public.restaurant_kpi_targets where company_id = '<company uuid>';

select metric_key, target_period, location_id, effective_from, target_value, is_active
from public.restaurant_kpi_targets where company_id = '<company uuid>' order by 1, 2, 4;

select has_function_privilege('anon', 'public.kpi_targets_save(uuid,uuid,date,jsonb,jsonb,text,text)', 'execute');  -- must be false
select count(*) from public.restaurant_company_settings where company_id = '<company uuid>';
```

### Rules (pure code: `lib/restaurant/objetivos.ts`, `cockpit-math.ts`; unit-tested)

- Lookup: the row with the greatest `effective_from ≤ day`; a restaurant's own row beats the company-wide one.
  A target set on 1 Oct does not change September.
- Daily sales target: flat = monthly ÷ days of THAT month (34,500 → 1,150 in a 30-day month, 1,112.90 in a
  31-day one); weighted = monthly × w(weekday) ÷ Σw over that month's days. Period target = Σ of its days; a period
  with a day that has no target has none (never padded with 0).
- A company-wide SALES target is not split per restaurant; per-restaurant sales targets add up for «Todos» only when
  every restaurant has one. Levels (food cost %, margin %, ticket) are not additive: a company-wide level applies to
  each restaurant, and Todos never averages restaurant levels.
- A blank goal is no goal (no line, no chip, never 0). Clearing writes an inactive row from the first of the month,
  so earlier months keep theirs.
- References are real data only («Promedio 6 meses», «Actual 30 d»); a figure that cannot be computed shows «—».
- The window of the references ends on the **last day that has sales** (not wall-clock yesterday): if the POS sync
  lags, the days after the last sale are not counted as zero-sales days. When data is live this is yesterday/today.
  The 6-month window is cut to the first POS day and says «solo N meses de datos».
- Old Ventas editor: it now shows what is being drawn and links to Configuración › Objetivos (one place to edit).
  Existing daily rows still load; Ventas' daily line is derived from the monthly target for today.

## R1-16b — Cockpit v2 (migration 053, optional speed-up)

**File:** `supabase/migrations/053_cockpit_product_day_rollup.sql` — **optional**: the app falls back to reading the
rows with the same rules if it is missing (same numbers, slower). One function `cockpit_product_day_rollup`,
`SECURITY DEFINER` after `is_company_member` (42501 for a non-member), revoked from anon/PUBLIC, additive
(`CREATE OR REPLACE FUNCTION` only). Needs 031 and 046. Read-only checks:

```sql
select jsonb_array_length(public.cockpit_product_day_rollup('<company uuid>', null, 'America/El_Salvador', null));
select has_function_privilege('anon', 'public.cockpit_product_day_rollup(uuid,uuid,text,text)', 'execute');  -- must be false
```

### How it loads (no new request per control)

- With the page: the daily net sales of all history (the `cockpit_pos_rollup` the page already reads), the targets
  (`loadTargetsConfig`), the restaurants and the default comparison. The sales cards paint from this alone.
- ONE request after the first paint: `GET /api/restaurant/cockpit-cost-days` → day × category rows
  (net, cost of the costed products, the sales that cost covers). Kept in memory for the session.
- Changing **period**, **Comparar con** or the **category** only recomputes `computeCockpit()` in the browser:
  no request, no navigation (a test pins that the component has exactly one `fetch`, tied to the restaurant only;
  every period × comparison over two years of days recomputes in well under 100 ms).

### Definitions

- **Periods** end on the last day with sales («Hoy» = that day; when the POS is live it is today): Hoy, 7 d, 30 d,
  Trimestre = 90 days. Trailing baselines («Últimos 3 / 6 / 12 meses») end the day before it when it is today.
- **Venta promedio diaria** = Σ net sales ÷ calendar days (zero-sales days count; days before the first POS day do
  not). The trailing baseline is cut to where the data starts and says «solo N meses de datos».
- **vs semana pasada**: the same days one week earlier (weekdays aligned). **vs mes pasado**: the block of the
  same length right before it when the period is ≥ 28 days, otherwise four weeks back (weekdays aligned, a partial
  week is never set against a full one). A comparison window that starts before the data is not shown.
- **Costo de comida / Margen bruto**: Σ cost ÷ Σ sales over the window (never the average of daily %), compared
  in points. Cost only where the dish is **covered** (an approved cost) — the same rule as Menú — so the Cockpit's
  food cost % equals Menú's; a product without one is uncosted (never $0) and lowers the stated coverage.
  Coverage here = costed sales ÷ all net sales (Menú's is over food sales only, so it reads a bit higher).
- **Sales mix** by the menu dish's category, else the POS line's category, else «Sin categoría» (its share is
  reported). Click a slice and the whole page filters to that category.
- No target = no line and no chip. Green/red only when it matters (≥ 2 % on sales, ≥ 0.5 points on a percentage);
  for cost, up is bad.
- Click a day or a week → Ventas › detalle filtered to those days.
