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
import {
  fetchProfitabilityData,
  type ProfitabilitySelection,
} from "@/lib/restaurant/profitability-server";
import { fetchCockpitPosRollup } from "@/lib/restaurant/cockpit-pos-rollup";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import { dailyFromRollup, dailyFromRows } from "@/lib/restaurant/cockpit-daily";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import {
  computeBriefingSalesPeriods,
  formatDayLabel,
  type BriefingSalesPeriods,
  type DailySalesPoint,
} from "@/lib/restaurant/briefing-periods";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  resolveRestaurantCockpitLanguage,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

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

/** Implausible price jump (tiny previous price, huge %): « revisar precio ». */
export interface BriefingPriceReview {
  ingredient_id: string;
  ingredient_name: string;
  previous_cost: number;
  latest_cost: number;
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
  /**
   * Milton Language Foundation v1 — the company's preferred_language
   * ("en" | "es"), resolved once here and reused by every consumer that
   * wraps this context (Ask Milton included, via its own `briefing` field)
   * rather than each one re-fetching or re-deciding language on its own.
   */
  preferred_language: PreferredLanguage;
  /**
   * Period covered by `kpis` (all loaded POS data), with its first and last
   * day when known. NOT "yesterday": see `sales_periods` for dated periods.
   */
  period_label: string;
  /** Dated sales periods in the company timezone (yesterday, last 7 days). */
  sales_periods?: BriefingSalesPeriods;
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
  price_review_items?: BriefingPriceReview[];
  /** The company has Telegram connected (a row in restaurant_telegram_connections). */
  telegram_connected?: boolean;
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

function fmtMoney(amount: number, currency: string): string {
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

/**
 * Timezone the briefing speaks in: companies.briefing_email_timezone first
 * (the zone the email is scheduled in), then the POS connection / UTC.
 */
async function resolveBriefingTimezone(
  supabase: SupabaseClient,
  companyId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("companies")
      .select("briefing_email_timezone")
      .eq("id", companyId)
      .maybeSingle();
    const tz = normalizeTimezone(data?.briefing_email_timezone);
    if (tz) return tz;
  } catch (err) {
    console.error("[briefing-context] timezone lookup:", err);
  }
  return resolvePosTimezone(supabase, companyId);
}

/** Net sales + tickets per local day, or null when POS could not be read. */
async function loadDailySales(
  supabase: SupabaseClient,
  companyId: string,
  selected: ProfitabilitySelection | null,
  timezone: string,
  currency: string
): Promise<DailySalesPoint[] | null> {
  try {
    const { rollup } = await fetchCockpitPosRollup(supabase, companyId, {
      locationId: selected?.locationId ?? null,
      timezone,
      currency,
    });
    if (rollup) return dailyFromRollup(rollup);
  } catch (err) {
    console.error("[briefing-context] rollup:", err);
  }
  try {
    const walked = await fetchCompanyPosSalesRows(
      supabase as never,
      companyId,
      selected?.locationId ?? null
    );
    if (walked.error) return null;
    return dailyFromRows(walked.rows, timezone, currency);
  } catch (err) {
    console.error("[briefing-context] daily rows:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** True when the company has an active Telegram connection. Unknown => false. */
export async function isTelegramConnected(
  supabase: SupabaseClient,
  companyId: string
): Promise<boolean> {
  try {
    const { count } = await supabase
      .from("restaurant_telegram_connections")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * @param selected Multi-Restaurant UX v1: when set, scopes the briefing to
 *   a single restaurant (consolidated otherwise). Must already be
 *   validated by the caller against the resolved company — see
 *   lib/restaurant/restaurant-context-server.ts.
 */
export async function buildBriefingContext(
  supabase: SupabaseClient,
  companyId: string,
  selected?: ProfitabilitySelection | null,
  options?: { now?: Date }
): Promise<BriefingContext> {
  // Same resolver as the restaurant cockpit so Ask Milton / briefing
  // prose match the shell (R1 Spanish). Emails/Telegram formatters that
  // still want resolvePreferredLanguage should not go through this path.
  let preferredLanguage: PreferredLanguage =
    RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  try {
    const { data: languageRow } = await supabase
      .from("companies")
      .select("preferred_language")
      .eq("id", companyId)
      .maybeSingle();
    preferredLanguage = resolveRestaurantCockpitLanguage(
      languageRow?.preferred_language
    );
  } catch (err) {
    console.error("[briefing-context] preferred_language lookup:", err);
  }

  // ---- Restaurant name (best-effort) ----
  // Selected: prefer the location's OWN brand, then its own location name —
  // never an arbitrary OTHER brand belonging to the same company.
  // Consolidated: the company's first brand (arbitrary but harmless — the
  // whole company is in view), falling back to the company name.
  let restaurantName = "Your restaurant";
  try {
    if (selected) {
      if (selected.brandId) {
        const { data: brand } = await supabase
          .from("restaurant_brands")
          .select("name")
          .eq("id", selected.brandId)
          .maybeSingle();
        if (brand?.name) restaurantName = brand.name;
      }
      if (restaurantName === "Your restaurant") {
        const { data: location } = await supabase
          .from("restaurant_locations")
          .select("name")
          .eq("id", selected.locationId)
          .maybeSingle();
        if (location?.name) restaurantName = location.name;
      }
    } else {
      const { data: brand } = await supabase
        .from("restaurant_brands")
        .select("name")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();
      if (brand?.name) restaurantName = brand.name;
    }
    if (restaurantName === "Your restaurant") {
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
  const data = await fetchProfitabilityData(supabase, companyId, selected);
  const currency = data.kpis.currency;

  // ---- Dated sales periods (company briefing timezone) ----
  const briefingTimezone = await resolveBriefingTimezone(supabase, companyId);
  const daily = await loadDailySales(
    supabase,
    companyId,
    selected ?? null,
    briefingTimezone,
    currency
  );
  const telegramConnected = await isTelegramConnected(supabase, companyId);
  const salesPeriods = daily
    ? computeBriefingSalesPeriods({
        daily,
        now: options?.now ?? new Date(),
        timezone: briefingTimezone,
        lang: preferredLanguage,
        formatMoney: (n) => fmtMoney(n, currency),
      })
    : undefined;
  const firstDay = daily?.length ? daily[0].date : null;
  const lastDay = daily?.length ? daily[daily.length - 1].date : null;
  const periodLabel = firstDay
    ? t(
        preferredLanguage,
        `all loaded POS data (${formatDayLabel(firstDay, "en")} to ${formatDayLabel(lastDay ?? firstDay, "en")})`,
        `todos los datos de POS cargados (${formatDayLabel(firstDay, "es")} a ${formatDayLabel(lastDay ?? firstDay, "es")})`
      )
    : t(
        preferredLanguage,
        "all loaded POS data",
        "todos los datos de POS cargados"
      );

  // Distinct checks come from the profitability POS read — do not page
  // pos_sales_items a second time just for check_id.
  let orders: number | null = null;
  let ordersReason: string | undefined;
  if (data.readError) {
    ordersReason = t(
      preferredLanguage,
      "Could not read check_id from pos_sales_items.",
      "No se pudo leer check_id de pos_sales_items."
    );
  } else if (data.distinct_check_count > 0) {
    orders = data.distinct_check_count;
  } else {
    ordersReason = t(
      preferredLanguage,
      "POS rows have no check_id (summary export) — orders not counted.",
      "Las filas del POS no tienen check_id (exportación resumida) — no se contaron órdenes."
    );
  }

  const unitsSold = data.marginRows.reduce((s, r) => s + r.units_sold, 0);
  const avgTicket =
    orders && orders > 0 ? data.kpis.revenue_total / orders : null;
  const avgTicketReason =
    avgTicket === null
      ? t(
          preferredLanguage,
          "avg_ticket requires order count — see orders_reason.",
          "avg_ticket requiere el número de órdenes — ver orders_reason."
        )
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
  // A missing price is never 0: an item whose price cannot be read is dropped
  // (null), not shown as "0 → 0".
  const priceIncreases: BriefingPriceTrend[] = data.ingredientPriceTrends
    .filter((t) => t.pct_change > 0)
    .map((t): BriefingPriceTrend | null => {
      // Unit prices can be fractions of a cent: never round to 2 decimals.
      const previous = round(t.previous_cost, 6);
      const latest = round(t.latest_cost, 6);
      const pct = round(t.pct_change, 1);
      if (previous === null || latest === null || pct === null) return null;
      return {
        ingredient_id: t.ingredient_id,
        ingredient_name: t.ingredient_name,
        supplier_name: t.latest_supplier_name,
        previous_cost: previous,
        latest_cost: latest,
        pct_change: pct,
        unit: t.unit,
        latest_date: t.latest_date,
      };
    })
    .filter((t): t is BriefingPriceTrend => t !== null)
    .slice(0, 5);

  // Price changes a person should check («Revisar precio»): no percentage.
  const priceReview: BriefingPriceReview[] = (data.ingredientPriceReview ?? [])
    .map((t): BriefingPriceReview | null => {
      const previous = round(t.previous_cost, 6);
      const latest = round(t.latest_cost, 6);
      if (previous === null || latest === null) return null;
      return {
        ingredient_id: t.ingredient_id,
        ingredient_name: t.ingredient_name,
        previous_cost: previous,
        latest_cost: latest,
        unit: t.unit,
        latest_date: t.latest_date,
      };
    })
    .filter((t): t is BriefingPriceReview => t !== null)
    .slice(0, 5);

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
    preferred_language: preferredLanguage,
    period_label: periodLabel,
    sales_periods: salesPeriods,
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
          ? t(
              preferredLanguage,
              "No revenue with complete cost coverage — set up recipes and ingredient costs.",
              "No hay ingresos con cobertura de costo completa — configura recetas y costos de ingredientes."
            )
          : undefined,
      food_cost_pct: round(data.kpis.food_cost_pct, 1),
      food_cost_pct_reason:
        data.kpis.food_cost_pct === null
          ? t(
              preferredLanguage,
              "Food cost % requires revenue with complete cost — see cost_coverage_pct.",
              "El % de costo de alimentos requiere ingresos con costo completo — ver cost_coverage_pct."
            )
          : undefined,
    },
    top_revenue_items: topRevenueItems,
    low_margin_items: lowMargin,
    high_food_cost_items: highFoodCost,
    high_revenue_missing_recipe: missingRecipe,
    costing_blockers: costingBlockers,
    supplier_price_increases: priceIncreases,
    price_review_items: priceReview,
    telegram_connected: telegramConnected,
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
