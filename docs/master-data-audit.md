# Master data audit: two costing models (R1-09a)

Status: written with PR `claude/r1-09a-one-source-of-truth`. No client data
in this file. Nothing here is a migration; every "deprecate" below is a
proposal for a later, separately approved PR.

## Why this exists

On staging, Menú › Resumen showed "Cobertura de costo 0.0%", "Costo estimado
$0" and 88 "Platillos con problemas", while Recetas y costeo showed about 10%
of food sales with an approved cost. Dish counts disagreed too.

The cause is two parallel data models that never meet:

| | New model (Recetas, migrations 038–044) | Legacy model (Menú, Cockpit, email, Ask Milton) |
|---|---|---|
| Sold product → dish | `pos_product_links` by `odoo_product_id` | `pos_item_mappings` by exact raw POS name |
| Dish | `menu_items` (via `pos_product_links.menu_item_id`) | `menu_items` |
| Recipe | `recipe_versions` + `recipe_version_inputs` (+ line `unit_cost` from 043) | `recipes` + `menu_recipe_inputs` (versions read only when present) |
| Preparation | `prepared_components` + `component_recipe_versions` + inputs | `prepared_components` + `component_recipes` + `component_recipe_inputs` |
| Ingredient price | `ingredient_cost_entries` (chosen via price catalog / aliases, 039) | `ingredient_cost_entries` |
| Sales | `pos_sales_items` grouped by Odoo product, tips and excluded products out | `pos_sales_items` (or rollup 033) grouped by raw name, tips out |
| Coverage | `buildPosProductList` (confirmed link + approved version) | `fetchProfitabilityData` (mapped name + complete engine cost) |

Approving a dish in Recetas writes a `recipe_version` and confirms a
`pos_product_links` row. The legacy path maps sales through
`pos_item_mappings`, which the Recetas flow never writes, so every sale stayed
"unmapped": 0% coverage, $0 COGS, and every menu item counted as a problem.

### Which dish count was which

- **Legacy count** (Menú › Resumen "Platillos con problemas", setup checklist)
  = rows of `menu_items` (every menu item the company ever had, sold or not;
  the 380 "No encontrado en el menú" lines from the menu reader are separate
  evidence rows and were never counted as dishes).
- **Recetas count** = Odoo products sold in the period that take a recipe
  (`buildPosProductList`, combos and no-cost modifiers apart).
- **Now (one number)** = food products sold in the period
  (`DishEconomicsTotals.dish_count`): tips and products marked *excluido* are
  out; combos and no-cost modifiers are in with their own status.

## The one loader

`lib/restaurant/costing/dish-economics.ts` (pure) and
`dish-economics-server.ts` (React `cache()`, company from auth, RLS client):

```
POS product (pos_sales_items, tips out)
  → pos_product_links (treatment, menu_item_id)
  → recipe_versions (approved = in force; in_review = estimate)
  → recipe_version_inputs (a line's own Excel cost wins, #227)
  → ingredient_cost_entries (one price record per ingredient)
```

Lines are hydrated with the recipe editor's own `hydrateLines`, so a dish
costs on every screen exactly what the editor shows.

Per dish: status (`aprobado` / `estimado` / `falta_precio` / `sin_receta`),
unit cost (full precision, never 0 for a missing price), cost source and date,
Excel COSTO TOTAL reference and diff, net sales, % of food sales, average net
price, food cost %, unit margin, lines with price source and date.

Totals: food net sales (the one denominator), covered sales and coverage %,
COGS, food cost %, gross margin, problem count (falta precio + sin receta),
dish count.

Consumers now reading it:

| Screen / output | How |
|---|---|
| Menú › Resumen | `loadMenuAreaModel` → `loadCachedProfitability` → `fetchProfitabilityData` (dish side from the loader) |
| Recetas y costeo (Resumen, Plato por plato) | `loadRecipeCostingWorkspace` coverage + queue chips from the loader |
| Cockpit cost KPIs (food cost %, margin, coverage per period) | `loadBothPeriodCostKpis` → loader per period |
| Cockpit data health | `recipeCoverageFromProfitability` + all-time coverage from the adapter rows/KPIs |
| Costos (price changes) | `fetchProfitabilityData` trends + "Afecta N platos" from the loader |
| Daily briefing / email | `buildBriefingContext` → `fetchProfitabilityData` |
| Ask Milton | `fetchProfitabilityData` + ingredient usage from the loader's lines |
| Agents | `fetchProfitabilityData` |

