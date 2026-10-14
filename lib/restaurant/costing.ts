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

import {
  convertToSubRecipeUnit,
  convertUnitStr,
  normalizeUnit,
} from "@/lib/restaurant/units";
import { shouldApplyWorkbookMismatch } from "@/lib/restaurant/protect-imported-recipe";
import { workbookMismatchEngineMessage } from "@/lib/restaurant/cost-workbook/copy";
import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";
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

export interface CostingMenuRecipeVersion {
  id: string;
  recipe_id: string;
  menu_item_id: string;
  version_number: number;
  status: "approved" | "in_review" | string;
  effective_date: string | null;
  source_type?: string | null;
}

export interface CostingComponentRecipeVersion {
  id: string;
  component_recipe_id: string;
  component_id: string;
  version_number: number;
  status: "approved" | "in_review" | string;
  effective_date: string | null;
  output_quantity: number;
  output_unit: string;
  source_type?: string | null;
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
  source_type?: string | null;
  /** Imported recipes that do not match the workbook COSTO TOTAL. */
  workbook_cost_match?: "match" | "mismatch" | null;
}

export function parseWorkbookCostMatch(
  value: string | null | undefined
): "match" | "mismatch" | null {
  return value === "match" || value === "mismatch" ? value : null;
}

export interface CostingRecipeInput {
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  /**
   * Cost per one `unit` of this line, taken from the client's file (its
   * own tab). When set, the line costs quantity × unit_cost and the
   * catalog is not read; null/undefined keeps the catalog price.
   */
  unit_cost?: number | null;
  /**
   * Where the line's own cost came from ("manual" = a person typed it on the
   * line). A typed $0 is a price; a 0 from a file or invoice is not.
   */
  cost_source?: string | null;
}

/**
 * A line's own price: positive from any source, or exactly 0 only when a
 * person typed it ("manual"). A 0 from a file or invoice, and a missing
 * value, are NOT a price: the line then reads the catalog or stays Sin precio.
 */
export function lineHasOwnPrice(input: CostingRecipeInput): boolean {
  const cost = input.unit_cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return false;
  }
  return cost > 0 || input.cost_source === "manual";
}

