// lib/restaurant/briefing-context.ts
//
// Builds the structured context object that the Milton Briefing card and the
// optional OpenAI summarizer consume. Every number in this object comes from
// existing deterministic helpers (fetchProfitabilityData + agent_recommendations).
//
// Hallucination-safety rule:
//   The OpenAI prompt is allowed to write prose, but it must only quote
//   numbers from this object. If a value is unknown, the field is `null`
//   and an accompanying `*_reason` (or the `data_quality` block) explains
//   why so the prose can mention it rather than invent.
//
// This file is server-only — it expects an authenticated Supabase client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface BriefingItemSummary {
  menu_item_id: string;
  name: string;
  /** Currency-agnostic value; UI formats with `currency`. */
  revenue: number;
  units_sold: number;
  /** null if cost is unknown — `cost_status` says why. */
  gross_margin_pct: number | null;
  food_cost_pct: number | null;
  cost_status: string;
}

export interface BriefingMarginRiskItem {
  menu_item_id: string;
  name: string;
  revenue: number;
  gross_margin_pct: number | null;
  food_cost_pct: number | null;
}

export interface BriefingMissingRecipeItem {
  menu_item_id: string;
  name: string;
  revenue: number;
  units_sold: number;
}

export interface BriefingCostingBlocker {
  menu_item_id: string;
  name: string;
  status: string;
  message: string;
}

export interface BriefingPriceTrend {
  ingredient_id: string;
  ingredient_name: string;
  supplier_name: string | null;
  previous_cost: number;
  latest_cost: number;
  pct_change: number;
  unit: string;
  latest_date: string;
}

export interface BriefingSupplierSpend {
  supplier_id: string;
  supplier_name: string;
  total_spend: number;
  share_pct: number;
}

export interface BriefingRecommendationGroup {
  agent_key: string;
  severity: "info" | "warning" | "critical";
  count: number;
  /** Up to 3 representative titles so the model can quote specific issues. */
  examples: string[];
}

export interface BriefingDataQuality {
  unmapped_pos_items: number;
  menu_items_without_recipe: number;
  recipes_with_unit_mismatch: number;
  ingredients_without_cost_entries: number;
  components_without_recipe: number;
  /** Number of POS rows considered when building this context (capped at the
   *  profitability aggregator's 20k limit). */
  pos_rows_reviewed: number;
}

export interface BriefingContext {
  restaurant_name: string;
  period_label: string;
  currency: string;
  kpis: {
    revenue: number;
    /** Null when the POS export lacks a check_id and we can't count orders. */
    orders: number | null;
    orders_reason?: string;
    units_sold: number;
    avg_ticket: number | null;
    avg_ticket_reason?: string;
    cost_coverage_pct: number;
    estimated_cogs: number;
    estimated_gross_profit: number;
    estimated_gross_margin_pct: number | null;
    estimated_gross_margin_pct_reason?: string;
    food_cost_pct: number | null;
    food_cost_pct_reason?: string;
  };
  top_revenue_items: BriefingItemSummary[];
  low_margin_items: BriefingMarginRiskItem[];
  high_food_cost_items: BriefingMarginRiskItem[];
  high_revenue_missing_recipe: BriefingMissingRecipeItem[];
  costing_blockers: BriefingCostingBlocker[];
  supplier_price_increases: BriefingPriceTrend[];
  top_suppliers: BriefingSupplierSpend[];
  open_recommendations: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    by_agent: BriefingRecommendationGroup[];
  };
  data_quality: BriefingDataQuality;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number | null, digits = 1): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const mult = 10 ** digits;
  return Math.round(n * mult) / mult;
}

