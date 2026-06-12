// lib/restaurant/costing.ts
//
// Deterministic cost engine for the restaurant cockpit.
//
// Pure functions over a pre-fetched `CostingData` bundle. No I/O, no
// Supabase calls — the server data layer hydrates the bundle once per
// page render and hands it here. That keeps:
//   * the engine unit-testable in isolation,
//   * costing identical between page renders and API responses,
//   * a clean line between data fetching (slow, async, RLS) and
//     calculation (fast, sync, total).
//
// Costing rules in one place:
//   * Latest ingredient cost = most recent `cost_date <= asOfDate` from
//     `ingredient_cost_entries`. We read `normalized_unit_cost` /
//     `normalized_unit` only — the original supplier observation is
//     for audit, not for arithmetic.
//   * Ingredient input cost = `quantity × normalized_unit_cost`, after
//     converting the recipe-unit to the cost-unit via convertUnitStr().
//     Unsupported conversion → `missing_unit_conversion` (NOT a zero).
//   * Component cost = sum(input costs of the active component recipe)
//     / output_quantity. `cost_per_output_unit` is the canonical number
//     menu recipes consume.
//   * Menu item cost = sum(input costs of the menu recipe). Unknown
//     input costs propagate up as `missing_input_cost`. cost is null
//     in any non-`complete` status — never zero.
//   * Circular component references are detected via a visit-stack;
//     callers see status `circular_component_reference` and the engine
//     never recurses infinitely.

import { convertUnitStr, normalizeUnit } from "@/lib/restaurant/units";
import type {
  CostIssue,
  ComponentCostResult,
  IngredientCostEntry,
  IngredientCostResult,
  MenuItemCostResult,
} from "@/types/restaurant-costing";

// ---------------------------------------------------------------------------
// Input bundle shapes — kept narrow so the engine accepts plain rows
// without dragging in Supabase types.
// ---------------------------------------------------------------------------

export interface CostingIngredient {
  id: string;
  name: string;
  default_unit: string | null;
}

export interface CostingComponent {
  id: string;
  name: string;
  output_unit: string;
  status: "draft" | "active" | "archived" | string;
}

export interface CostingComponentRecipe {
  id: string;
  component_id: string;
  output_quantity: number;
  output_unit: string;
  status: "draft" | "active" | "archived" | string;
}

export interface CostingMenuItem {
  id: string;
  name: string;
  selling_price: number | null;
  currency: string | null;
}

export interface CostingMenuRecipe {
  id: string;
  menu_item_id: string;
  status: "draft" | "active" | "archived" | string;
}

export interface CostingRecipeInput {
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
}

/**
 * The fully-resolved data the engine needs. The caller (server data
 * layer) hands this in; the engine never reads anything else.
 */
export interface CostingData {
  ingredientsById: Map<string, CostingIngredient>;
  componentsById: Map<string, CostingComponent>;
  componentRecipesByComponentId: Map<string, CostingComponentRecipe>;
  componentRecipeInputsByRecipeId: Map<string, CostingRecipeInput[]>;
  menuItemsById: Map<string, CostingMenuItem>;
  menuRecipesByMenuItemId: Map<string, CostingMenuRecipe>;
  menuRecipeInputsByRecipeId: Map<string, CostingRecipeInput[]>;
  /** All cost entries grouped by ingredient_id. Ordering does NOT need
   *  to be pre-sorted; the engine picks the latest as-of `asOfDate`. */
  costEntriesByIngredientId: Map<string, IngredientCostEntry[]>;
}

export interface CostingOptions {
  /** "Latest cost as of" filter. Default: today's UTC date. */
  asOfDate?: string;
}

// ---------------------------------------------------------------------------
// Ingredient cost lookup
// ---------------------------------------------------------------------------

/**
 * Returns the most recent cost entry for an ingredient with a non-null
 * normalized_unit_cost, optionally restricted to `cost_date <= asOfDate`.
 * `unit_cost` / `unit` in the result are the NORMALIZED projection — the
 * engine never reasons against the raw supplier units.
 */
