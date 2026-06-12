// lib/restaurant/menu-recipes-server.ts
//
// Server-only helpers for the Menu & Recipes foundation page.
//
// We deliberately aggregate everything the page needs in one round-trip
// so the page component stays as a simple Server Component that hands a
// fully-resolved DTO to the client. RLS does the tenancy work.
//
// IMPORTANT: never call into here from a client component. All reads use
// the SSR Supabase client (cookies-bound) so the user's RLS policies
// apply. No service-role calls anywhere in this milestone.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedComponent } from "@/types/restaurant";
import type {
  IngredientCostEntry,
  ComponentCostResult,
  MenuItemCostResult,
} from "@/types/restaurant-costing";
import {
  type CostingData,
  type CostingRecipeInput,
  calculateAllComponentCosts,
  calculateAllMenuItemCosts,
  getLatestIngredientCost,
} from "@/lib/restaurant/costing";

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

/**
 * A row in the "Unmatched POS items" section of the Menu page. We
 * deliberately surface revenue/units/orders so the user can prioritize
 * which raw names to map first.
 */
export interface UnmatchedPosItem {
  raw_pos_item_name: string;
  units_sold: number;
  revenue: number;
  order_count: number;
}

/**
 * A row in the menu-items list. Mapping count and recipe status are
 * derived (computed in this file rather than stored).
 */
export interface MenuItemListRow {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  status: string | null;
  is_live: boolean | null;
  pos_mapping_count: number;
  recipe_status: "none" | "draft" | "active" | "archived";
  recipe_id: string | null;
  recipe_input_count: number;
  /** Server-computed cost result for this menu item. Always present so
   *  the UI can render either the cost or the explanatory status without
   *  a second null check. */
  cost: MenuItemCostResult;
}

export interface PreparedComponentListRow extends PreparedComponent {
  recipe_input_count: number;
  /** Server-computed component cost result. */
  cost: ComponentCostResult;
}

/** Row in the latest-cost table on the ingredients page. */
export interface IngredientLatestCostRow {
  id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  /** null when no entries exist yet. */
  latest: {
    /** Entry id — so the dashboard can offer a Delete-entry action when
     *  the user wants to retry a cost in a different unit. */
    id: string;
    normalized_unit_cost: number;
    normalized_unit: string;
    cost_date: string;
    currency: string;
    source_type: string;
    supplier_id: string | null;
    supplier_name: string | null;
  } | null;
}

export interface MenuRecipesSummary {
  unmatched_pos_count: number;
  menu_items_without_recipe: number;
  draft_recipes: number;
  active_recipes: number;
  prepared_components_count: number;
  /** Menu items whose cost the engine could fully compute. */
  menu_items_fully_costed: number;
  /** Menu items that have a recipe but the engine returned a non-complete
   *  status (missing input cost, missing unit conversion, etc.). */
  menu_items_with_cost_issues: number;
}

export interface MenuRecipesData {
  /** When non-null, the rest of the page can be rendered. */
  companyId: string | null;
  unmatched: UnmatchedPosItem[];
  menuItems: MenuItemListRow[];
  components: PreparedComponentListRow[];
  summary: MenuRecipesSummary;
  /** Currency used to format prices/revenue in the menu page. */
  currency: string;
}

// ---------------------------------------------------------------------------
// Low-level reads
// ---------------------------------------------------------------------------

interface PosRow {
  raw_item_name: string | null;
  quantity: number | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  order_id: string | null;
  check_id: string | null;
  currency: string | null;
}

interface MappingRow {
  raw_pos_item_name: string;
  menu_item_id: string;
}

interface MenuItemRow {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  currency: string | null;
  status: string | null;
  is_live: boolean | null;
}

interface RecipeRow {
  id: string;
  menu_item_id: string;
  status: string | null;
}

/**
 * Pull everything the Menu page renders in parallel, then aggregate
 * client-side. Tenant-scoped via RLS — we still pass company_id explicitly
 * because the user could in principle belong to multiple companies.
 */
