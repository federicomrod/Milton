// lib/restaurant/ask-milton-context.ts
//
// Structured context builder for the "Ask Milton" chat workspace.
//
// Wraps buildBriefingContext() and layers on:
//   - supplier list (name + active flag), supplier price-increase trends
//   - latest supplier invoices (capped + status)
//   - highest unit-cost ingredients, ingredients missing supplier/category
//   - open agent recommendations grouped (already in briefing) PLUS open
//     agent actions (counts by status, recent titles)
//   - last agent runs (recent)
//   - most_profitable_items / least_profitable_items (complete-costing only)
//   - ingredient_usage map: ingredient → direct menu items + via components
//   - expensive_ingredients: top 10 by unit cost with usage
//
// Hallucination-safety rule (mirrors briefing-context):
//   Every number / name returned here is rounded, capped, and read from
//   the database. Anything unknown is `null` plus a reason field.
//
// Caps: arrays at 5–10 items; money rounded to integers; pct to 1 decimal.
// Never include user emails, auth metadata, or full table dumps.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBriefingContext,
  type BriefingContext,
} from "@/lib/restaurant/briefing-context";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";

// ---------------------------------------------------------------------------
// Extra shapes layered on top of BriefingContext
// ---------------------------------------------------------------------------

export interface AskMiltonSupplier {
  supplier_id: string;
  name: string;
  is_active: boolean;
  categories: string[];
}

export interface AskMiltonInvoiceSummary {
  invoice_id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string;
  status: string;
  total_amount: number | null;
  currency: string;
}

export interface AskMiltonIngredientCost {
  ingredient_id: string;
  name: string;
  category: string | null;
  default_unit: string;
  current_unit_cost: number;
  currency: string;
  supplier_name: string | null;
}

