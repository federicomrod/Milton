// lib/restaurant/profitability-server.ts
//
// Server-only aggregator for the Cockpit's profitability sections.
//
// Single round-trip: load every table the cockpit needs in parallel, then
// fan out the math in memory. The costing engine (lib/restaurant/costing.ts)
// is the single source of truth for per-menu-item cost; this file never
// fabricates a cost — when the engine returns null, the dashboard renders
// "—" and surfaces the issue.
//
// Important honesty rule:
//   * COGS / gross profit / gross margin are computed ONLY over revenue from
//     menu items whose cost.status === 'complete'.
//   * `cost_coverage_pct` reports the fraction of revenue included.
//   * Items with incomplete cost are NEVER coerced to 0; they show up in
//     margin-risk tables and the data-quality checklist instead.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CostingData,
  type CostingRecipeInput,
  calculateAllComponentCosts,
  calculateAllMenuItemCosts,
} from "@/lib/restaurant/costing";
import type {
  IngredientCostEntry,
  MenuItemCostResult,
  CostStatus,
} from "@/types/restaurant-costing";

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

export interface MenuMarginRow {
  menu_item_id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  /** Total units sold across all POS rows mapped to this menu item. */
  units_sold: number;
  /** Sum of revenue (gross_revenue, falling back to net_revenue) across POS rows. */
  revenue: number;
  /** Raw POS item names mapped to this menu item; useful for surfacing the
   *  joins in the table. */
  raw_pos_names: string[];
  cost: MenuItemCostResult;
  /** cost.cost × units_sold. null when cost.cost is null. */
  estimated_total_cost: number | null;
  /** revenue − estimated_total_cost. null when estimated_total_cost is null. */
  estimated_gross_profit: number | null;
}

export interface ProfitabilityKpis {
  revenue_total: number;
  /** Revenue from rows that mapped to a menu item with cost.status==='complete' */
  revenue_with_known_cost: number;
  /** cost × units_sold summed across complete-cost items only. */
  estimated_cogs: number;
  /** revenue_with_known_cost − estimated_cogs. */
  estimated_gross_profit: number;
  /** (estimated_gross_profit / revenue_with_known_cost) × 100. */
  estimated_gross_margin_pct: number | null;
  /** (estimated_cogs / revenue_with_known_cost) × 100. */
  food_cost_pct: number | null;
  /** revenue_with_known_cost / revenue_total × 100. */
  cost_coverage_pct: number;
  /** Total menu items that have a non-complete cost status (excludes
   *  missing_recipe — surfaced separately under "menu items without recipe"). */
  menu_items_with_issues: number;
  /** Menu items that have NO recipe (missing_recipe). */
  menu_items_without_recipe: number;
  /** Currency code (for formatting). */
  currency: string;
}

export interface IngredientPriceTrendRow {
  ingredient_id: string;
  ingredient_name: string;
  latest_supplier_name: string | null;
  previous_cost: number;
  latest_cost: number;
  pct_change: number;
  latest_date: string;
  previous_date: string;
  unit: string;
  currency: string;
}

export interface SupplierSpendRow {
  supplier_id: string;
  supplier_name: string;
  total_spend: number;
  /** Distinct ingredients linked via cost entries. */
  ingredient_count: number;
  pct_of_total: number;
}

export interface DataQualityCounts {
  unmapped_pos_items: number;
  menu_items_without_recipe: number;
  recipes_with_unit_mismatch: number;
  ingredients_without_cost_entries: number;
  components_without_recipe: number;
  supplier_linked_ingredients: number;
}

