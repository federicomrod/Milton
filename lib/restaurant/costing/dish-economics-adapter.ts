// lib/restaurant/costing/dish-economics-adapter.ts
//
// Read-only bridge (R1-09a): the legacy ProfitabilityData shape, filled
// from dish-economics. Briefing, Ask Milton, agents and the cockpit keep
// their DTO, but the numbers in it are the shared loader's — no second
// cost, coverage or status calculation. Nothing here writes anywhere.

import type {
  CostStatus,
  MenuItemCostResult,
} from "@/types/restaurant-costing";
import type { PeriodCostKpis } from "@/lib/restaurant/cockpit-cost-coverage";
import type {
  DishEconomics,
  DishEconomicsResult,
  DishStatus,
} from "./dish-economics";

/** Legacy status for each dish status (legacy views label from it). */
const LEGACY_STATUS: Record<DishStatus, CostStatus> = {
  aprobado: "complete",
  // A recipe exists but nobody approved it: not counted in margins.
  estimado: "inactive_recipe",
  falta_precio: "no_cost_entries",
  sin_receta: "missing_recipe",
};

export interface LegacyMarginRow {
  menu_item_id: string;
  odoo_product_id: number;
  name: string;
  category: string | null;
  selling_price: number | null;
  units_sold: number;
  revenue: number;
  raw_pos_names: string[];
  cost: MenuItemCostResult;
  estimated_total_cost: number | null;
  estimated_gross_profit: number | null;
}

/** Stable row id: the menu item when linked, else the POS product. */
export function dishRowId(
  dish: Pick<DishEconomics, "menu_item_id" | "odoo_product_id">
): string {
  return dish.menu_item_id ?? `pos:${dish.odoo_product_id}`;
}

export function legacyCostOf(dish: DishEconomics): MenuItemCostResult {
  const counted = dish.in_cogs && dish.unit_cost !== null;
  const status: CostStatus =
    dish.status === "aprobado" && !counted
      ? // Combo costed by its parts: covered, but no unit cost of its own.
        "missing_input_cost"
      : LEGACY_STATUS[dish.status];
  const cost = counted ? dish.unit_cost : null;
  const price = dish.avg_net_price;
  return {
    menu_item_id: dishRowId(dish),
    cost,
    selling_price: price,
    gross_profit: cost !== null && price !== null ? price - cost : null,
    gross_margin_pct:
      cost !== null && price !== null && price > 0
        ? ((price - cost) / price) * 100
        : null,
    food_cost_pct:
      cost !== null && price !== null && price > 0
        ? (cost / price) * 100
        : null,
    status,
    issues: [],
  };
}

export function legacyMarginRows(
  result: DishEconomicsResult
): LegacyMarginRow[] {
  // R1-10: drinks, extras and excluded dishes are not food: out of rows.
  return result.dishes
    .filter((dish) => !dish.excluded_reason)
    .map((dish) => {
      const cost = legacyCostOf(dish);
      const total = cost.cost !== null ? cost.cost * dish.units_sold : null;
      return {
        menu_item_id: dishRowId(dish),
        odoo_product_id: dish.odoo_product_id,
        name: dish.name,
        category: dish.category,
        selling_price: dish.avg_net_price,
        units_sold: dish.units_sold,
        revenue: dish.net_sales,
        raw_pos_names: dish.raw_names,
        cost,
        estimated_total_cost: total,
        estimated_gross_profit: total !== null ? dish.net_sales - total : null,
      };
    });
}

/** The cockpit's period cost KPIs, from the same totals. */
export function periodCostKpisFromDishEconomics(
  result: DishEconomicsResult
): PeriodCostKpis {
  const t = result.totals;
  return {
    coverage_pct: t.coverage_pct,
    covered_net: t.covered_net_sales,
    estimated_cogs: t.estimated_cogs,
    food_cost_pct: t.food_cost_pct,
    gross_margin_pct: t.gross_margin_pct,
  };
}

/** Uses the new model: the company sells through Odoo products/links. */
export function usesPosProductModel(result: DishEconomicsResult): boolean {
  return result.uses_pos_products;
}
