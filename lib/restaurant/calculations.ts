// lib/restaurant/calculations.ts
// Pure deterministic helpers for restaurant profitability calculations.
// No Supabase, no OpenAI, no side effects — safe to call in tests and on the server.
//
// Naming note: functions are prefixed "calculateRestaurant…" / "getRestaurant…" to
// distinguish them from the legacy lib/kpi-calculations/calculateMenuItemMargin.ts
// which operates on Supabase model_data rows and is unrelated.

import type {
  MenuItem,
  Ingredient,
  Recipe,
  RecipeIngredient,
  SupplierInvoice,
  SupplierInvoiceLine,
  POSSalesItem,
  RestaurantRecommendation,
  MenuItemCostResult,
  MenuItemMargin,
  RestaurantOverview,
  UnitOfMeasure,
} from "@/types/restaurant";
import { convertUnitPrice } from "./units";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a map from invoice_id → invoice_date (ISO string) for fast lookup.
 */
function buildInvoiceDateMap(invoices: SupplierInvoice[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const inv of invoices) {
    map.set(inv.id, inv.invoice_date);
  }
  return map;
}

/**
 * Resolves the unit price for an ingredient in the requested `targetUnit`.
 * Uses the most recent supplier invoice line (by invoice_date) as the
 * authoritative cost source, falling back to ingredient.current_unit_cost.
 *
 * Returns null with a status code when the cost cannot be determined
 * (e.g. missing invoice data, unsupported unit conversion).
 */
