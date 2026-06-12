// types/restaurant-costing.ts
//
// Costing domain types for the deterministic engine in lib/restaurant/costing.ts.
//
// Kept in a separate file from types/restaurant.ts so the costing engine
// can stay strictly typed without dragging unrelated POS-domain types
// into client bundles.

/** Status outcomes for a costing calculation. `complete` is the only
 *  state where a numeric cost is available; every other status implies
 *  cost === null and explains why so callers can render an actionable
 *  message instead of fake zeros.
 */
export type CostStatus =
  | "complete"
  | "missing_recipe"
  // Distinct from `missing_recipe` so a menu item whose direct recipe
  // exists but whose sub-component has no recipe doesn't get tagged as
  // "no recipe" — that overload caused a real UX bug (see commit notes).
  | "missing_component_recipe"
  | "missing_input_cost"
  | "missing_unit_conversion"
  | "circular_component_reference"
  | "no_cost_entries"
  | "inactive_recipe";

/** A single human-readable issue surfaced by the engine. The dashboard
 *  renders these next to the cost cell so the user knows exactly what
 *  to fix. `path` is the recipe label trail, e.g.
 *  `["Brisket Sandwich", "Smoked Brisket"]`. */
export interface CostIssue {
  kind: CostStatus;
  message: string;
  /** Names from outermost recipe down to the problematic input. */
  path: string[];
}

/** Row shape persisted in `ingredient_cost_entries`. */
export interface IngredientCostEntry {
  id: string;
  company_id: string;
  ingredient_id: string;
  supplier_id: string | null;
  source_type: "manual" | "invoice_line" | "import" | "api";
  source_id: string | null;
  cost_date: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_cost: number;
  normalized_unit: string;
  normalized_unit_cost: number;
  currency: string;
  notes?: string;
  created_at: string;
}

/** Latest-cost lookup result for one ingredient. */
export interface IngredientCostResult {
  ingredient_id: string;
  /** null when no cost entry was found OR the available unit can't be
   *  converted to the unit the caller asked for. */
  unit_cost: number | null;
  unit: string | null;
  status: CostStatus;
  /** ISO date of the cost entry we used, or null when none was found. */
  cost_date: string | null;
  currency: string | null;
}

/** Cost of one prepared component. */
export interface ComponentCostResult {
  component_id: string;
  /** Cost of one canonical output unit (the component's output_unit). */
  cost_per_output_unit: number | null;
  /** Total cost to produce one batch (batch size = output_quantity). */
  batch_cost: number | null;
  output_quantity: number | null;
  output_unit: string | null;
  status: CostStatus;
  issues: CostIssue[];
}

/** Cost of one menu item. */
export interface MenuItemCostResult {
  menu_item_id: string;
  /** Sum of input costs for one serving of the menu item. */
  cost: number | null;
  selling_price: number | null;
  /** selling_price − cost. null when either side is missing. */
  gross_profit: number | null;
  /** gross_profit / selling_price × 100. null when selling_price ≤ 0
   *  or cost is missing. */
  gross_margin_pct: number | null;
  /** cost / selling_price × 100. */
  food_cost_pct: number | null;
  status: CostStatus;
  issues: CostIssue[];
}