export interface AskMiltonAgentActionSummary {
  action_id: string;
  agent_key: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface AskMiltonAgentRunSummary {
  run_id: string;
  agent_key: string;
  status: string;
  finished_at: string | null;
  findings_count: number;
  summary: string | null;
}

/** Menu item with complete costing — used for most/least profitable. */
export interface AskMiltonProfitableItem {
  menu_item_id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  estimated_cost: number | null;
  gross_margin_pct: number;
  food_cost_pct: number | null;
  gross_profit_per_item: number | null;
}

/** Where an ingredient is used across recipes and components. */
export interface AskMiltonIngredientUsage {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  unit_cost: number | null;
  currency: string;
  /** Menu items that use this ingredient directly in their recipe. */
  used_in_direct: string[];
  /** Names of prepared components that use this ingredient. */
  components_using: string[];
  /** Menu items that use this ingredient via one of those components. */
  used_in_via_component: string[];
}

/** Top-cost ingredient with usage context. */
export interface AskMiltonExpensiveIngredient {
  ingredient_id: string;
  name: string;
  unit: string;
  unit_cost: number;
  currency: string;
  supplier_name: string | null;
  /** Menu item names where this ingredient appears (direct or via component). */
  used_in: string[];
}

export interface AskMiltonContext {
  briefing: BriefingContext;
  menu: {
    /** Top 5 items with complete costing, sorted by gross_margin_pct desc. */
    most_profitable_items: AskMiltonProfitableItem[];
    /** Bottom 5 items with complete costing, sorted by gross_margin_pct asc. */
    least_profitable_items: AskMiltonProfitableItem[];
  };
  ingredient_usage: AskMiltonIngredientUsage[];
  expensive_ingredients: AskMiltonExpensiveIngredient[];
  suppliers: {
    total: number;
    top: AskMiltonSupplier[];
    missing_metadata: AskMiltonSupplier[];
  };
  invoices: {
    total_recent: number;
    posted_count: number;
    needs_review_count: number;
    latest: AskMiltonInvoiceSummary[];
    needs_review: AskMiltonInvoiceSummary[];
  };
  ingredients: {
    total: number;
    highest_unit_cost: AskMiltonIngredientCost[];
    missing_supplier: AskMiltonIngredientCost[];
    missing_category: AskMiltonIngredientCost[];
  };
  agent_actions: {
    counts_by_status: Record<string, number>;
    open: AskMiltonAgentActionSummary[];
    recent: AskMiltonAgentActionSummary[];
  };
  agent_runs: {
    recent: AskMiltonAgentRunSummary[];
  };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function roundInt(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function round1(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildAskMiltonContext(
  supabase: SupabaseClient,
  companyId: string
): Promise<AskMiltonContext> {
  // Run all data fetches in parallel. fetchProfitabilityData fires its own
  // internal Promise.all (12 sub-queries) concurrently with the others here,
  // so the wall-clock cost is approximately max(fetchProfitabilityData, others).
  //
  // Note: buildBriefingContext also calls fetchProfitabilityData internally.
  // The duplicate fetch is an acceptable Stage 1 tradeoff — the data is small
  // and read-only. A future optimization is to share the ProfitabilityData
  // object across both builders.
  const [
    briefing,
    profData,
    suppliersRes,
    invoicesRes,
    ingredientsRes,
    costEntriesRes,
    actionsRes,
    runsRes,
    recipesRes,
    recipeInputsRes,
    componentsRes,
    componentRecipesRes,
    componentRecipeInputsRes,
    menuItemsRes,
  ] = await Promise.all([
    buildBriefingContext(supabase, companyId),
    fetchProfitabilityData(supabase, companyId),
    supabase
      .from("suppliers")
      .select("id, name, is_active, categories")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .limit(200),
    supabase
      .from("supplier_invoices")
      .select(
        "id, supplier_id, invoice_number, invoice_date, status, total_amount, currency"
      )
      .eq("company_id", companyId)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("ingredients")
      .select(
        "id, name, category, default_unit, current_unit_cost, currency, supplier_id"
      )
      .eq("company_id", companyId)
      .limit(500),
    // Authoritative ingredient costs — sorted so the first row per
    // ingredient_id is the latest cost. We group client-side below.
    supabase
      .from("ingredient_cost_entries")
      .select(
        "ingredient_id, normalized_unit_cost, normalized_unit, cost_date, currency, supplier_id, source_type"
      )
      .eq("company_id", companyId)
      .order("ingredient_id")
      .order("cost_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("agent_actions")
      .select("id, agent_key, title, action_type, status, priority, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_runs")
      .select("id, agent_key, status, finished_at, findings_count, summary")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(10),
    // --- ingredient_usage sources ---
    supabase
      .from("recipes")
      .select("id, menu_item_id")
      .eq("company_id", companyId),
    supabase
      .from("menu_recipe_inputs")
      .select("recipe_id, input_type, ingredient_id, component_id")
      .eq("company_id", companyId),
    supabase
      .from("prepared_components")
      .select("id, name")
      .eq("company_id", companyId),
    supabase
      .from("component_recipes")
      .select("id, component_id")
      .eq("company_id", companyId),
    supabase
      .from("component_recipe_inputs")
      .select("component_recipe_id, input_type, ingredient_id, component_id")
      .eq("company_id", companyId),
    // all menu items for usage map (profData only includes POS-mapped items)
    supabase.from("menu_items").select("id, name").eq("company_id", companyId),
  ]);

  const fallbackCurrency = briefing.currency;

  // ---- Suppliers ----
  type SupplierRow = {
    id: string;
    name: string;
    is_active: boolean | null;
    categories: string[] | null;
  };
  const supplierRows = (suppliersRes.data ?? []) as SupplierRow[];
  const supplierById = new Map<string, SupplierRow>();
  for (const s of supplierRows) supplierById.set(s.id, s);
  const supplierTop: AskMiltonSupplier[] = supplierRows
    .slice(0, 10)
    .map((s) => ({
      supplier_id: s.id,
      name: s.name,
      is_active: s.is_active ?? true,
      categories: s.categories ?? [],
    }));
  const supplierMissingMetadata: AskMiltonSupplier[] = supplierRows
    .filter((s) => !s.categories || s.categories.length === 0)
    .slice(0, 10)
    .map((s) => ({
      supplier_id: s.id,
      name: s.name,
      is_active: s.is_active ?? true,
      categories: s.categories ?? [],
    }));

  // ---- Invoices ----
  type InvoiceRow = {
    id: string;
    supplier_id: string | null;
    invoice_number: string | null;
    invoice_date: string;
    status: string;
    total_amount: number | null;
    currency: string | null;
  };
  const invoiceRows = (invoicesRes.data ?? []) as InvoiceRow[];
  const toInvoiceSummary = (r: InvoiceRow): AskMiltonInvoiceSummary => ({
    invoice_id: r.id,
    supplier_name: r.supplier_id
      ? (supplierById.get(r.supplier_id)?.name ?? null)
      : null,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    status: r.status,
    total_amount: roundInt(r.total_amount),
    currency: r.currency ?? fallbackCurrency,
  });
  const invoicesLatest = invoiceRows.slice(0, 8).map(toInvoiceSummary);
  const invoicesNeedsReview = invoiceRows
    .filter((r) => r.status === "needs_review" || r.status === "draft")
    .slice(0, 8)
    .map(toInvoiceSummary);
  const postedCount = invoiceRows.filter((r) => r.status === "posted").length;
  const needsReviewCount = invoiceRows.filter(
    (r) => r.status === "needs_review" || r.status === "draft"
  ).length;

  // ---- Ingredients ----
  type IngredientRow = {
    id: string;
    name: string;
    category: string | null;
    default_unit: string;
    current_unit_cost: number | null;
    currency: string | null;
    supplier_id: string | null;
  };
  const ingredientRows = (ingredientsRes.data ?? []) as IngredientRow[];
  const ingredientById = new Map<string, IngredientRow>();
  for (const r of ingredientRows) ingredientById.set(r.id, r);

  // ---- Latest cost per ingredient from ingredient_cost_entries ----
  // This is the authoritative source used by the costing engine.
  // ingredients.current_unit_cost is a legacy cache that may be 0 when
  // costs were entered via invoices or bulk import — do NOT use it for
  // anything cost-related here.
  type CostEntryRow = {
    ingredient_id: string;
    normalized_unit_cost: number | null;
    normalized_unit: string | null;
    cost_date: string;
    currency: string | null;
    supplier_id: string | null;
    source_type: string | null;
  };
  const costEntryRows = (costEntriesRes.data ?? []) as CostEntryRow[];

  // The query is sorted ingredient_id, cost_date desc, created_at desc —
  // so the first row we see per ingredient_id is the latest cost.
  interface LatestCost {
    normalized_unit_cost: number;
    normalized_unit: string;
    cost_date: string;
    currency: string;
    supplier_id: string | null;
    source_type: string | null;
  }
  const latestCostByIngredientId = new Map<string, LatestCost>();
  for (const entry of costEntryRows) {
    if (latestCostByIngredientId.has(entry.ingredient_id)) continue; // already have latest
    const cost = Number(entry.normalized_unit_cost ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) continue; // skip zero/null costs
    latestCostByIngredientId.set(entry.ingredient_id, {
      normalized_unit_cost: cost,
      normalized_unit: entry.normalized_unit ?? "",
      cost_date: entry.cost_date,
      currency: entry.currency ?? fallbackCurrency,
      supplier_id: entry.supplier_id,
      source_type: entry.source_type,
    });
  }

  // Dev-mode diagnostic: log counts so server logs show what we found.
  if (process.env.NODE_ENV === "development") {
    const sample = [...latestCostByIngredientId.entries()]
      .sort(([, a], [, b]) => b.normalized_unit_cost - a.normalized_unit_cost)
      .slice(0, 3)
      .map(([id, c]) => {
        const name = ingredientById.get(id)?.name ?? id;
        return `${name}: ${c.normalized_unit_cost.toFixed(2)} ${c.normalized_unit}`;
      });
    console.log(
      `[ask-milton-context] ingredients=${ingredientRows.length} ` +
        `cost_entries=${costEntryRows.length} ` +
        `with_latest_cost=${latestCostByIngredientId.size} ` +
        `sample=[${sample.join(", ")}]`
    );
  }

  const toIngredientCost = (r: IngredientRow): AskMiltonIngredientCost => {
    // Prefer authoritative cost from ingredient_cost_entries; fall back to
    // ingredients.current_unit_cost only when no entry exists.
    const latestEntry = latestCostByIngredientId.get(r.id);
    const costValue =
      latestEntry?.normalized_unit_cost ?? r.current_unit_cost ?? 0;
    const costCurrency =
      latestEntry?.currency ?? r.currency ?? fallbackCurrency;
    const supplierFromEntry = latestEntry?.supplier_id
      ? (supplierById.get(latestEntry.supplier_id)?.name ?? null)
      : null;
    return {
      ingredient_id: r.id,
      name: r.name,
      category: r.category,
      default_unit: latestEntry?.normalized_unit ?? r.default_unit,
      current_unit_cost: Math.round(costValue * 100) / 100,
      currency: costCurrency,
      supplier_name:
        supplierFromEntry ??
        (r.supplier_id
          ? (supplierById.get(r.supplier_id)?.name ?? null)
          : null),
    };
  };

  // highestUnitCost: sort by authoritative cost desc.
  // Include any ingredient that has either a cost entry OR a non-zero fallback.
  const highestUnitCost = ingredientRows
    .map((r) => {
      const latestEntry = latestCostByIngredientId.get(r.id);
      return {
        row: r,
        sortCost: latestEntry?.normalized_unit_cost ?? r.current_unit_cost ?? 0,
      };
    })
    .filter(({ sortCost }) => sortCost > 0)
    .sort((a, b) => b.sortCost - a.sortCost)
    .slice(0, 8)
    .map(({ row }) => toIngredientCost(row));

  const missingSupplier = ingredientRows
    .filter((r) => {
      const entrySupplier = latestCostByIngredientId.get(r.id)?.supplier_id;
      return !entrySupplier && !r.supplier_id;
    })
    .slice(0, 8)
    .map(toIngredientCost);
  const missingCategory = ingredientRows
    .filter((r) => !r.category || r.category.trim() === "")
    .slice(0, 8)
    .map(toIngredientCost);

  // ---- Agent actions ----
  type ActionRow = {
    id: string;
    agent_key: string;
    title: string;
    action_type: string;
    status: string;
    priority: string;
    created_at: string;
  };
  const actionRows = (actionsRes.data ?? []) as ActionRow[];
  const countsByStatus: Record<string, number> = {};
  for (const a of actionRows) {
    countsByStatus[a.status] = (countsByStatus[a.status] ?? 0) + 1;
  }
  const toActionSummary = (a: ActionRow): AskMiltonAgentActionSummary => ({
    action_id: a.id,
    agent_key: a.agent_key,
    title: a.title,
    action_type: a.action_type,
    status: a.status,
    priority: a.priority,
    created_at: a.created_at,
  });
  const OPEN_STATUSES = new Set([
    "proposed",
    "approved",
    "in_progress",
    "pending_verification",
  ]);
  const openActions = actionRows
    .filter((a) => OPEN_STATUSES.has(a.status))
    .slice(0, 10)
    .map(toActionSummary);
  const recentActions = actionRows.slice(0, 8).map(toActionSummary);

  // ---- Agent runs ----
  type RunRow = {
    id: string;
    agent_key: string;
    status: string;
    finished_at: string | null;
    findings_count: number | null;
    summary: string | null;
  };
  const runRows = (runsRes.data ?? []) as RunRow[];
  const runsRecent: AskMiltonAgentRunSummary[] = runRows
    .slice(0, 5)
    .map((r) => ({
      run_id: r.id,
      agent_key: r.agent_key,
      status: r.status,
      finished_at: r.finished_at,
      findings_count: r.findings_count ?? 0,
      summary: r.summary,
    }));

  // ---- Most / least profitable items (from profitability engine) ----
  // Only include items where cost is complete (status === 'complete').
  const completeCostRows = profData.marginRows.filter(
    (r) => r.cost.status === "complete" && r.cost.gross_margin_pct !== null
  );
  const toProfitableItem = (
    r: (typeof completeCostRows)[number]
  ): AskMiltonProfitableItem => ({
    menu_item_id: r.menu_item_id,
    name: r.name,
    category: r.category,
    selling_price:
      r.selling_price !== null ? (round1(r.selling_price) ?? null) : null,
    estimated_cost: r.cost.cost !== null ? (round1(r.cost.cost) ?? null) : null,
    gross_margin_pct: round1(r.cost.gross_margin_pct) ?? 0,
    food_cost_pct: round1(r.cost.food_cost_pct),
    gross_profit_per_item:
      r.cost.gross_profit !== null
        ? (round1(r.cost.gross_profit) ?? null)
        : null,
  });

  const mostProfitable = [...completeCostRows]
    .sort(
      (a, b) => (b.cost.gross_margin_pct ?? 0) - (a.cost.gross_margin_pct ?? 0)
    )
    .slice(0, 5)
    .map(toProfitableItem);

  const leastProfitable = [...completeCostRows]
    .sort(
      (a, b) => (a.cost.gross_margin_pct ?? 0) - (b.cost.gross_margin_pct ?? 0)
    )
    .slice(0, 5)
    .map(toProfitableItem);

  // ---- Ingredient usage map ----
  // Build: ingredient_id → { direct menu items, via-component menu items }
  type RecipeRow = { id: string; menu_item_id: string };
  type RecipeInputRow = {
    recipe_id: string;
    input_type: string;
    ingredient_id: string | null;
    component_id: string | null;
  };
  type ComponentRow = { id: string; name: string };
  type CompRecipeRow = { id: string; component_id: string };
  type CompRecipeInputRow = {
    component_recipe_id: string;
    input_type: string;
    ingredient_id: string | null;
    component_id: string | null;
  };
  type MenuItemRow = { id: string; name: string };

  const recipes = (recipesRes.data ?? []) as RecipeRow[];
  const recipeInputs = (recipeInputsRes.data ?? []) as RecipeInputRow[];
  const components = (componentsRes.data ?? []) as ComponentRow[];
  const componentRecipes = (componentRecipesRes.data ?? []) as CompRecipeRow[];
  const componentRecipeInputs = (componentRecipeInputsRes.data ??
    []) as CompRecipeInputRow[];
  const menuItemRows = (menuItemsRes.data ?? []) as MenuItemRow[];

  // Index lookups
  const recipeToMenuItem = new Map<string, string>(); // recipe_id → menu_item_id
  for (const r of recipes) recipeToMenuItem.set(r.id, r.menu_item_id);

  const menuItemNameById = new Map<string, string>(); // menu_item_id → name
  for (const m of menuItemRows) menuItemNameById.set(m.id, m.name);

  const componentNameById = new Map<string, string>(); // component_id → name
  for (const c of components) componentNameById.set(c.id, c.name);

  const compRecipeToComponent = new Map<string, string>(); // component_recipe_id → component_id
  for (const cr of componentRecipes)
    compRecipeToComponent.set(cr.id, cr.component_id);

  // ingredient → direct menu item names
  const ingredientDirectMenuItems = new Map<string, Set<string>>();
  // ingredient → component names
  const ingredientToComponents = new Map<string, Set<string>>();
  // component → menu item names (via recipe_inputs that use this component)
  const componentToMenuItems = new Map<string, Set<string>>();

  for (const ri of recipeInputs) {
    const menuItemId = ri.recipe_id ? recipeToMenuItem.get(ri.recipe_id) : null;
    if (!menuItemId) continue;
    const menuItemName = menuItemNameById.get(menuItemId) ?? menuItemId;

    if (ri.input_type === "ingredient" && ri.ingredient_id) {
      let set = ingredientDirectMenuItems.get(ri.ingredient_id);
      if (!set) {
        set = new Set();
        ingredientDirectMenuItems.set(ri.ingredient_id, set);
      }
      set.add(menuItemName);
    }
    if (ri.input_type === "component" && ri.component_id) {
      let set = componentToMenuItems.get(ri.component_id);
      if (!set) {
        set = new Set();
        componentToMenuItems.set(ri.component_id, set);
      }
      set.add(menuItemName);
    }
  }

  for (const ci of componentRecipeInputs) {
    if (ci.input_type !== "ingredient" || !ci.ingredient_id) continue;
    const componentId = ci.component_recipe_id
      ? compRecipeToComponent.get(ci.component_recipe_id)
      : null;
    if (!componentId) continue;
    const componentName = componentNameById.get(componentId) ?? componentId;

    let compSet = ingredientToComponents.get(ci.ingredient_id);
    if (!compSet) {
      compSet = new Set();
      ingredientToComponents.set(ci.ingredient_id, compSet);
    }
    compSet.add(componentName);
  }

  // Build ingredient_usage for the top 20 expensive/relevant ingredients
  // (those with any usage OR with a cost entry).
  const usageRelevantIds = new Set([
    ...ingredientDirectMenuItems.keys(),
    ...ingredientToComponents.keys(),
    // Always include costly ones even if not yet used in recipes
    ...highestUnitCost.slice(0, 10).map((i) => i.ingredient_id),
    // Also include any ingredient that has a cost entry (catches recently
    // added ingredients that haven't been linked to recipes yet)
    ...latestCostByIngredientId.keys(),
  ]);

  const ingredientUsageList: AskMiltonIngredientUsage[] = [];
  for (const ingredientId of usageRelevantIds) {
    const ing = ingredientById.get(ingredientId);
    if (!ing) continue;

    const directItems = Array.from(
      ingredientDirectMenuItems.get(ingredientId) ?? []
    ).slice(0, 10);
    const compsUsing = Array.from(
      ingredientToComponents.get(ingredientId) ?? []
    ).slice(0, 10);

    // Resolve via-component menu items
    const viaComponentItems = new Set<string>();
    for (const compName of compsUsing) {
      for (const [cId, cName] of componentNameById) {
        if (cName === compName) {
          for (const mi of componentToMenuItems.get(cId) ?? []) {
            viaComponentItems.add(mi);
          }
        }
      }
    }

    // Use authoritative cost from entries; fall back to cached field.
    const latestEntry = latestCostByIngredientId.get(ingredientId);
    const unitCost =
      latestEntry?.normalized_unit_cost ?? ing.current_unit_cost ?? null;
    const unitLabel = latestEntry?.normalized_unit ?? ing.default_unit;
    const currency = latestEntry?.currency ?? ing.currency ?? fallbackCurrency;

    ingredientUsageList.push({
      ingredient_id: ingredientId,
      ingredient_name: ing.name,
      unit: unitLabel,
      unit_cost: unitCost !== null ? Math.round(unitCost * 100) / 100 : null,
      currency,
      used_in_direct: directItems,
      components_using: compsUsing,
      used_in_via_component: Array.from(viaComponentItems).slice(0, 10),
    });
  }

  // Sort by unit_cost desc (most expensive first)
  ingredientUsageList.sort((a, b) => (b.unit_cost ?? 0) - (a.unit_cost ?? 0));
  const ingredientUsageCapped = ingredientUsageList.slice(0, 20);

  // ---- Expensive ingredients with usage ----
  // Source: latestCostByIngredientId (ingredient_cost_entries), NOT
  // ingredients.current_unit_cost which is a legacy fallback field.
  const expensiveIngredients: AskMiltonExpensiveIngredient[] = [
    ...latestCostByIngredientId.entries(),
  ]
    .sort(([, a], [, b]) => b.normalized_unit_cost - a.normalized_unit_cost)
    .slice(0, 10)
    .flatMap(([ingredientId, entry]) => {
      const ing = ingredientById.get(ingredientId);
      if (!ing) return []; // ingredient row missing — skip
      const usageEntry = ingredientUsageCapped.find(
        (u) => u.ingredient_id === ingredientId
      );
      const allUsed = usageEntry
        ? Array.from(
            new Set([
              ...usageEntry.used_in_direct,
              ...usageEntry.used_in_via_component,
            ])
          ).slice(0, 8)
        : [];
      const supplierName =
        (entry.supplier_id
          ? supplierById.get(entry.supplier_id)?.name
          : null) ??
        (ing.supplier_id ? supplierById.get(ing.supplier_id)?.name : null) ??
        null;
      return [
        {
          ingredient_id: ingredientId,
          name: ing.name,
          unit: entry.normalized_unit,
          unit_cost: Math.round(entry.normalized_unit_cost * 100) / 100,
          currency: entry.currency,
          supplier_name: supplierName,
          used_in: allUsed,
        } satisfies AskMiltonExpensiveIngredient,
      ];
    });

  // Log errors for observability but never throw — keep partial context.
  for (const [label, res] of [
    ["suppliers", suppliersRes],
    ["supplier_invoices", invoicesRes],
    ["ingredients", ingredientsRes],
    ["ingredient_cost_entries", costEntriesRes],
    ["agent_actions", actionsRes],
    ["agent_runs", runsRes],
    ["recipes", recipesRes],
    ["menu_recipe_inputs", recipeInputsRes],
    ["prepared_components", componentsRes],
    ["component_recipes", componentRecipesRes],
    ["component_recipe_inputs", componentRecipeInputsRes],
    ["menu_items", menuItemsRes],
  ] as const) {
    if (res.error) {
      console.error(`[ask-milton-context] ${label}:`, res.error.message);
    }
  }

  return {
    briefing,
    menu: {
      most_profitable_items: mostProfitable,
      least_profitable_items: leastProfitable,
    },
    ingredient_usage: ingredientUsageCapped,
    expensive_ingredients: expensiveIngredients,
    suppliers: {
      total: supplierRows.length,
      top: supplierTop,
      missing_metadata: supplierMissingMetadata,
    },
    invoices: {
      total_recent: invoiceRows.length,
      posted_count: postedCount,
      needs_review_count: needsReviewCount,
      latest: invoicesLatest,
      needs_review: invoicesNeedsReview,
    },
    ingredients: {
      total: ingredientRows.length,
      highest_unit_cost: highestUnitCost,
      missing_supplier: missingSupplier,
      missing_category: missingCategory,
    },
    agent_actions: {
      counts_by_status: countsByStatus,
      open: openActions,
      recent: recentActions,
    },
    agent_runs: {
      recent: runsRecent,
    },
  };
}