export function getLatestIngredientCost(
  ingredientId: string,
  data: CostingData,
  options?: CostingOptions
): IngredientCostResult {
  const ingredient = data.ingredientsById.get(ingredientId);
  const entries = data.costEntriesByIngredientId.get(ingredientId) ?? [];
  const asOf = options?.asOfDate;

  // Filter by as-of, then sort by cost_date desc then created_at desc as
  // a deterministic tie-break. We don't mutate the caller's array.
  const eligible = entries.filter((e) => !asOf || e.cost_date <= asOf);
  eligible.sort((a, b) => {
    if (a.cost_date < b.cost_date) return 1;
    if (a.cost_date > b.cost_date) return -1;
    // Same date: most-recently-created wins (e.g. duplicate observation
    // for the same supplier shipment is corrected later that day).
    if ((a.created_at ?? "") < (b.created_at ?? "")) return 1;
    if ((a.created_at ?? "") > (b.created_at ?? "")) return -1;
    return 0;
  });
  const latest = eligible[0];

  if (!latest) {
    return {
      ingredient_id: ingredientId,
      unit_cost: null,
      unit: ingredient?.default_unit ?? null,
      status: "no_cost_entries",
      cost_date: null,
      currency: null,
    };
  }

  return {
    ingredient_id: ingredientId,
    unit_cost: latest.normalized_unit_cost,
    unit: latest.normalized_unit,
    status: "complete",
    cost_date: latest.cost_date,
    currency: latest.currency,
  };
}

// ---------------------------------------------------------------------------
// Input-level cost
// ---------------------------------------------------------------------------

/**
 * Returns the cost in the input's `unit` for `input.quantity × cost`,
 * after converting the input's unit to the cost entry's normalized unit.
 *
 * Returns null + a `CostStatus` so the caller can convert this into a
 * CostIssue with full context (recipe name, etc.).
 */
function costIngredientInput(
  input: CostingRecipeInput,
  cost: IngredientCostResult
):
  | { ok: true; amount: number }
  | { ok: false; status: "no_cost_entries" | "missing_unit_conversion" } {
  if (
    cost.status === "no_cost_entries" ||
    cost.unit_cost === null ||
    !cost.unit
  ) {
    return { ok: false, status: "no_cost_entries" };
  }
  // Convert quantity from the recipe's unit to the cost-entry's
  // normalized unit. We multiply by `unit_cost` AFTER the conversion so
  // both sides agree on dimensionality.
  if (normalizeUnit(input.unit) === null || normalizeUnit(cost.unit) === null) {
    return { ok: false, status: "missing_unit_conversion" };
  }
  const converted = convertUnitStr(input.quantity, input.unit, cost.unit);
  if (!converted.ok) {
    return { ok: false, status: "missing_unit_conversion" };
  }
  return { ok: true, amount: converted.value * cost.unit_cost };
}

// ---------------------------------------------------------------------------
// Component cost
// ---------------------------------------------------------------------------

function pushIssue(
  list: CostIssue[],
  kind: CostIssue["kind"],
  message: string,
  path: string[]
): void {
  list.push({ kind, message, path });
}

/**
 * Re-tags sub-component issues as they bubble up into a PARENT's issue
 * list. The parent (a menu item or a deeper component) has its own
 * recipe — its sub-component's `missing_recipe` would be misleading at
 * the parent level. We rename to `missing_component_recipe` and prepend
 * the sub-component name so the UI message reads naturally.
 *
 * `sub` is the deepest component name we recursed into; that's what the
 * user needs to fix.
 */
function hoistSubIssue(
  subIssue: CostIssue,
  subComponentName: string
): CostIssue {
  if (subIssue.kind === "missing_recipe") {
    return {
      kind: "missing_component_recipe",
      message: `Missing component recipe for ${subComponentName}.`,
      path: subIssue.path,
    };
  }
  // Other kinds (no_cost_entries, missing_unit_conversion, inactive_recipe,
  // circular_component_reference, etc.) already describe a specific
  // ingredient/component by name — keep them verbatim.
  return subIssue;
}

