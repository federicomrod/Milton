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