export async function fetchMenuRecipesData(
  supabase: SupabaseClient,
  companyId: string | null
): Promise<MenuRecipesData> {
  if (!companyId) {
    return {
      companyId: null,
      unmatched: [],
      menuItems: [],
      components: [],
      summary: {
        unmatched_pos_count: 0,
        menu_items_without_recipe: 0,
        draft_recipes: 0,
        active_recipes: 0,
        prepared_components_count: 0,
        menu_items_fully_costed: 0,
        menu_items_with_cost_issues: 0,
      },
      currency: "MXN",
    };
  }

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
  ] = await Promise.all([
    supabase
      .from("pos_sales_items")
      .select(
        "raw_item_name, quantity, gross_revenue, net_revenue, order_id, check_id, currency"
      )
      .eq("company_id", companyId)
      .limit(20_000),
    supabase
      .from("pos_item_mappings")
      .select("raw_pos_item_name, menu_item_id")
      .eq("company_id", companyId),
    supabase
      .from("menu_items")
      .select("id, name, category, selling_price, currency, status, is_live")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("recipes")
      .select("id, menu_item_id, status")
      .eq("company_id", companyId),
    // Full input rows — quantities/units are required for cost math.
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
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    // Need full component_recipes for output_quantity/output_unit/status.
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
    // Cost entries — only the normalized projection is used by the
    // engine, but we pull source_type/cost_date/currency so the
    // ingredients page can show provenance.
    supabase
      .from("ingredient_cost_entries")
      .select(
        "id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
      )
      .eq("company_id", companyId),
  ]);

  // Soft-fail on individual table errors. A missing table (migration not
  // run) should degrade to empty, not crash the page.
  if (posRes.error)
    console.error("[menu-recipes] pos_sales_items:", posRes.error.message);
  if (mappingsRes.error)
    console.error(
      "[menu-recipes] pos_item_mappings:",
      mappingsRes.error.message
    );
  if (menuItemsRes.error)
    console.error("[menu-recipes] menu_items:", menuItemsRes.error.message);
  if (recipesRes.error)
    console.error("[menu-recipes] recipes:", recipesRes.error.message);
  if (recipeInputsRes.error)
    console.error(
      "[menu-recipes] menu_recipe_inputs:",
      recipeInputsRes.error.message
    );
  if (componentsRes.error)
    console.error(
      "[menu-recipes] prepared_components:",
      componentsRes.error.message
    );
  if (componentRecipesRes.error)
    console.error(
      "[menu-recipes] component_recipes:",
      componentRecipesRes.error.message
    );
  if (componentRecipeInputsRes.error)
    console.error(
      "[menu-recipes] component_recipe_inputs:",
      componentRecipeInputsRes.error.message
    );
  if (ingredientsRes.error)
    console.error("[menu-recipes] ingredients:", ingredientsRes.error.message);
  if (costEntriesRes.error)
    console.error(
      "[menu-recipes] ingredient_cost_entries:",
      costEntriesRes.error.message
    );

  const posRows: PosRow[] = (posRes.data ?? []) as PosRow[];
  const mappings: MappingRow[] = (mappingsRes.data ?? []) as MappingRow[];
  const menuItems: MenuItemRow[] = (menuItemsRes.data ?? []) as MenuItemRow[];
  const recipes: RecipeRow[] = (recipesRes.data ?? []) as RecipeRow[];
  // Now the FULL input rows — quantity/unit/input_type/ingredient_id/component_id.
  const recipeInputs = (recipeInputsRes.data ?? []) as {
    id: string;
    recipe_id: string;
    input_type: "ingredient" | "component";
    ingredient_id: string | null;
    component_id: string | null;
    quantity: number;
    unit: string;
  }[];
  const components = (componentsRes.data ?? []) as PreparedComponent[];
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

  // ---- Unmatched POS aggregation -----------------------------------------
  const mappedNames = new Set(mappings.map((m) => m.raw_pos_item_name));

  // Bucket by case-insensitive name, preserve first-seen casing.
  type Bucket = {
    raw_pos_item_name: string;
    units: number;
    revenue: number;
    orderIds: Set<string>;
  };
  const unmatchedBuckets = new Map<string, Bucket>();
  let firstSeenCurrency: string | null = null;

  for (const r of posRows) {
    const raw = (r.raw_item_name ?? "").trim();
    if (!raw) continue;
    if (mappedNames.has(raw)) continue;
    if (firstSeenCurrency === null && r.currency)
      firstSeenCurrency = r.currency;
    const key = raw.toLowerCase();
    let b = unmatchedBuckets.get(key);
    if (!b) {
      b = {
        raw_pos_item_name: raw,
        units: 0,
        revenue: 0,
        orderIds: new Set<string>(),
      };
      unmatchedBuckets.set(key, b);
    }
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
    b.units += qty;
    b.revenue += rev;
    const orderKey = r.check_id ?? r.order_id ?? null;
    if (orderKey) b.orderIds.add(orderKey);
  }

  const unmatched: UnmatchedPosItem[] = Array.from(unmatchedBuckets.values())
    .map<UnmatchedPosItem>((b) => ({
      raw_pos_item_name: b.raw_pos_item_name,
      units_sold: b.units,
      revenue: b.revenue,
      order_count: b.orderIds.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ---- Menu items + derived recipe status --------------------------------
  const recipeByMenuId = new Map<string, RecipeRow>();
  for (const r of recipes) recipeByMenuId.set(r.menu_item_id, r);

  const recipeInputCounts = new Map<string, number>();
  const menuInputsByRecipeId = new Map<string, CostingRecipeInput[]>();
  for (const ri of recipeInputs) {
    recipeInputCounts.set(
      ri.recipe_id,
      (recipeInputCounts.get(ri.recipe_id) ?? 0) + 1
    );
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

  const mappingCountsByMenu = new Map<string, number>();
  for (const m of mappings) {
    mappingCountsByMenu.set(
      m.menu_item_id,
      (mappingCountsByMenu.get(m.menu_item_id) ?? 0) + 1
    );
  }

  // ---- Component recipe maps (built first so the costing engine can use them)
  const componentRecipeByComponent = new Map<string, string>();
  for (const cr of componentRecipes)
    componentRecipeByComponent.set(cr.component_id, cr.id);

  const componentInputCounts = new Map<string, number>();
  const componentInputsByRecipeId = new Map<string, CostingRecipeInput[]>();
  for (const ci of componentRecipeInputs) {
    componentInputCounts.set(
      ci.component_recipe_id,
      (componentInputCounts.get(ci.component_recipe_id) ?? 0) + 1
    );
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

  // ---- Assemble CostingData and run the engine ---------------------------
  // The engine is pure over this bundle. We build the lookup maps once
  // and the engine indexes them by id. Cost entries are grouped by
  // ingredient_id so the "latest as-of date" lookup is O(log n) per
  // call (after sorting the per-ingredient slice).
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]));
  const componentsById = new Map(
    components.map((c) => [c.id, { ...c, status: c.status ?? "draft" }])
  );
  // Coerce nullable status to a string default so the engine's narrowed
  // type stays happy. Same trick for menu recipes below.
  const componentRecipesByComponentId = new Map(
    componentRecipes.map((r) => [
      r.component_id,
      { ...r, status: r.status ?? "draft" },
    ])
  );
  const menuItemsById = new Map(
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
    menuItemsById,
    menuRecipesByMenuItemId,
    menuRecipeInputsByRecipeId: menuInputsByRecipeId,
    costEntriesByIngredientId,
  };
  const componentCosts = calculateAllComponentCosts(costingData);
  const menuItemCosts = calculateAllMenuItemCosts(costingData);

  const menuItemsList: MenuItemListRow[] = menuItems.map((mi) => {
    const recipe = recipeByMenuId.get(mi.id);
    const inputs = recipe ? (recipeInputCounts.get(recipe.id) ?? 0) : 0;
    const recipe_status: MenuItemListRow["recipe_status"] = (() => {
      if (!recipe) return "none";
      const s = (recipe.status ?? "draft").toLowerCase();
      if (s === "active" || s === "draft" || s === "archived")
        return s as RecipeStatus;
      return "draft";
    })();
    return {
      id: mi.id,
      name: mi.name,
      category: mi.category,
      selling_price: mi.selling_price ?? null,
      status: mi.status,
      is_live: mi.is_live,
      pos_mapping_count: mappingCountsByMenu.get(mi.id) ?? 0,
      recipe_status,
      recipe_id: recipe?.id ?? null,
      recipe_input_count: inputs,
      cost: menuItemCosts.get(mi.id) ?? {
        menu_item_id: mi.id,
        cost: null,
        selling_price: mi.selling_price ?? null,
        gross_profit: null,
        gross_margin_pct: null,
        food_cost_pct: null,
        status: "missing_recipe",
        issues: [],
      },
    };
  });

  // ---- Prepared components list (uses pre-built maps from above) --------
  const componentList: PreparedComponentListRow[] = components.map((c) => {
    const crid = componentRecipeByComponent.get(c.id);
    return {
      ...c,
      recipe_input_count: crid ? (componentInputCounts.get(crid) ?? 0) : 0,
      cost: componentCosts.get(c.id) ?? {
        component_id: c.id,
        cost_per_output_unit: null,
        batch_cost: null,
        output_quantity: null,
        output_unit: c.output_unit ?? null,
        status: "missing_recipe",
        issues: [],
      },
    };
  });

  // ---- Summary -----------------------------------------------------------
  const menuItemsWithoutRecipe = menuItemsList.filter(
    (m) => m.recipe_status === "none"
  ).length;
  const draftRecipes = menuItemsList.filter(
    (m) => m.recipe_status === "draft"
  ).length;
  const activeRecipes = menuItemsList.filter(
    (m) => m.recipe_status === "active"
  ).length;
  const menuItemsFullyCosted = menuItemsList.filter(
    (m) => m.cost.status === "complete"
  ).length;
  const menuItemsWithCostIssues = menuItemsList.filter(
    (m) => m.cost.status !== "complete" && m.cost.status !== "missing_recipe" // dedupe with "menu items without recipe"
  ).length;

  // Prefer the menu items' currency for display when present (esp. the
  // first one), falling back to whatever appeared in pos rows.
  const currencyHint =
    menuItems.find((m) => m.currency)?.currency ?? firstSeenCurrency ?? "MXN";

  return {
    companyId,
    unmatched,
    menuItems: menuItemsList,
    components: componentList,
    summary: {
      unmatched_pos_count: unmatched.length,
      menu_items_without_recipe: menuItemsWithoutRecipe,
      draft_recipes: draftRecipes,
      active_recipes: activeRecipes,
      prepared_components_count: componentList.length,
      menu_items_fully_costed: menuItemsFullyCosted,
      menu_items_with_cost_issues: menuItemsWithCostIssues,
    },
    currency: currencyHint,
  };
}

/**
 * Companion helper for the ingredients page. Returns each ingredient
 * with its latest cost (if any), computed against `ingredient_cost_entries`.
 * Same engine semantics — no fake zeros, never confuses "no entry"
 * with "free".
 */
export async function fetchIngredientLatestCosts(
  supabase: SupabaseClient,
  companyId: string
): Promise<IngredientLatestCostRow[]> {
  const [ingredientsRes, entriesRes, suppliersRes] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, category, default_unit")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("ingredient_cost_entries")
      .select(
        "id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
      )
      .eq("company_id", companyId),
    supabase.from("suppliers").select("id, name").eq("company_id", companyId),
  ]);
  if (ingredientsRes.error) {
    console.error(
      "[fetchIngredientLatestCosts] ingredients:",
      ingredientsRes.error.message
    );
    return [];
  }
  const entries = (entriesRes.data ?? []) as IngredientCostEntry[];
  const supplierNameById = new Map<string, string>(
    ((suppliersRes.data ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ])
  );
  const byIngredient = new Map<string, IngredientCostEntry[]>();
  for (const e of entries) {
    const list = byIngredient.get(e.ingredient_id) ?? [];
    list.push(e);
    byIngredient.set(e.ingredient_id, list);
  }
  const fakeData: CostingData = {
    ingredientsById: new Map(),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: byIngredient,
  };
  const ingredients = (ingredientsRes.data ?? []) as {
    id: string;
    name: string;
    category: string | null;
    default_unit: string | null;
  }[];
  return ingredients.map((ing) => {
    const latest = getLatestIngredientCost(ing.id, fakeData);
    const list = byIngredient.get(ing.id) ?? [];
    const latestRow =
      latest.cost_date && latest.unit_cost !== null
        ? list
            .filter((e) => e.cost_date === latest.cost_date)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
        : null;
    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      default_unit: ing.default_unit,
      latest: latestRow
        ? {
            id: latestRow.id,
            normalized_unit_cost: latestRow.normalized_unit_cost,
            normalized_unit: latestRow.normalized_unit,
            cost_date: latestRow.cost_date,
            currency: latestRow.currency,
            source_type: latestRow.source_type,
            supplier_id: latestRow.supplier_id ?? null,
            supplier_name: latestRow.supplier_id
              ? (supplierNameById.get(latestRow.supplier_id) ?? null)
              : null,
          }
        : null,
    };
  });
}

// Local re-export to avoid a circular import via supabase-sales.
type RecipeStatus = "draft" | "active" | "archived";