function roundInt(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildBriefingContext(
  supabase: SupabaseClient,
  companyId: string
): Promise<BriefingContext> {
  // ---- Restaurant name (best-effort) ----
  let restaurantName = "Your restaurant";
  try {
    const { data: brand } = await supabase
      .from("restaurant_brands")
      .select("name")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();
    if (brand?.name) {
      restaurantName = brand.name;
    } else {
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      if (company?.name) restaurantName = company.name;
    }
  } catch (err) {
    console.error("[briefing-context] name lookup:", err);
  }

  // ---- Profitability snapshot (single round-trip aggregator) ----
  const data = await fetchProfitabilityData(supabase, companyId);
  const currency = data.kpis.currency;

  // ---- POS-level orders + avg ticket (counts distinct check_id when present) ----
  // We don't pull all rows again — orders is intentionally null when the POS
  // export was a daily summary (no check_id). The reason field tells the model
  // exactly that so it doesn't make a number up.
  let orders: number | null = null;
  let ordersReason: string | undefined;
  try {
    const { data: checks, error: checksErr } = await supabase
      .from("pos_sales_items")
      .select("check_id")
      .eq("company_id", companyId)
      .not("check_id", "is", null)
      .limit(20_000);
    if (checksErr) {
      ordersReason = "Could not read check_id from pos_sales_items.";
    } else {
      const distinct = new Set<string>();
      for (const row of (checks ?? []) as { check_id: string | null }[]) {
        if (row.check_id) distinct.add(row.check_id);
      }
      if (distinct.size > 0) {
        orders = distinct.size;
      } else {
        ordersReason =
          "POS rows have no check_id (summary export) — orders not counted.";
      }
    }
  } catch (err) {
    console.error("[briefing-context] orders lookup:", err);
    ordersReason = "Unexpected error counting orders.";
  }

  const unitsSold = data.marginRows.reduce((s, r) => s + r.units_sold, 0);
  const avgTicket =
    orders && orders > 0 ? data.kpis.revenue_total / orders : null;
  const avgTicketReason =
    avgTicket === null
      ? "avg_ticket requires order count — see orders_reason."
      : undefined;

  // ---- Top revenue items (top 5, with cost status) ----
  const topRevenueItems: BriefingItemSummary[] = data.marginRows
    .filter((r) => r.revenue > 0)
    .slice(0, 5)
    .map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      revenue: roundInt(r.revenue) ?? 0,
      units_sold: r.units_sold,
      gross_margin_pct: round(r.cost.gross_margin_pct),
      food_cost_pct: round(r.cost.food_cost_pct),
      cost_status: r.cost.status,
    }));

  // ---- Margin risk slices (already capped at 10 by the aggregator) ----
  const lowMargin: BriefingMarginRiskItem[] = data.lowMargin
    .slice(0, 5)
    .map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      revenue: roundInt(r.revenue) ?? 0,
      gross_margin_pct: round(r.cost.gross_margin_pct),
      food_cost_pct: round(r.cost.food_cost_pct),
    }));
  const highFoodCost: BriefingMarginRiskItem[] = data.highFoodCost
    .slice(0, 5)
    .map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      revenue: roundInt(r.revenue) ?? 0,
      gross_margin_pct: round(r.cost.gross_margin_pct),
      food_cost_pct: round(r.cost.food_cost_pct),
    }));
  const missingRecipe: BriefingMissingRecipeItem[] =
    data.missingRecipeHighVolume.slice(0, 5).map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      revenue: roundInt(r.revenue) ?? 0,
      units_sold: r.units_sold,
    }));

  // ---- Costing blockers (unit_mismatch / missing input / missing component) ----
  const costingBlockers: BriefingCostingBlocker[] = data.marginRows
    .filter(
      (r) =>
        r.cost.status === "missing_unit_conversion" ||
        r.cost.status === "missing_input_cost" ||
        r.cost.status === "missing_component_recipe"
    )
    .slice(0, 5)
    .map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      status: r.cost.status,
      message: r.cost.issues[0]?.message ?? r.cost.status,
    }));

  // ---- Supplier price trends (top 5 increases only) ----
  const priceIncreases: BriefingPriceTrend[] = data.ingredientPriceTrends
    .filter((t) => t.pct_change > 0)
    .slice(0, 5)
    .map((t) => ({
      ingredient_id: t.ingredient_id,
      ingredient_name: t.ingredient_name,
      supplier_name: t.latest_supplier_name,
      previous_cost: round(t.previous_cost, 2) ?? 0,
      latest_cost: round(t.latest_cost, 2) ?? 0,
      pct_change: round(t.pct_change, 1) ?? 0,
      unit: t.unit,
      latest_date: t.latest_date,
    }));

  // ---- Top suppliers by spend (top 5) ----
  const topSuppliers: BriefingSupplierSpend[] = data.topSupplierSpend
    .slice(0, 5)
    .map((s) => ({
      supplier_id: s.supplier_id,
      supplier_name: s.supplier_name,
      total_spend: roundInt(s.total_spend) ?? 0,
      share_pct: round(s.pct_of_total, 1) ?? 0,
    }));

  // ---- Open agent recommendations, grouped by (agent_key, severity) ----
  let totalOpen = 0;
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  const byAgent: BriefingRecommendationGroup[] = [];
  try {
    const { data: recs } = await supabase
      .from("agent_recommendations")
      .select("agent_key, severity, title")
      .eq("company_id", companyId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200);
    type Rec = { agent_key: string; severity: string; title: string };
    const groups = new Map<
      string,
      {
        agent_key: string;
        severity: "info" | "warning" | "critical";
        titles: string[];
      }
    >();
    for (const r of (recs ?? []) as Rec[]) {
      const sev = r.severity as "info" | "warning" | "critical";
      totalOpen++;
      if (sev === "critical") criticalCount++;
      else if (sev === "warning") warningCount++;
      else if (sev === "info") infoCount++;
      const key = `${r.agent_key}::${sev}`;
      let g = groups.get(key);
      if (!g) {
        g = { agent_key: r.agent_key, severity: sev, titles: [] };
        groups.set(key, g);
      }
      if (g.titles.length < 3) g.titles.push(r.title);
    }
    for (const g of groups.values()) {
      byAgent.push({
        agent_key: g.agent_key,
        severity: g.severity,
        count: g.titles.length, // visible examples
        examples: g.titles,
      });
    }
    // Sort: critical first, then warning, then info; tie-break by agent_key.
    const sevOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    byAgent.sort(
      (a, b) =>
        sevOrder[a.severity] - sevOrder[b.severity] ||
        a.agent_key.localeCompare(b.agent_key)
    );
  } catch (err) {
    console.error("[briefing-context] recs lookup:", err);
  }

  // ---- Final assembly ----
  const ctx: BriefingContext = {
    restaurant_name: restaurantName,
    period_label: "all available POS data",
    currency,
    kpis: {
      revenue: roundInt(data.kpis.revenue_total) ?? 0,
      orders,
      orders_reason: ordersReason,
      units_sold: unitsSold,
      avg_ticket: avgTicket !== null ? roundInt(avgTicket) : null,
      avg_ticket_reason: avgTicketReason,
      cost_coverage_pct: round(data.kpis.cost_coverage_pct, 1) ?? 0,
      estimated_cogs: roundInt(data.kpis.estimated_cogs) ?? 0,
      estimated_gross_profit: roundInt(data.kpis.estimated_gross_profit) ?? 0,
      estimated_gross_margin_pct: round(
        data.kpis.estimated_gross_margin_pct,
        1
      ),
      estimated_gross_margin_pct_reason:
        data.kpis.estimated_gross_margin_pct === null
          ? "No revenue with complete cost coverage — set up recipes and ingredient costs."
          : undefined,
      food_cost_pct: round(data.kpis.food_cost_pct, 1),
      food_cost_pct_reason:
        data.kpis.food_cost_pct === null
          ? "Food cost % requires revenue with complete cost — see cost_coverage_pct."
          : undefined,
    },
    top_revenue_items: topRevenueItems,
    low_margin_items: lowMargin,
    high_food_cost_items: highFoodCost,
    high_revenue_missing_recipe: missingRecipe,
    costing_blockers: costingBlockers,
    supplier_price_increases: priceIncreases,
    top_suppliers: topSuppliers,
    open_recommendations: {
      total: totalOpen,
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      by_agent: byAgent,
    },
    data_quality: {
      unmapped_pos_items: data.dataQuality.unmapped_pos_items,
      menu_items_without_recipe: data.dataQuality.menu_items_without_recipe,
      recipes_with_unit_mismatch: data.dataQuality.recipes_with_unit_mismatch,
      ingredients_without_cost_entries:
        data.dataQuality.ingredients_without_cost_entries,
      components_without_recipe: data.dataQuality.components_without_recipe,
      pos_rows_reviewed: data.marginRows.length,
    },
  };

  return ctx;
}