/**
 * Calculates the cost-per-output-unit of a prepared component.
 *
 * Recursion: components can have other components as inputs. We pass a
 * `visiting` set through the recursive call so a cycle (A uses B uses A)
 * is detected and surfaces a status without infinite looping.
 */
export function calculateComponentCost(
  componentId: string,
  data: CostingData,
  options?: CostingOptions,
  visiting: Set<string> = new Set(),
  path: string[] = []
): ComponentCostResult {
  const component = data.componentsById.get(componentId);
  const recipe = data.componentRecipesByComponentId.get(componentId);
  const inputs = recipe
    ? (data.componentRecipeInputsByRecipeId.get(recipe.id) ?? [])
    : [];
  const name = component?.name ?? "(unknown component)";
  const trail = [...path, name];

  // Empty cost shell used for every non-complete return.
  const empty = (
    status: ComponentCostResult["status"],
    issues: CostIssue[] = []
  ): ComponentCostResult => ({
    component_id: componentId,
    cost_per_output_unit: null,
    batch_cost: null,
    output_quantity: recipe?.output_quantity ?? null,
    output_unit: recipe?.output_unit ?? component?.output_unit ?? null,
    status,
    issues,
  });

  if (visiting.has(componentId)) {
    const issues: CostIssue[] = [];
    pushIssue(
      issues,
      "circular_component_reference",
      `Circular component reference detected at ${name}.`,
      trail
    );
    return empty("circular_component_reference", issues);
  }
  if (!recipe) {
    const issues: CostIssue[] = [];
    pushIssue(
      issues,
      "missing_recipe",
      `${name} has no component recipe.`,
      trail
    );
    return empty("missing_recipe", issues);
  }
  if (recipe.status !== "active" && recipe.status !== "draft") {
    // We allow draft AND active for transparency during cockpit setup,
    // but explicitly call out archived/other so the user understands why.
    const issues: CostIssue[] = [];
    pushIssue(
      issues,
      "inactive_recipe",
      `${name} component recipe is ${recipe.status}.`,
      trail
    );
    return empty("inactive_recipe", issues);
  }
  if (!recipe.output_quantity || recipe.output_quantity <= 0) {
    const issues: CostIssue[] = [];
    pushIssue(
      issues,
      "missing_recipe",
      `${name} recipe has no positive output_quantity.`,
      trail
    );
    return empty("missing_recipe", issues);
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(componentId);

  let batchCost = 0;
  const issues: CostIssue[] = [];

  for (const input of inputs) {
    if (input.input_type === "ingredient") {
      if (!input.ingredient_id) {
        pushIssue(
          issues,
          "missing_input_cost",
          `${name} has an ingredient input with no ingredient_id.`,
          trail
        );
        continue;
      }
      const ing = data.ingredientsById.get(input.ingredient_id);
      const ingName = ing?.name ?? "(unknown ingredient)";
      const cost = getLatestIngredientCost(input.ingredient_id, data, options);
      const lineTrail = [...trail, ingName];
      const line = costIngredientInput(input, cost);
      if (!line.ok) {
        pushIssue(
          issues,
          line.status,
          line.status === "no_cost_entries"
            ? `No cost entries for ingredient ${ingName}.`
            : `Cannot convert ${input.unit} → ${cost.unit ?? "?"} for ${ingName}.`,
          lineTrail
        );
        continue;
      }
      batchCost += line.amount;
    } else if (input.input_type === "component") {
      if (!input.component_id) {
        pushIssue(
          issues,
          "missing_input_cost",
          `${name} has a component input with no component_id.`,
          trail
        );
        continue;
      }
      const sub = calculateComponentCost(
        input.component_id,
        data,
        options,
        nextVisiting,
        trail
      );
      if (sub.status !== "complete" || sub.cost_per_output_unit === null) {
        // Hoist the sub-component's issues up so the menu page can show
        // the whole story without re-walking the tree. We re-tag
        // sub.kind === "missing_recipe" as `missing_component_recipe`
        // because the PARENT (this component) has its own recipe.
        const subName =
          data.componentsById.get(input.component_id)?.name ?? "(component)";
        for (const subIssue of sub.issues) {
          issues.push(hoistSubIssue(subIssue, subName));
        }
        continue;
      }
      // Convert recipe-input units to the sub-component's output unit.
      const converted = convertUnitStr(
        input.quantity,
        input.unit,
        sub.output_unit ?? ""
      );
      if (!converted.ok) {
        const subName =
          data.componentsById.get(input.component_id)?.name ?? "(component)";
        pushIssue(
          issues,
          "missing_unit_conversion",
          `Cannot convert ${input.unit} → ${sub.output_unit ?? "?"} for ${subName}.`,
          [...trail, subName]
        );
        continue;
      }
      batchCost += converted.value * sub.cost_per_output_unit;
    }
  }

  if (issues.length > 0) {
    // Choose the highest-priority status: circular > missing_recipe >
    // missing_unit_conversion > missing_input_cost (= no_cost_entries).
    // Priority for picking the parent's overall status when multiple
    // issues exist. `missing_component_recipe` ranks ABOVE the simple
    // input-cost-missing case (it's the deeper structural problem) but
    // BELOW `missing_recipe` — which is reserved for the case where
    // this entity itself has no recipe at all.
    const priority: Record<CostIssue["kind"], number> = {
      complete: 0,
      missing_input_cost: 1,
      no_cost_entries: 1,
      missing_unit_conversion: 2,
      missing_component_recipe: 3,
      inactive_recipe: 4,
      missing_recipe: 5,
      circular_component_reference: 6,
    };
    let worst: CostIssue["kind"] = "missing_input_cost";
    for (const i of issues)
      if (priority[i.kind] > priority[worst]) worst = i.kind;
    return empty(worst, issues);
  }

  const costPerOutputUnit = batchCost / recipe.output_quantity;
  return {
    component_id: componentId,
    cost_per_output_unit: costPerOutputUnit,
    batch_cost: batchCost,
    output_quantity: recipe.output_quantity,
    output_unit: recipe.output_unit,
    status: "complete",
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// Menu-item cost
// ---------------------------------------------------------------------------

export function calculateMenuItemCost(
  menuItemId: string,
  data: CostingData,
  options?: CostingOptions
): MenuItemCostResult {
  const menuItem = data.menuItemsById.get(menuItemId);
  const recipe = data.menuRecipesByMenuItemId.get(menuItemId);
  const inputs = recipe
    ? (data.menuRecipeInputsByRecipeId.get(recipe.id) ?? [])
    : [];
  const name = menuItem?.name ?? "(unknown menu item)";
  const trail = [name];

  const sellingPrice = menuItem?.selling_price ?? null;

  const empty = (
    status: MenuItemCostResult["status"],
    issues: CostIssue[] = []
  ): MenuItemCostResult => ({
    menu_item_id: menuItemId,
    cost: null,
    selling_price: sellingPrice,
    gross_profit: null,
    gross_margin_pct: null,
    food_cost_pct: null,
    status,
    issues,
  });

  if (!recipe) {
    const issues: CostIssue[] = [];
    pushIssue(issues, "missing_recipe", `${name} has no recipe.`, trail);
    return empty("missing_recipe", issues);
  }
  if (recipe.status === "archived") {
    const issues: CostIssue[] = [];
    pushIssue(issues, "inactive_recipe", `${name} recipe is archived.`, trail);
    return empty("inactive_recipe", issues);
  }
  if (inputs.length === 0) {
    const issues: CostIssue[] = [];
    pushIssue(issues, "missing_recipe", `${name} recipe has no inputs.`, trail);
    return empty("missing_recipe", issues);
  }

  let total = 0;
  const issues: CostIssue[] = [];

  for (const input of inputs) {
    if (input.input_type === "ingredient") {
      if (!input.ingredient_id) {
        pushIssue(
          issues,
          "missing_input_cost",
          `${name} has an ingredient input with no ingredient_id.`,
          trail
        );
        continue;
      }
      const ing = data.ingredientsById.get(input.ingredient_id);
      const ingName = ing?.name ?? "(ingredient)";
      const cost = getLatestIngredientCost(input.ingredient_id, data, options);
      const line = costIngredientInput(input, cost);
      if (!line.ok) {
        pushIssue(
          issues,
          line.status,
          line.status === "no_cost_entries"
            ? `No cost entries for ingredient ${ingName}.`
            : `Cannot convert ${input.unit} → ${cost.unit ?? "?"} for ${ingName}.`,
          [...trail, ingName]
        );
        continue;
      }
      total += line.amount;
    } else if (input.input_type === "component") {
      if (!input.component_id) {
        pushIssue(
          issues,
          "missing_input_cost",
          `${name} has a component input with no component_id.`,
          trail
        );
        continue;
      }
      const sub = calculateComponentCost(
        input.component_id,
        data,
        options,
        new Set<string>(),
        trail
      );
      if (sub.status !== "complete" || sub.cost_per_output_unit === null) {
        // Same renaming as in calculateComponentCost — a missing recipe
        // on a sub-component is not the same as the menu item having
        // no recipe. Without this remap, "missing_recipe" would beat
        // every other status in the priority picker below and the
        // dashboard would label the menu item "no recipe" even though
        // its own recipe is active.
        const subName =
          data.componentsById.get(input.component_id)?.name ?? "(component)";
        for (const subIssue of sub.issues) {
          issues.push(hoistSubIssue(subIssue, subName));
        }
        continue;
      }
      const converted = convertUnitStr(
        input.quantity,
        input.unit,
        sub.output_unit ?? ""
      );
      if (!converted.ok) {
        const subName =
          data.componentsById.get(input.component_id)?.name ?? "(component)";
        pushIssue(
          issues,
          "missing_unit_conversion",
          `Cannot convert ${input.unit} → ${sub.output_unit ?? "?"} for ${subName}.`,
          [...trail, subName]
        );
        continue;
      }
      total += converted.value * sub.cost_per_output_unit;
    }
  }

  if (issues.length > 0) {
    // Priority for picking the parent's overall status when multiple
    // issues exist. `missing_component_recipe` ranks ABOVE the simple
    // input-cost-missing case (it's the deeper structural problem) but
    // BELOW `missing_recipe` — which is reserved for the case where
    // this entity itself has no recipe at all.
    const priority: Record<CostIssue["kind"], number> = {
      complete: 0,
      missing_input_cost: 1,
      no_cost_entries: 1,
      missing_unit_conversion: 2,
      missing_component_recipe: 3,
      inactive_recipe: 4,
      missing_recipe: 5,
      circular_component_reference: 6,
    };
    let worst: CostIssue["kind"] = "missing_input_cost";
    for (const i of issues)
      if (priority[i.kind] > priority[worst]) worst = i.kind;
    return empty(worst, issues);
  }

  const cost = total;
  const grossProfit = sellingPrice !== null ? sellingPrice - cost : null;
  const grossMarginPct =
    sellingPrice && sellingPrice > 0
      ? ((sellingPrice - cost) / sellingPrice) * 100
      : null;
  const foodCostPct =
    sellingPrice && sellingPrice > 0 ? (cost / sellingPrice) * 100 : null;

  return {
    menu_item_id: menuItemId,
    cost,
    selling_price: sellingPrice,
    gross_profit: grossProfit,
    gross_margin_pct: grossMarginPct,
    food_cost_pct: foodCostPct,
    status: "complete",
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// Batch helpers — convenient for dashboard rendering.
// ---------------------------------------------------------------------------

export function calculateAllComponentCosts(
  data: CostingData,
  options?: CostingOptions
): Map<string, ComponentCostResult> {
  const out = new Map<string, ComponentCostResult>();
  for (const id of data.componentsById.keys()) {
    out.set(id, calculateComponentCost(id, data, options));
  }
  return out;
}

export function calculateAllMenuItemCosts(
  data: CostingData,
  options?: CostingOptions
): Map<string, MenuItemCostResult> {
  const out = new Map<string, MenuItemCostResult>();
  for (const id of data.menuItemsById.keys()) {
    out.set(id, calculateMenuItemCost(id, data, options));
  }
  return out;
}