function resolveIngredientUnitCost(
  ingredient: Ingredient,
  targetUnit: UnitOfMeasure,
  invoiceDateMap: Map<string, string>,
  invoiceLines: SupplierInvoiceLine[]
):
  | { unitCost: number; status: "ok" }
  | {
      unitCost: null;
      status: "missing_ingredient_cost" | "missing_unit_conversion";
    } {
  // Find all lines for this ingredient, sorted by invoice date descending.
  const lines = invoiceLines
    .filter((l) => l.ingredient_id === ingredient.id)
    .map((l) => ({ line: l, date: invoiceDateMap.get(l.invoice_id) ?? "" }))
    .filter((e) => e.date !== "")
    .sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      return cmp !== 0 ? cmp : b.line.id.localeCompare(a.line.id); // stable tie-break
    });

  if (lines.length === 0) {
    // No invoice data — fall back to ingredient's recorded cost, assuming
    // its default_unit matches the target unit.
    if (ingredient.current_unit_cost <= 0) {
      return { unitCost: null, status: "missing_ingredient_cost" };
    }
    const conversion = convertUnitPrice(
      ingredient.current_unit_cost,
      ingredient.default_unit,
      targetUnit
    );
    if (!conversion.ok)
      return { unitCost: null, status: "missing_unit_conversion" };
    return { unitCost: conversion.value, status: "ok" };
  }

  const { line } = lines[0];
  const conversion = convertUnitPrice(line.unit_price, line.unit, targetUnit);
  if (!conversion.ok)
    return { unitCost: null, status: "missing_unit_conversion" };
  return { unitCost: conversion.value, status: "ok" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculates the total ingredient cost for one serving of a menu item.
 *
 * Uses the most recent supplier invoice date (not lexicographic ID order) to
 * determine current ingredient prices. Unit conversion is applied when the
 * recipe unit and invoice unit differ.
 *
 * Returns cost: null with an explicit status when costing is incomplete.
 */
export function calculateRestaurantMenuItemCost(
  menuItemId: string,
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[]
): MenuItemCostResult {
  const recipe = recipes.find((r) => r.menu_item_id === menuItemId);
  if (!recipe) return { cost: null, status: "missing_recipe" };

  const lines = recipeIngredients.filter((ri) => ri.recipe_id === recipe.id);
  if (lines.length === 0) return { cost: null, status: "missing_recipe" };

  const dateMap = buildInvoiceDateMap(invoices);
  let totalCost = 0;
  const missingItems: string[] = [];
  let worstStatus: MenuItemCostResult["status"] = "complete";

  for (const ri of lines) {
    const ingredient = ingredients.find((i) => i.id === ri.ingredient_id);
    if (!ingredient) {
      missingItems.push(ri.ingredient_id);
      worstStatus = "missing_ingredient_cost";
      continue;
    }

    const resolved = resolveIngredientUnitCost(
      ingredient,
      ri.unit,
      dateMap,
      invoiceLines
    );
    if (resolved.status !== "ok") {
      missingItems.push(ingredient.name);
      worstStatus =
        worstStatus === "complete" ||
        resolved.status === "missing_unit_conversion"
          ? resolved.status
          : worstStatus;
      continue;
    }

    const effectiveQty = ri.quantity * (1 + ri.waste_factor);
    totalCost += resolved.unitCost * effectiveQty;
  }

  if (worstStatus !== "complete") {
    return { cost: null, status: worstStatus, missingItems };
  }
  return { cost: totalCost, status: "complete" };
}

/**
 * Returns margin metrics for a single menu item given a cost result.
 * All margin fields are null when cost is unknown, preventing false 100% margins.
 */
export function calculateRestaurantMenuItemMargin(
  menuItem: MenuItem,
  costResult: MenuItemCostResult
): MenuItemMargin {
  if (costResult.cost === null) {
    return {
      menu_item_id: menuItem.id,
      name: menuItem.name,
      selling_price: menuItem.selling_price,
      cost_result: costResult,
      calculated_cost: null,
      gross_margin_amount: null,
      gross_margin_pct: null,
      food_cost_pct: null,
    };
  }

  const grossMarginAmount = menuItem.selling_price - costResult.cost;
  const grossMarginPct =
    menuItem.selling_price > 0
      ? (grossMarginAmount / menuItem.selling_price) * 100
      : null;
  const foodCostPct =
    menuItem.selling_price > 0
      ? (costResult.cost / menuItem.selling_price) * 100
      : null;

  return {
    menu_item_id: menuItem.id,
    name: menuItem.name,
    selling_price: menuItem.selling_price,
    cost_result: costResult,
    calculated_cost: costResult.cost,
    gross_margin_amount: grossMarginAmount,
    gross_margin_pct: grossMarginPct,
    food_cost_pct: foodCostPct,
  };
}

/**
 * Calculates aggregate restaurant overview metrics from POS sales data.
 *
 * Order counting:
 * - When check_id is present on sale items, total_orders = unique check_id count.
 * - When check_id is absent (daily-summary imports), total_orders = sale row count.
 * - total_units_sold always = sum of quantities regardless of check_id presence.
 *
 * Food cost is only summed for items where cost can be fully resolved from recipes.
 * Items without recipes are excluded from food cost (not zeroed) to avoid understating
 * the true food cost %. The caller should note this if any items lack recipes.
 */
export function calculateRestaurantOverview(
  salesItems: POSSalesItem[],
  menuItems: MenuItem[],
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[]
): RestaurantOverview {
  let totalRevenue = 0;
  let totalUnitsSold = 0;
  let foodCostAmount = 0;

  for (const sale of salesItems) {
    totalRevenue += sale.total_revenue;
    totalUnitsSold += sale.quantity;

    const menuItem = menuItems.find((m) => m.id === sale.menu_item_id);
    if (!menuItem) continue;

    const costResult = calculateRestaurantMenuItemCost(
      sale.menu_item_id,
      recipes,
      recipeIngredients,
      ingredients,
      invoices,
      invoiceLines
    );
    if (costResult.cost !== null) {
      foodCostAmount += costResult.cost * sale.quantity;
    }
  }

  // Count unique check_ids only when every record carries one (granular POS export).
  // When any record lacks a check_id (daily-summary import), fall back to row count.
  const allHaveCheckIds =
    salesItems.length > 0 && salesItems.every((s) => !!s.check_id);
  const totalOrders = allHaveCheckIds
    ? new Set(salesItems.map((s) => s.check_id!)).size
    : salesItems.length;

  const grossMarginAmount = totalRevenue - foodCostAmount;
  const foodCostPct =
    totalRevenue > 0 ? (foodCostAmount / totalRevenue) * 100 : 0;
  const grossMarginPct =
    totalRevenue > 0 ? (grossMarginAmount / totalRevenue) * 100 : 0;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const currency =
    salesItems.length > 0 ? (salesItems[0].currency ?? "USD") : "USD";

  return {
    total_revenue: totalRevenue,
    total_orders: totalOrders,
    total_units_sold: totalUnitsSold,
    food_cost_amount: foodCostAmount,
    food_cost_pct: foodCostPct,
    gross_margin_amount: grossMarginAmount,
    gross_margin_pct: grossMarginPct,
    avg_ticket: avgTicket,
    currency,
  };
}

/**
 * Returns margin data for all menu items.
 * Items with known margins are sorted descending. Items with null margins
 * (unknown cost) come last in an "unknown" group.
 */
export function getRestaurantMenuItemMargins(
  menuItems: MenuItem[],
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[]
): MenuItemMargin[] {
  return menuItems
    .map((item) => {
      const costResult = calculateRestaurantMenuItemCost(
        item.id,
        recipes,
        recipeIngredients,
        ingredients,
        invoices,
        invoiceLines
      );
      return calculateRestaurantMenuItemMargin(item, costResult);
    })
    .sort((a, b) => {
      if (a.gross_margin_pct !== null && b.gross_margin_pct !== null) {
        return b.gross_margin_pct - a.gross_margin_pct;
      }
      if (a.gross_margin_pct !== null) return -1; // known sorts before unknown
      if (b.gross_margin_pct !== null) return 1;
      return 0;
    });
}

/**
 * Returns the top N menu items by gross margin %, excluding items with unknown cost.
 */
export function getTopMarginItems(
  menuItems: MenuItem[],
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[],
  topN = 5
): MenuItemMargin[] {
  return getRestaurantMenuItemMargins(
    menuItems,
    recipes,
    recipeIngredients,
    ingredients,
    invoices,
    invoiceLines
  )
    .filter((m) => m.gross_margin_pct !== null)
    .slice(0, topN);
}

/**
 * Returns menu items whose gross margin % is below the threshold.
 * Items with unknown cost are excluded (not assumed to be low-margin).
 * Sorted ascending (worst margin first).
 */
export function getLowMarginItems(
  menuItems: MenuItem[],
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[],
  thresholdPct = 60
): MenuItemMargin[] {
  return getRestaurantMenuItemMargins(
    menuItems,
    recipes,
    recipeIngredients,
    ingredients,
    invoices,
    invoiceLines
  )
    .filter(
      (m) => m.gross_margin_pct !== null && m.gross_margin_pct < thresholdPct
    )
    .sort((a, b) => (a.gross_margin_pct ?? 0) - (b.gross_margin_pct ?? 0));
}

/**
 * Returns items whose cost cannot be fully resolved, for display in a warnings panel.
 */
export function getUnknownCostItems(
  menuItems: MenuItem[],
  recipes: Recipe[],
  recipeIngredients: RecipeIngredient[],
  ingredients: Ingredient[],
  invoices: SupplierInvoice[],
  invoiceLines: SupplierInvoiceLine[]
): MenuItemMargin[] {
  return getRestaurantMenuItemMargins(
    menuItems,
    recipes,
    recipeIngredients,
    ingredients,
    invoices,
    invoiceLines
  ).filter((m) => m.gross_margin_pct === null);
}

/**
 * Returns open recommendations sorted by severity (critical → warning → info),
 * optionally scoped to a location.
 */
export function getOpenRecommendations(
  recommendations: RestaurantRecommendation[],
  locationId?: string
): RestaurantRecommendation[] {
  const severityOrder: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return recommendations
    .filter(
      (r) =>
        r.status === "open" &&
        (locationId === undefined ||
          r.location_id === undefined ||
          r.location_id === locationId)
    )
    .sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
    );
}