`lib/restaurant/costing/dish-economics-adapter.ts` is the read-only bridge
that fills the legacy `ProfitabilityData` DTO from the loader, so those
consumers keep their shape while the numbers come from one place.

## Overlaps: keep / adapter / deprecate later

| Overlap | Decision | Notes |
|---|---|---|
| `pos_item_mappings` vs `pos_product_links` | **Keep `pos_product_links`.** `pos_item_mappings`: deprecate later | Still written by the cost-workbook repo and the CSV upload. Read for KPIs only for companies with no Odoo product/link (CSV bridge, below). |
| `recipes` + `menu_recipe_inputs` vs `recipe_versions` + `recipe_version_inputs` | **Keep versions.** `recipes` stays as the version's parent (`recipe_versions.recipe_id`); `menu_recipe_inputs`: deprecate later | `recipes.workbook_cost_match` is no longer read on the new path (the Excel diff comes from the link evidence). |
| `component_recipes` + `component_recipe_inputs` vs `component_recipe_versions` + inputs | **Keep both for now** | The engine reads the approved component version and falls back to the working recipe. Consolidate after all preparations have a version. |
| `ingredient_cost_entries` vs price catalog / `ingredient_aliases` | **Keep both: not a duplicate** | Entries are the single price record; the catalog review items and aliases decide *which* entry is written and how names map. Inline price edits on a recipe line write an entry (source manual + date), never a copy. |
| `recipe_canonical_lines` (043) | **Keep** | Import staging table; dishes are costed from versions, not from it. |
| Coverage functions: `buildPosProductList.coverage_pct`, `fetchProfitabilityData` KPI loop, `periodCostKpisFromRows` / `FromProductLines`, `salesWeightedCoverage` | **One: `totalsOf` in dish-economics** | The others remain only on the CSV bridge path. Deprecate with it. |
| Cost functions: `calculateAllMenuItemCosts` in profitability / menu-recipes / cockpit `itemCostLookupForPeriod` | **One: editor `hydrateLines` + `costInput`** (same engine) | Engine (`costing.ts`) stays; the batch callers are bridge-only. |
| Status functions: Recetas `buildPlatoQueue` statuses (`listo/por_aprobar/borrador/sin_receta`), legacy `CostStatus` per menu item | **One: `DishStatus`** | Queue chips now show the loader's status; `PlatoStatus` remains only for queue navigation. Legacy `CostStatus` is derived from `DishStatus` in the adapter. |
| `menu-recipes-server.ts` `fetchMenuRecipesData` (agent action catalog) | Deprecate later | Not a KPI path. |
| `loadCockpitExecutivePage` | Deprecate later (unused) | No route imports it. |

## CSV bridge (explicit, temporary)

A company with no Odoo product and no `pos_product_links` row (CSV uploads)
has nothing in the new model. For those companies only, `fetchProfitabilityData`
keeps the legacy name-mapped calculation. The switch is per company
(`DishEconomicsResult.uses_pos_products`), so every screen of one company uses
the same path and the numbers still agree across screens.

## Consolidation plan (later PRs, each approved separately)

1. Migrate CSV companies onto `pos_product_links` (a link per distinct raw
   POS name, synthetic product key) so they use the loader. Then remove the
   legacy branch of `fetchProfitabilityData`.
2. Stop writing `pos_item_mappings` from the cost-workbook repo and the CSV
   upload; keep the table read-only for one release.
3. Backfill a `component_recipe_version` for every preparation that only has
   a working `component_recipes` row; then read versions only.
4. Remove `menu_recipe_inputs` reads (Ask Milton fallback, menu-recipes
   server); keep `recipes` as the version parent.
5. Only after 1–4 ship and an export is archived: propose a destructive
   migration (drop or archive `pos_item_mappings`, `menu_recipe_inputs`) in
   its own reviewed PR.
