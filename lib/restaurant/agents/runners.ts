// lib/restaurant/agents/runners.ts
//
// Deterministic runners for Milton's restaurant agents. Each runner returns
// a list of `RunnerFinding`s — structured recommendations that the dispatch
// route persists into agent_recommendations.
//
// No OpenAI, no background scheduling, no autonomous actions. These runners
// just read existing restaurant data and surface auditable issues using the
// thresholds the user configured in agent_configs.config.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";
import type {
  AgentKey,
  AgentRecommendationType,
  AgentSeverity,
} from "@/types/agents";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunnerFinding {
  agent_key: AgentKey;
  title: string;
  description: string;
  severity: AgentSeverity;
  recommendation_type: AgentRecommendationType;
  related_entity_type: string | null;
  related_entity_id: string | null;
  suggested_action: string | null;
  impact_json: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface RunnerResult {
  findings: RunnerFinding[];
  /** Free-form metadata persisted onto agent_runs.metadata for debuggability. */
  metadata: Record<string, unknown>;
  /** Human-readable run summary; ends up in agent_runs.summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNumber(
  cfg: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number
): number {
  if (!cfg) return fallback;
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// recipe_margin_agent
// ---------------------------------------------------------------------------

export async function runRecipeMarginAgent(
  supabase: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>
): Promise<RunnerResult> {
  const lowMarginThreshold = readNumber(config, "low_margin_threshold_pct", 60);
  const highFoodCostThreshold = readNumber(
    config,
    "high_food_cost_threshold_pct",
    35
  );
  const missingRecipeRevenueThreshold = readNumber(
    config,
    "high_revenue_missing_recipe_threshold",
    5000
  );

  const data = await fetchProfitabilityData(supabase, companyId);
  const currency = data.kpis.currency;
  const findings: RunnerFinding[] = [];

  // A. Missing recipe with meaningful revenue.
  for (const row of data.marginRows) {
    if (row.cost.status !== "missing_recipe") continue;
    if (row.revenue < missingRecipeRevenueThreshold) continue;
    const severity: AgentSeverity =
      row.revenue >= missingRecipeRevenueThreshold * 3 ? "critical" : "warning";
    findings.push({
      agent_key: "recipe_margin_agent",
      title: `${row.name} has revenue but no recipe`,
      description: `${row.name} brought in ${fmtCurrency(
        row.revenue,
        currency
      )} across ${row.units_sold} units sold but has no recipe, so Milton can't calculate true margin.`,
      severity,
      recommendation_type: "missing_recipe",
      related_entity_type: "menu_item",
      related_entity_id: row.menu_item_id,
      suggested_action:
        "Create a recipe so Milton can calculate cost, margin and food cost.",
      impact_json: {
        revenue: row.revenue,
        units_sold: row.units_sold,
        currency,
      },
      metadata: { raw_pos_names: row.raw_pos_names },
    });
  }

  // B. Low margin items (complete cost only).
  for (const row of data.marginRows) {
    if (row.cost.status !== "complete") continue;
    const margin = row.cost.gross_margin_pct;
    if (margin === null || margin >= lowMarginThreshold) continue;
    const severity: AgentSeverity =
      margin < lowMarginThreshold / 2 ? "critical" : "warning";
    findings.push({
      agent_key: "recipe_margin_agent",
      title: `${row.name} has low gross margin (${margin.toFixed(1)}%)`,
      description: `${row.name} sells for ${fmtCurrency(
        row.cost.selling_price ?? 0,
        currency
      )} and costs ${fmtCurrency(
        row.cost.cost ?? 0,
        currency
      )} per serving — gross margin ${margin.toFixed(
        1
      )}% is below the ${lowMarginThreshold}% threshold.`,
      severity,
      recommendation_type: "low_margin",
      related_entity_type: "menu_item",
      related_entity_id: row.menu_item_id,
      suggested_action:
        "Review pricing, recipe portions or ingredient costs to recover margin.",
      impact_json: {
        revenue: row.revenue,
        selling_price: row.cost.selling_price,
        cost: row.cost.cost,
        gross_margin_pct: margin,
        food_cost_pct: row.cost.food_cost_pct,
        currency,
      },
      metadata: {},
    });
  }

  // C. High food cost items.
  for (const row of data.marginRows) {
    if (row.cost.status !== "complete") continue;
    const fc = row.cost.food_cost_pct;
    if (fc === null || fc <= highFoodCostThreshold) continue;
    const severity: AgentSeverity =
      fc > highFoodCostThreshold * 1.5 ? "critical" : "warning";
    findings.push({
      agent_key: "recipe_margin_agent",
      title: `${row.name} has high food cost (${fc.toFixed(1)}%)`,
      description: `${row.name} runs a food cost of ${fc.toFixed(
        1
      )}% — above the ${highFoodCostThreshold}% threshold.`,
      severity,
      recommendation_type: "high_food_cost",
      related_entity_type: "menu_item",
      related_entity_id: row.menu_item_id,
      suggested_action:
        "Look at the most expensive recipe inputs and consider portion or supplier changes.",
      impact_json: {
        selling_price: row.cost.selling_price,
        cost: row.cost.cost,
        food_cost_pct: fc,
        gross_margin_pct: row.cost.gross_margin_pct,
        currency,
      },
      metadata: {},
    });
  }

  // D. Costing blockers (unit mismatch / missing input / missing component).
  const BLOCKER_TYPES: Record<
    string,
    { type: AgentRecommendationType; label: string }
  > = {
    missing_unit_conversion: {
      type: "unit_mismatch",
      label: "unit mismatch in recipe",
    },
    missing_input_cost: {
      type: "missing_input_cost",
      label: "missing ingredient cost",
    },
    missing_component_recipe: {
      type: "missing_component_recipe",
      label: "missing sub-component recipe",
    },
  };
  for (const row of data.marginRows) {
    const blocker =
      BLOCKER_TYPES[row.cost.status as keyof typeof BLOCKER_TYPES];
    if (!blocker) continue;
    const issuePaths = row.cost.issues
      .map((i) => i.path.join(" → "))
      .filter((p) => p.length > 0);
    findings.push({
      agent_key: "recipe_margin_agent",
      title: `${row.name} can't be costed — ${blocker.label}`,
      description: `Milton couldn't compute a complete cost for ${row.name}. Reason: ${
        row.cost.issues[0]?.message ?? blocker.label
      }.`,
      severity: "warning",
      recommendation_type: blocker.type,
      related_entity_type: "menu_item",
      related_entity_id: row.menu_item_id,
      suggested_action:
        "Open the recipe and fix the missing input, unit, or sub-component noted here.",
      impact_json: {
        revenue: row.revenue,
        status: row.cost.status,
        issue_paths: issuePaths,
      },
      metadata: {},
    });
  }

  const summary =
    `Recipe & Margin Agent reviewed ${data.marginRows.length} menu items: ` +
    `${findings.filter((f) => f.recommendation_type === "missing_recipe").length} missing recipes, ` +
    `${findings.filter((f) => f.recommendation_type === "low_margin").length} low margin, ` +
    `${findings.filter((f) => f.recommendation_type === "high_food_cost").length} high food cost, ` +
    `${
      findings.filter((f) =>
        [
          "unit_mismatch",
          "missing_input_cost",
          "missing_component_recipe",
        ].includes(f.recommendation_type)
      ).length
    } costing blockers.`;

  return {
    findings,
    metadata: {
      menu_items_reviewed: data.marginRows.length,
      currency,
      thresholds: {
        low_margin_threshold_pct: lowMarginThreshold,
        high_food_cost_threshold_pct: highFoodCostThreshold,
        high_revenue_missing_recipe_threshold: missingRecipeRevenueThreshold,
      },
      scope: "all company data (no date filter)",
    },
    summary,
  };
}

// ---------------------------------------------------------------------------
// supplier_agent
// ---------------------------------------------------------------------------

export async function runSupplierAgent(
  supabase: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>
): Promise<RunnerResult> {
  const priceIncreaseThreshold = readNumber(
    config,
    "price_increase_threshold_pct",
    10
  );
  const concentrationThreshold = readNumber(
    config,
    "supplier_concentration_threshold_pct",
    40
  );

  const findings: RunnerFinding[] = [];
  const data = await fetchProfitabilityData(supabase, companyId);
  const currency = data.kpis.currency;

  // A. Ingredient price increases — reuse the trends computed by the
  //    profitability aggregator (sorted descending by pct_change).
  for (const trend of data.ingredientPriceTrends) {
    if (trend.pct_change < priceIncreaseThreshold) continue;
    const severity: AgentSeverity =
      trend.pct_change >= priceIncreaseThreshold * 3 ? "critical" : "warning";
    findings.push({
      agent_key: "supplier_agent",
      title: `${trend.ingredient_name} price up ${trend.pct_change.toFixed(1)}%`,
      description: `${trend.ingredient_name} went from ${fmtCurrency(
        trend.previous_cost,
        trend.currency
      )} on ${trend.previous_date} to ${fmtCurrency(
        trend.latest_cost,
        trend.currency
      )} on ${trend.latest_date} per ${trend.unit}${
        trend.latest_supplier_name
          ? ` (supplier: ${trend.latest_supplier_name})`
          : ""
      }.`,
      severity,
      recommendation_type: "price_increase",
      related_entity_type: "ingredient",
      related_entity_id: trend.ingredient_id,
      suggested_action:
        "Verify the new price with the supplier, consider alternatives, or pass the cost through.",
      impact_json: {
        previous_cost: trend.previous_cost,
        latest_cost: trend.latest_cost,
        pct_change: trend.pct_change,
        supplier_name: trend.latest_supplier_name,
        previous_date: trend.previous_date,
        latest_date: trend.latest_date,
        unit: trend.unit,
        currency: trend.currency,
      },
      metadata: {},
    });
  }

  // B. Supplier concentration.
  for (const sup of data.topSupplierSpend) {
    if (sup.pct_of_total < concentrationThreshold) continue;
    findings.push({
      agent_key: "supplier_agent",
      title: `${sup.supplier_name} is ${sup.pct_of_total.toFixed(0)}% of supplier spend`,
      description: `${sup.supplier_name} accounts for ${fmtCurrency(
        sup.total_spend,
        currency
      )} of total supplier spend (${fmtCurrency(
        data.total_supplier_spend,
        currency
      )}) across ${sup.ingredient_count} ingredients — above the ${concentrationThreshold}% concentration threshold.`,
      severity: "warning",
      recommendation_type: "supplier_concentration",
      related_entity_type: "supplier",
      related_entity_id: sup.supplier_id,
      suggested_action:
        "Consider a secondary supplier for the highest-spend ingredients to reduce dependency risk.",
      impact_json: {
        supplier_spend: sup.total_spend,
        total_spend: data.total_supplier_spend,
        share_pct: sup.pct_of_total,
        ingredient_count: sup.ingredient_count,
        currency,
      },
      metadata: {},
    });
  }

  // C. Missing supplier metadata.
  const { data: suppliersRaw, error: suppliersErr } = await supabase
    .from("suppliers")
    .select("id, name, email, phone, contact_name, status")
    .eq("company_id", companyId);
  if (suppliersErr) {
    console.error("[supplier_agent] suppliers:", suppliersErr.message);
  }
  type SupplierRow = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    contact_name: string | null;
    status: string | null;
  };
  const suppliers = (suppliersRaw ?? []) as SupplierRow[];

  for (const s of suppliers) {
    if (s.status && s.status !== "active") continue;
    const missing: string[] = [];
    if (!s.email || !s.email.trim()) missing.push("email");
    if (!s.phone || !s.phone.trim()) missing.push("phone");
    if (!s.contact_name || !s.contact_name.trim()) missing.push("contact name");
    if (missing.length === 0) continue;
    const severity: AgentSeverity = missing.length >= 3 ? "warning" : "info";
    findings.push({
      agent_key: "supplier_agent",
      title: `${s.name} is missing ${missing.join(", ")}`,
      description: `${s.name} doesn't have ${missing.join(
        ", "
      )} on file, which makes it harder to reach the supplier when costs or stock change.`,
      severity,
      recommendation_type: "missing_supplier_metadata",
      related_entity_type: "supplier",
      related_entity_id: s.id,
      suggested_action:
        "Fill in the missing contact details on the supplier page.",
      impact_json: { missing_fields: missing },
      metadata: {},
    });
  }

  const summary =
    `Supplier Agent reviewed ${suppliers.length} suppliers and ${data.ingredientPriceTrends.length} price-change events: ` +
    `${findings.filter((f) => f.recommendation_type === "price_increase").length} price increases, ` +
    `${findings.filter((f) => f.recommendation_type === "supplier_concentration").length} concentration alerts, ` +
    `${findings.filter((f) => f.recommendation_type === "missing_supplier_metadata").length} suppliers missing contact info.`;

  return {
    findings,
    metadata: {
      suppliers_reviewed: suppliers.length,
      price_changes_reviewed: data.ingredientPriceTrends.length,
      total_supplier_spend: data.total_supplier_spend,
      currency,
      thresholds: {
        price_increase_threshold_pct: priceIncreaseThreshold,
        supplier_concentration_threshold_pct: concentrationThreshold,
      },
    },
    summary,
  };
}

// ---------------------------------------------------------------------------
// pos_agent
// ---------------------------------------------------------------------------

export async function runPosAgent(
  supabase: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>
): Promise<RunnerResult> {
  const channelShiftThreshold = readNumber(
    config,
    "channel_shift_threshold_pct",
    20
  );
  const lowVolumeUnits = readNumber(config, "low_volume_item_units", 5);

  const findings: RunnerFinding[] = [];

  type PosRow = {
    raw_item_name: string | null;
    quantity: number | null;
    gross_revenue: number | null;
    net_revenue: number | null;
    sales_channel: string | null;
    currency: string | null;
  };
  const { data: posRaw, error: posErr } = await supabase
    .from("pos_sales_items")
    .select(
      "raw_item_name, quantity, gross_revenue, net_revenue, sales_channel, currency"
    )
    .eq("company_id", companyId)
    .limit(20_000);
  if (posErr) {
    console.error("[pos_agent] pos_sales_items:", posErr.message);
  }
  const posRows = (posRaw ?? []) as PosRow[];

  // Channel concentration: dominant channel above the configured shift threshold,
  // expressed as a share of total revenue.
  const channelRevenue = new Map<string, number>();
  let totalRevenue = 0;
  let currency = "MXN";
  for (const r of posRows) {
    const rev =
      typeof r.gross_revenue === "number" && Number.isFinite(r.gross_revenue)
        ? r.gross_revenue
        : typeof r.net_revenue === "number" && Number.isFinite(r.net_revenue)
          ? r.net_revenue
          : 0;
    if (rev <= 0) continue;
    totalRevenue += rev;
    if (r.currency) currency = r.currency;
    const ch = r.sales_channel ?? "unknown";
    channelRevenue.set(ch, (channelRevenue.get(ch) ?? 0) + rev);
  }

  if (totalRevenue > 0 && channelRevenue.size > 1) {
    const sorted = Array.from(channelRevenue.entries())
      .map(([channel, revenue]) => ({
        channel,
        revenue,
        share_pct: (revenue / totalRevenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    // Reuse channel_shift_threshold_pct as the concentration threshold for now.
    // The brief asks us to implement concentration first; channel shift over time
    // is left as a known limitation (no comparable-period logic in this milestone).
    if (top.share_pct >= 50 + channelShiftThreshold) {
      findings.push({
        agent_key: "pos_agent",
        title: `${top.channel} is ${top.share_pct.toFixed(0)}% of revenue`,
        description: `${top.channel} accounts for ${fmtCurrency(
          top.revenue,
          currency
        )} of ${fmtCurrency(
          totalRevenue,
          currency
        )} total revenue — concentration is above the ${(50 + channelShiftThreshold).toFixed(0)}% threshold.`,
        severity: "info",
        recommendation_type: "channel_shift",
        related_entity_type: "channel",
        related_entity_id: null,
        suggested_action:
          "If this dependence is unintentional, consider promoting under-represented channels (delivery, takeaway, online).",
        impact_json: {
          dominant_channel: top.channel,
          dominant_share_pct: top.share_pct,
          total_revenue: totalRevenue,
          channel_breakdown: sorted,
          currency,
        },
        metadata: {},
      });
    }
  }

  // Low-volume items with nonzero revenue.
  type ItemAgg = { units: number; revenue: number; raw: string };
  const byRaw = new Map<string, ItemAgg>();
  for (const r of posRows) {
    const name = (r.raw_item_name ?? "").trim();
    if (!name) continue;
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
    let agg = byRaw.get(name);
    if (!agg) {
      agg = { units: 0, revenue: 0, raw: name };
      byRaw.set(name, agg);
    }
    agg.units += qty;
    agg.revenue += rev;
  }
  const lowVolume = Array.from(byRaw.values())
    .filter((a) => a.units > 0 && a.units <= lowVolumeUnits && a.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 25);

  for (const item of lowVolume) {
    findings.push({
      agent_key: "pos_agent",
      title: `${item.raw} only sold ${item.units} unit${item.units === 1 ? "" : "s"}`,
      description: `${item.raw} brought in ${fmtCurrency(
        item.revenue,
        currency
      )} but only sold ${item.units} unit${item.units === 1 ? "" : "s"} — at or below the ${lowVolumeUnits}-unit low-volume threshold.`,
      severity: "info",
      recommendation_type: "low_volume_item",
      related_entity_type: "pos_item",
      related_entity_id: null,
      suggested_action:
        "Consider removing or repositioning the item, or check if the POS export missed sales.",
      impact_json: {
        raw_item_name: item.raw,
        units_sold: item.units,
        revenue: item.revenue,
        currency,
      },
      metadata: {},
    });
  }

  const summary =
    `POS Agent reviewed ${posRows.length} POS rows across ${channelRevenue.size} channels: ` +
    `${findings.filter((f) => f.recommendation_type === "channel_shift").length} channel concentration, ` +
    `${findings.filter((f) => f.recommendation_type === "low_volume_item").length} low-volume items.`;

  return {
    findings,
    metadata: {
      pos_rows_reviewed: posRows.length,
      channels_seen: channelRevenue.size,
      total_revenue: totalRevenue,
      currency,
      thresholds: {
        channel_shift_threshold_pct: channelShiftThreshold,
        low_volume_item_units: lowVolumeUnits,
      },
      limitation:
        "Comparable-period revenue drop / channel shift is not implemented in this milestone — only static concentration is checked.",
    },
    summary,
  };
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

export type RunnableAgentKey =
  | "pos_agent"
  | "recipe_margin_agent"
  | "supplier_agent";

export const AGENT_RUNNERS: Record<
  RunnableAgentKey,
  (
    supabase: SupabaseClient,
    companyId: string,
    config: Record<string, unknown>
  ) => Promise<RunnerResult>
> = {
  pos_agent: runPosAgent,
  recipe_margin_agent: runRecipeMarginAgent,
  supplier_agent: runSupplierAgent,
};

export function isRunnableAgentKey(v: unknown): v is RunnableAgentKey {
  return (
    typeof v === "string" &&
    (v === "pos_agent" || v === "recipe_margin_agent" || v === "supplier_agent")
  );
}