export interface ProfitabilityData {
  kpis: ProfitabilityKpis;
  marginRows: MenuMarginRow[];
  lowMargin: MenuMarginRow[];
  highFoodCost: MenuMarginRow[];
  highRevenueIncomplete: MenuMarginRow[];
  missingRecipeHighVolume: MenuMarginRow[];
  ingredientPriceTrends: IngredientPriceTrendRow[];
  topSupplierSpend: SupplierSpendRow[];
  dataQuality: DataQualityCounts;
  /** Total spend across all cost entries — used by the supplier-spend chart. */
  total_supplier_spend: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LOW_MARGIN_THRESHOLD_PCT = 60;
const HIGH_FOOD_COST_THRESHOLD_PCT = 35;
const PRICE_INCREASE_MIN_PCT = 0; // surface any increase; UI can highlight large ones

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Loads every table the cockpit profitability section needs, runs the
 * costing engine, and aggregates per-menu-item revenue from POS sales.
 */
export async function fetchProfitabilityData(
  supabase: SupabaseClient,
  companyId: string
): Promise<ProfitabilityData> {
  const [
    posRes,
    mappingsRes,
    menuItemsRes,
    recipesRes,
    recipeInputsRes,
    componentsRes,
    componentRecipesRes,
    componentRecipeInputsRes,
    ingredientsRes,
    costEntriesRes,
    suppliersRes,
    supplierIngredientsRes,
  ] = await Promise.all([
    supabase
      .from("pos_sales_items")
      .select("raw_item_name, quantity, gross_revenue, net_revenue, currency")
      .eq("company_id", companyId)
      .limit(20_000),
    supabase
      .from("pos_item_mappings")
      .select("raw_pos_item_name, menu_item_id")
      .eq("company_id", companyId),
    supabase
      .from("menu_items")
      .select("id, name, category, selling_price, currency")
      .eq("company_id", companyId),
    supabase
      .from("recipes")
      .select("id, menu_item_id, status")
      .eq("company_id", companyId),
    supabase
      .from("menu_recipe_inputs")
      .select(
        "id, recipe_id, input_type, ingredient_id, component_id, quantity, unit"
      )
      .eq("company_id", companyId),
    supabase
      .from("prepared_components")
      .select(
        "id, company_id, name, category, output_unit, status, notes, created_at, updated_at"
      )
      .eq("company_id", companyId),
    supabase
      .from("component_recipes")
      .select("id, component_id, output_quantity, output_unit, status")
      .eq("company_id", companyId),
    supabase
      .from("component_recipe_inputs")
      .select(
        "id, component_recipe_id, input_type, ingredient_id, component_id, quantity, unit"
      )
      .eq("company_id", companyId),
    supabase
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", companyId),
    supabase
      .from("ingredient_cost_entries")
      .select(
        "id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
      )
      .eq("company_id", companyId),
    supabase.from("suppliers").select("id, name").eq("company_id", companyId),
    supabase
      .from("supplier_ingredients")
      .select("supplier_id, ingredient_id")
      .eq("company_id", companyId),
  ]);

  // Soft-fail per table.
  const errLog = (name: string, e: { message?: string } | null) =>
    e?.message && console.error(`[profitability] ${name}:`, e.message);
  errLog("pos_sales_items", posRes.error);
  errLog("pos_item_mappings", mappingsRes.error);
  errLog("menu_items", menuItemsRes.error);
  errLog("recipes", recipesRes.error);
  errLog("menu_recipe_inputs", recipeInputsRes.error);
  errLog("prepared_components", componentsRes.error);
  errLog("component_recipes", componentRecipesRes.error);
  errLog("component_recipe_inputs", componentRecipeInputsRes.error);
  errLog("ingredients", ingredientsRes.error);
  errLog("ingredient_cost_entries", costEntriesRes.error);
  errLog("suppliers", suppliersRes.error);
  errLog("supplier_ingredients", supplierIngredientsRes.error);

  // ----- Costing engine setup -----
  const menuItems = (menuItemsRes.data ?? []) as {
    id: string;
    name: string;
    category: string | null;
    selling_price: number | null;
    currency: string | null;
  }[];
  const recipes = (recipesRes.data ?? []) as {
    id: string;
    menu_item_id: string;
    status: string | null;
  }[];
  const recipeInputs = (recipeInputsRes.data ?? []) as {
    id: string;
    recipe_id: string;
    input_type: "ingredient" | "component";
    ingredient_id: string | null;
    component_id: string | null;
    quantity: number;
    unit: string;
  }[];
  const components = (componentsRes.data ?? []) as {
    id: string;
    name: string;
    status: string | null;
    output_unit: string | null;
  }[];
  const componentRecipes = (componentRecipesRes.data ?? []) as {
    id: string;
    component_id: string;
    output_quantity: number;
    output_unit: string;
    status: string | null;
  }[];
  const componentRecipeInputs = (componentRecipeInputsRes.data ?? []) as {
    id: string;
    component_recipe_id: string;
    input_type: "ingredient" | "component";
    ingredient_id: string | null;
    component_id: string | null;
    quantity: number;
    unit: string;
  }[];
  const ingredients = (ingredientsRes.data ?? []) as {
    id: string;
    name: string;
    default_unit: string | null;
  }[];
  const costEntries = (costEntriesRes.data ?? []) as IngredientCostEntry[];
  const suppliers = (suppliersRes.data ?? []) as { id: string; name: string }[];
  const supplierLinks = (supplierIngredientsRes.data ?? []) as {
    supplier_id: string;
    ingredient_id: string;
  }[];

  // Index for the engine.
  const menuInputsByRecipeId = new Map<string, CostingRecipeInput[]>();
  for (const ri of recipeInputs) {
    const list = menuInputsByRecipeId.get(ri.recipe_id) ?? [];
    list.push({
      input_type: ri.input_type,
      ingredient_id: ri.ingredient_id,
      component_id: ri.component_id,
      quantity: ri.quantity,
      unit: ri.unit,
    });
    menuInputsByRecipeId.set(ri.recipe_id, list);
  }
  const componentInputsByRecipeId = new Map<string, CostingRecipeInput[]>();
  for (const ci of componentRecipeInputs) {
    const list = componentInputsByRecipeId.get(ci.component_recipe_id) ?? [];
    list.push({
      input_type: ci.input_type,
      ingredient_id: ci.ingredient_id,
      component_id: ci.component_id,
      quantity: ci.quantity,
      unit: ci.unit,
    });
    componentInputsByRecipeId.set(ci.component_recipe_id, list);
  }
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]));
  const componentsById = new Map(
    components.map((c) => [
      c.id,
      { ...c, status: c.status ?? "draft", output_unit: c.output_unit ?? "" },
    ])
  );
  const componentRecipesByComponentId = new Map(
    componentRecipes.map((r) => [
      r.component_id,
      { ...r, status: r.status ?? "draft" },
    ])
  );
  const menuItemsByIdForEngine = new Map(
    menuItems.map((m) => [
      m.id,
      {
        id: m.id,
        name: m.name,
        selling_price: m.selling_price,
        currency: m.currency,
      },
    ])
  );
  const menuRecipesByMenuItemId = new Map(
    recipes.map((r) => [r.menu_item_id, { ...r, status: r.status ?? "draft" }])
  );
  const costEntriesByIngredientId = new Map<string, IngredientCostEntry[]>();
  for (const e of costEntries) {
    const list = costEntriesByIngredientId.get(e.ingredient_id) ?? [];
    list.push(e);
    costEntriesByIngredientId.set(e.ingredient_id, list);
  }
  const costingData: CostingData = {
    ingredientsById,
    componentsById,
    componentRecipesByComponentId,
    componentRecipeInputsByRecipeId: componentInputsByRecipeId,
    menuItemsById: menuItemsByIdForEngine,
    menuRecipesByMenuItemId,
    menuRecipeInputsByRecipeId: menuInputsByRecipeId,
    costEntriesByIngredientId,
  };
  calculateAllComponentCosts(costingData);
  const menuItemCosts = calculateAllMenuItemCosts(costingData);

  // ----- POS revenue aggregation per menu item -----
  // mappings are exact-match on trimmed raw_item_name (same as menu page).
  const mappings = (mappingsRes.data ?? []) as {
    raw_pos_item_name: string;
    menu_item_id: string;
  }[];
  const menuItemIdByRawName = new Map<string, string>();
  for (const m of mappings)
    menuItemIdByRawName.set(m.raw_pos_item_name, m.menu_item_id);
  const mappedNames = new Set(mappings.map((m) => m.raw_pos_item_name));

  type PosAggregate = {
    units_sold: number;
    revenue: number;
    raw_names: Set<string>;
  };
  const posByMenuItem = new Map<string, PosAggregate>();
  const unmappedRawNames = new Set<string>();
  let revenueTotal = 0;
  let firstCurrency: string | null = null;

  const posRows = (posRes.data ?? []) as {
    raw_item_name: string | null;
    quantity: number | null;
    gross_revenue: number | null;
    net_revenue: number | null;
    currency: string | null;
  }[];
  for (const r of posRows) {
    const raw = (r.raw_item_name ?? "").trim();
    if (!raw) continue;
    const qty =
      typeof r.quantity === "number" && Number.isFinite(r.quantity)
        ? r.quantity
        : 0;
    const rev =
      typeof r.gross_revenue === "number" && Number.isFinite(r.gross_revenue)
        ? r.gross_revenue
        : typeof r.net_revenue === "number" && Number.isFinite(r.net_revenue)
          ? r.net_revenue
          : 0;
    revenueTotal += rev;
    if (firstCurrency === null && r.currency) firstCurrency = r.currency;

    const menuItemId = menuItemIdByRawName.get(raw);
    if (!menuItemId) {
      if (!mappedNames.has(raw)) unmappedRawNames.add(raw.toLowerCase());
      continue;
    }
    let agg = posByMenuItem.get(menuItemId);
    if (!agg) {
      agg = { units_sold: 0, revenue: 0, raw_names: new Set<string>() };
      posByMenuItem.set(menuItemId, agg);
    }
    agg.units_sold += qty;
    agg.revenue += rev;
    agg.raw_names.add(raw);
  }

  // ----- Build per-menu-item margin rows -----
  const marginRows: MenuMarginRow[] = menuItems.map((mi) => {
    const cost = menuItemCosts.get(mi.id) ?? {
      menu_item_id: mi.id,
      cost: null,
      selling_price: mi.selling_price ?? null,
      gross_profit: null,
      gross_margin_pct: null,
      food_cost_pct: null,
      status: "missing_recipe" as CostStatus,
      issues: [],
    };
    const pos = posByMenuItem.get(mi.id);
    const units_sold = pos?.units_sold ?? 0;
    const revenue = pos?.revenue ?? 0;
    const raw_pos_names = pos ? Array.from(pos.raw_names).sort() : [];
    const estimated_total_cost =
      cost.cost !== null && Number.isFinite(cost.cost)
        ? cost.cost * units_sold
        : null;
    const estimated_gross_profit =
      estimated_total_cost !== null ? revenue - estimated_total_cost : null;
    return {
      menu_item_id: mi.id,
      name: mi.name,
      category: mi.category,
      selling_price: mi.selling_price,
      units_sold,
      revenue,
      raw_pos_names,
      cost,
      estimated_total_cost,
      estimated_gross_profit,
    };
  });
  marginRows.sort((a, b) => b.revenue - a.revenue);

  // ----- KPIs -----
  let revenueWithKnownCost = 0;
  let estimatedCogs = 0;
  for (const r of marginRows) {
    if (r.cost.status === "complete" && r.estimated_total_cost !== null) {
      revenueWithKnownCost += r.revenue;
      estimatedCogs += r.estimated_total_cost;
    }
  }
  const estimatedGrossProfit = revenueWithKnownCost - estimatedCogs;
  const estimatedGrossMarginPct =
    revenueWithKnownCost > 0
      ? (estimatedGrossProfit / revenueWithKnownCost) * 100
      : null;
  const foodCostPct =
    revenueWithKnownCost > 0
      ? (estimatedCogs / revenueWithKnownCost) * 100
      : null;
  const costCoveragePct =
    revenueTotal > 0 ? (revenueWithKnownCost / revenueTotal) * 100 : 0;

  const menuItemsWithoutRecipe = marginRows.filter(
    (m) => m.cost.status === "missing_recipe"
  ).length;
  const menuItemsWithIssues = marginRows.filter(
    (m) => m.cost.status !== "complete" && m.cost.status !== "missing_recipe"
  ).length;

  const currency =
    menuItems.find((m) => m.currency)?.currency ?? firstCurrency ?? "MXN";

  const kpis: ProfitabilityKpis = {
    revenue_total: revenueTotal,
    revenue_with_known_cost: revenueWithKnownCost,
    estimated_cogs: estimatedCogs,
    estimated_gross_profit: estimatedGrossProfit,
    estimated_gross_margin_pct: estimatedGrossMarginPct,
    food_cost_pct: foodCostPct,
    cost_coverage_pct: costCoveragePct,
    menu_items_with_issues: menuItemsWithIssues,
    menu_items_without_recipe: menuItemsWithoutRecipe,
    currency,
  };

  // ----- Margin risk slices -----
  const lowMargin = marginRows
    .filter(
      (r) =>
        r.cost.status === "complete" &&
        r.cost.gross_margin_pct !== null &&
        r.cost.gross_margin_pct < LOW_MARGIN_THRESHOLD_PCT
    )
    .sort(
      (a, b) => (a.cost.gross_margin_pct ?? 0) - (b.cost.gross_margin_pct ?? 0)
    )
    .slice(0, 10);

  const highFoodCost = marginRows
    .filter(
      (r) =>
        r.cost.status === "complete" &&
        r.cost.food_cost_pct !== null &&
        r.cost.food_cost_pct > HIGH_FOOD_COST_THRESHOLD_PCT
    )
    .sort((a, b) => (b.cost.food_cost_pct ?? 0) - (a.cost.food_cost_pct ?? 0))
    .slice(0, 10);

  const highRevenueIncomplete = marginRows
    .filter((r) => r.revenue > 0 && r.cost.status !== "complete")
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const missingRecipeHighVolume = marginRows
    .filter((r) => r.cost.status === "missing_recipe" && r.units_sold > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ----- Supplier price trends -----
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const ingredientNameById = new Map(ingredients.map((i) => [i.id, i.name]));

  const ingredientPriceTrends: IngredientPriceTrendRow[] = [];
  for (const [ingredientId, entries] of costEntriesByIngredientId) {
    if (entries.length < 2) continue;
    // Sort by cost_date desc, then created_at desc, so [0] = latest.
    const sorted = [...entries].sort((a, b) => {
      if (a.cost_date !== b.cost_date)
        return a.cost_date > b.cost_date ? -1 : 1;
      return a.created_at > b.created_at ? -1 : 1;
    });
    const latest = sorted[0];
    // Previous: first entry with a different cost_date AND a compatible
    // normalized_unit (so the % change is meaningful).
    const previous = sorted
      .slice(1)
      .find((e) => e.normalized_unit === latest.normalized_unit);
    if (!previous) continue;
    if (latest.normalized_unit_cost <= 0 || previous.normalized_unit_cost <= 0)
      continue;
    const pctChange =
      ((latest.normalized_unit_cost - previous.normalized_unit_cost) /
        previous.normalized_unit_cost) *
      100;
    if (Math.abs(pctChange) < PRICE_INCREASE_MIN_PCT) continue;
    ingredientPriceTrends.push({
      ingredient_id: ingredientId,
      ingredient_name: ingredientNameById.get(ingredientId) ?? "(unknown)",
      latest_supplier_name: latest.supplier_id
        ? (supplierNameById.get(latest.supplier_id) ?? null)
        : null,
      previous_cost: previous.normalized_unit_cost,
      latest_cost: latest.normalized_unit_cost,
      pct_change: pctChange,
      latest_date: latest.cost_date,
      previous_date: previous.cost_date,
      unit: latest.normalized_unit,
      currency: latest.currency,
    });
  }
  ingredientPriceTrends.sort((a, b) => b.pct_change - a.pct_change);
  const topPriceTrends = ingredientPriceTrends.slice(0, 12);

  // ----- Top supplier spend -----
  // Group all cost entries by supplier_id; sum total_cost; count distinct
  // ingredients per supplier.
  const spendBySupplier = new Map<
    string,
    { spend: number; ingredients: Set<string> }
  >();
  let totalSupplierSpend = 0;
  for (const e of costEntries) {
    if (!e.supplier_id) continue;
    totalSupplierSpend += e.total_cost ?? 0;
    let agg = spendBySupplier.get(e.supplier_id);
    if (!agg) {
      agg = { spend: 0, ingredients: new Set<string>() };
      spendBySupplier.set(e.supplier_id, agg);
    }
    agg.spend += e.total_cost ?? 0;
    agg.ingredients.add(e.ingredient_id);
  }
  const topSupplierSpend: SupplierSpendRow[] = Array.from(
    spendBySupplier.entries()
  )
    .map(([supplierId, agg]) => ({
      supplier_id: supplierId,
      supplier_name: supplierNameById.get(supplierId) ?? "(unknown)",
      total_spend: agg.spend,
      ingredient_count: agg.ingredients.size,
      pct_of_total:
        totalSupplierSpend > 0 ? (agg.spend / totalSupplierSpend) * 100 : 0,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, 12);

  // ----- Data quality checklist -----
  const ingredientsWithEntries = new Set(
    costEntries.map((e) => e.ingredient_id)
  );
  const componentsWithRecipe = new Set(
    componentRecipes.map((cr) => cr.component_id)
  );
  const recipesWithUnitMismatch = marginRows.filter(
    (m) => m.cost.status === "missing_unit_conversion"
  ).length;
  const supplierLinkedIngredients = new Set(
    supplierLinks.map((l) => l.ingredient_id)
  ).size;

  const dataQuality: DataQualityCounts = {
    unmapped_pos_items: unmappedRawNames.size,
    menu_items_without_recipe: menuItemsWithoutRecipe,
    recipes_with_unit_mismatch: recipesWithUnitMismatch,
    ingredients_without_cost_entries: ingredients.filter(
      (i) => !ingredientsWithEntries.has(i.id)
    ).length,
    components_without_recipe: components.filter(
      (c) => !componentsWithRecipe.has(c.id)
    ).length,
    supplier_linked_ingredients: supplierLinkedIngredients,
  };

  return {
    kpis,
    marginRows,
    lowMargin,
    highFoodCost,
    highRevenueIncomplete,
    missingRecipeHighVolume,
    ingredientPriceTrends: topPriceTrends,
    topSupplierSpend,
    dataQuality,
    total_supplier_spend: totalSupplierSpend,
  };
}