/** A line that carries its own cost (from the client's file or typed). */
export function lineOwnCost(input: CostingRecipeInput): number | null {
  if (!lineHasOwnPrice(input)) return null;
  return input.quantity * (input.unit_cost as number);
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
  /** Approved + in-review versions. Costing reads pick the approved
   *  version in force for `asOfDate`. Missing maps fall back to the
   *  working recipe (first-version semantics). */
  menuRecipeVersionsByMenuItemId?: Map<string, CostingMenuRecipeVersion[]>;
  menuRecipeVersionInputsByVersionId?: Map<string, CostingRecipeInput[]>;
  componentRecipeVersionsByComponentId?: Map<
    string,
    CostingComponentRecipeVersion[]
  >;
  componentRecipeVersionInputsByVersionId?: Map<string, CostingRecipeInput[]>;
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
/**
 * A price of $0 is real only when a person typed it on purpose (water, ice):
 * a manual entry. A 0 that came from a file, an invoice or a blank cell is a
 * missing price, never a free ingredient: it is ignored here, so the
 * ingredient stays "Sin precio" instead of being costed at $0.
 */
export function isUnconfirmedZeroEntry(e: IngredientCostEntry): boolean {
  const zero =
    Number(e.normalized_unit_cost) === 0 || Number(e.unit_cost) === 0;
  return zero && e.source_type !== "manual";
}

export function getLatestIngredientCost(
  ingredientId: string,
  data: CostingData,
  options?: CostingOptions
): IngredientCostResult {
  const ingredient = data.ingredientsById.get(ingredientId);
  const entries = data.costEntriesByIngredientId.get(ingredientId) ?? [];
  const asOf = options?.asOfDate;

  // Filter by as-of on the price's effective date (fall back to cost_date
  // for rows that predate 036), then sort newest first.
  const entryDate = (e: IngredientCostEntry) => e.effective_date || e.cost_date;
  const eligible = entries.filter(
    (e) => (!asOf || entryDate(e) <= asOf) && !isUnconfirmedZeroEntry(e)
  );
  eligible.sort((a, b) => {
    const aDate = entryDate(a);
    const bDate = entryDate(b);
    if (aDate < bDate) return 1;
    if (aDate > bDate) return -1;
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
    cost_date: entryDate(latest),
    currency: latest.currency,
  };
}

function menuRecipeForAsOf(
  menuItemId: string,
  data: CostingData,
  asOfDate?: string
): {
  recipe: CostingMenuRecipe | undefined;
  inputs: CostingRecipeInput[];
  applyWorkbookMismatch: boolean;
} {
  const working = data.menuRecipesByMenuItemId.get(menuItemId);
  const versions = data.menuRecipeVersionsByMenuItemId?.get(menuItemId) ?? [];
  const picked = pickApprovedVersion(versions, asOfDate);
  if (!picked) {
    if (versions.length > 0) {
      return { recipe: undefined, inputs: [], applyWorkbookMismatch: false };
    }
    return {
      recipe: working,
      inputs: working
        ? (data.menuRecipeInputsByRecipeId.get(working.id) ?? [])
        : [],
      applyWorkbookMismatch: true,
    };
  }
  const inputs =
    data.menuRecipeVersionInputsByVersionId?.get(picked.id) ??
    (working ? (data.menuRecipeInputsByRecipeId.get(working.id) ?? []) : []);
  const latestApproved = pickApprovedVersion(versions);
  const isCurrent = latestApproved?.id === picked.id;
  return {
    recipe: {
      id: picked.recipe_id,
      menu_item_id: picked.menu_item_id,
      status: "active",
      source_type: picked.source_type ?? working?.source_type ?? null,
      workbook_cost_match: isCurrent
        ? (working?.workbook_cost_match ?? null)
        : null,
    },
    inputs,
    applyWorkbookMismatch: isCurrent,
  };
}

function componentRecipeForAsOf(
  componentId: string,
  data: CostingData,
  asOfDate?: string
): {
  recipe: CostingComponentRecipe | undefined;
  inputs: CostingRecipeInput[];
} {
  const working = data.componentRecipesByComponentId.get(componentId);
  const versions =
    data.componentRecipeVersionsByComponentId?.get(componentId) ?? [];
  const picked = pickApprovedVersion(versions, asOfDate);
  if (!picked) {
    if (versions.length > 0) {
      return { recipe: undefined, inputs: [] };
    }
    return {
      recipe: working,
      inputs: working
        ? (data.componentRecipeInputsByRecipeId.get(working.id) ?? [])
        : [],
    };
  }
  return {
    recipe: {
      id: picked.component_recipe_id,
      component_id: picked.component_id,
      output_quantity: picked.output_quantity,
      output_unit: picked.output_unit,
      status: "active",
    },
    inputs:
      data.componentRecipeVersionInputsByVersionId?.get(picked.id) ??
      (working
        ? (data.componentRecipeInputsByRecipeId.get(working.id) ?? [])
        : []),
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
  const resolved = componentRecipeForAsOf(componentId, data, options?.asOfDate);
  const recipe = resolved.recipe;
  const inputs = resolved.inputs;
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
    const own = lineOwnCost(input);
    if (own !== null) {
      batchCost += own;
      continue;
    }
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
      const converted = convertToSubRecipeUnit(
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
      workbook_mismatch: 2,
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
  const resolved = menuRecipeForAsOf(menuItemId, data, options?.asOfDate);
  const recipe = resolved.recipe;
  const inputs = resolved.inputs;
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
    const own = lineOwnCost(input);
    if (own !== null) {
      total += own;
      continue;
    }
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
      const converted = convertToSubRecipeUnit(
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
      workbook_mismatch: 2,
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

  if (resolved.applyWorkbookMismatch && shouldApplyWorkbookMismatch(recipe)) {
    const issues: CostIssue[] = [];
    pushIssue(
      issues,
      "workbook_mismatch",
      workbookMismatchEngineMessage("es", name),
      trail
    );
    return empty("workbook_mismatch", issues);
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
