// lib/restaurant/cockpit-page-data.ts
//
// Shared loader for the cockpit and the thin Sales / Menu / Costs routes.
// Same fetches as the original cockpit page — no KPI math lives here.

import { accessTokenOf, cacheClientFor } from "@/lib/restaurant/cache-client";
import { cachedForCompany, salesTag } from "@/lib/restaurant/cache-tags";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  getRestaurantKpiTargets,
  type TargetMap,
} from "@/lib/restaurant/supabase-targets";
import {
  fetchRealRestaurantDashboardData,
  toExplorerRow,
  type ExplorerRow,
  type RestaurantDashboardData,
  type SampleReason,
} from "@/lib/restaurant/supabase-sales";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import {
  buildCockpitSalesAggregate,
  emptyCockpitSalesAggregate,
  type CockpitFactRow,
  type CockpitSalesAggregate,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  EMPTY_PERIOD_COST,
  buildCockpitPeriodSnapshotFromRollup,
  fetchCockpitPosRollup,
  rollupToCockpitSalesAggregate,
} from "@/lib/restaurant/cockpit-pos-rollup";
import {
  applyCockpitServerTimingHeader,
  logCockpitTiming,
  timeCockpitStep,
} from "@/lib/restaurant/cockpit-timing";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import {
  loadCachedPosSalesRows,
  loadCachedProfitability,
} from "@/lib/restaurant/pos-read-cache";
import {
  costingDataFromProfitability,
  fetchProfitabilityData,
  type ProfitabilityData,
} from "@/lib/restaurant/profitability-server";
import { calculateAllMenuItemCosts } from "@/lib/restaurant/costing";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { periodCostKpisFromDishEconomics } from "@/lib/restaurant/costing/dish-economics-adapter";
import { menuSetupProgress } from "@/lib/restaurant/costing/menu-summary";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  inInclusiveRange,
  parseCockpitPeriodPreset,
  resolveCockpitPeriod,
  type CockpitPeriod,
  type CockpitPeriodPreset,
  type InclusiveDateRange,
} from "@/lib/restaurant/cockpit-period";
import {
  itemCostLookupFromMarginRows,
  periodCostKpisFromProductLines,
  productLinesFromCostRows,
  type PeriodCostKpis,
} from "@/lib/restaurant/cockpit-cost-coverage";
import { type PreferredLanguage } from "@/lib/restaurant/language";
import {
  buildCockpitHeadline,
  buildCockpitKpiStripModel,
  buildCockpitPeriodSnapshot,
  cockpitComparisonPhrases,
  localSaleDateKey,
  type CockpitKpiStripModel,
  type CockpitPeriodSnapshot,
} from "@/lib/restaurant/cockpit-executive";
import { buildCockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";
import type { CockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";
import {
  setupProgress,
  type SetupProgress,
} from "@/lib/restaurant/setup-progress";
import {
  selectCockpitInsights,
  wordedFromFacts,
  type CockpitInsightFact,
} from "@/lib/restaurant/cockpit-insights";
import {
  cockpitFactsDataVersion,
  cockpitInsightCacheKey,
  hashCockpitInsightFacts,
  type WordedCockpitInsights,
} from "@/lib/restaurant/cockpit-insights-ai";
export interface CockpitPageModel {
  data: RestaurantDashboardData;
  targets: TargetMap;
  profitability: ProfitabilityData | null;
  resolvedLocationId: string | null;
}

export interface MenuAreaModel {
  profitability: ProfitabilityData | null;
}

export interface CockpitExecutiveView {
  snapshot: CockpitPeriodSnapshot;
  kpis: CockpitKpiStripModel;
  headline: string;
  insights: WordedCockpitInsights;
  insightFacts: CockpitInsightFact[];
  insightCacheKey: string;
  comparisonLabel: string;
  health: CockpitDataHealth;
  setup: SetupProgress | null;
  lastSyncedAt: string | null;
}

export interface CockpitExecutivePageModel extends CockpitPageModel {
  executive: CockpitExecutiveView | null;
  periodPreset: CockpitPeriodPreset;
}

export async function loadCockpitPageModel(
  requestedLocationId?: string
): Promise<CockpitPageModel> {
  let data: RestaurantDashboardData;
  let targets: TargetMap = {};
  let profitability: ProfitabilityData | null = null;
  let selectedLocationId: string | null = null;

  try {
    const supabase = await createClient();

    let selectedBrandId: string | null = null;
    if (requestedLocationId) {
      // The cached sign-in / company (no second Auth round trip).
      const user = await getCachedAuthUser();
      if (user?.id) {
        const companyIdForContext = await getCachedCompanyId(user.id);
        if (companyIdForContext) {
          const context = await resolveRestaurantContext(
            supabase,
            companyIdForContext,
            requestedLocationId
          );
          if (context.selected) {
            selectedLocationId = context.selected.locationId;
            selectedBrandId = context.selected.brandId;
          }
        }
      }
    }

    data = await fetchRealRestaurantDashboardData(supabase, selectedLocationId);
    if (data.mode === "live") {
      // The goals and the profitability are independent: read them together.
      const live = data;
      const [targetsRead, profitabilityRead] = await Promise.all([
        getRestaurantKpiTargets(supabase, live.companyId).catch((err) => {
          console.error("[loadCockpitPageModel] targets load failed:", err);
          return {} as TargetMap;
        }),
        fetchProfitabilityData(
          supabase,
          live.companyId,
          selectedLocationId
            ? { locationId: selectedLocationId, brandId: selectedBrandId }
            : null,
          live.readError ? undefined : { posRows: live.posFactRows }
        ).catch((err) => {
          console.error(
            "[loadCockpitPageModel] profitability load failed:",
            err
          );
          return null;
        }),
      ]);
      targets = targetsRead;
      profitability = profitabilityRead;
    }
  } catch (err) {
    console.error("[loadCockpitPageModel] Supabase init failed:", err);
    data = { mode: "sample", reason: "env_missing" };
  }

  return {
    data,
    targets,
    profitability,
    resolvedLocationId: selectedLocationId,
  };
}

/**
 * Menu area only — profitability (and its own POS fact read). Does not
 * call fetchRealRestaurantDashboardData, so the Menu page avoids the
 * extra full cockpit ~20k-row load.
 */
export async function loadMenuAreaModel(
  requestedLocationId?: string
): Promise<MenuAreaModel> {
  try {
    return await timeCockpitStep("menu", async () => {
      const supabase = await createClient();
      const user = await getCachedAuthUser();
      if (!user?.id) return { profitability: null };

      const companyId = await getCachedCompanyId(user.id);
      if (!companyId) return { profitability: null };

      let selectedLocationId: string | null = null;
      let selectedBrandId: string | null = null;
      if (requestedLocationId) {
        const context = await resolveRestaurantContext(
          supabase,
          companyId,
          requestedLocationId
        );
        if (context.selected) {
          selectedLocationId = context.selected.locationId;
          selectedBrandId = context.selected.brandId;
        }
      }

      const profitability = await loadCachedProfitability(
        companyId,
        selectedLocationId,
        selectedBrandId
      );
      applyCockpitServerTimingHeader();
      return { profitability };
    });
  } catch (err) {
    console.error("[loadMenuAreaModel] failed:", err);
    return { profitability: null };
  }
}

/**
 * Cockpit PR 2: same one paginated POS read as loadCockpitPageModel,
 * then a single in-memory period aggregate. Company comes from auth,
 * never from the request.
 */
export async function loadCockpitExecutivePage(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<CockpitExecutivePageModel> {
  const periodPreset = parseCockpitPeriodPreset(periodRaw);
  const base = await loadCockpitPageModel(requestedLocationId);
  if (base.data.mode !== "live") {
    return { ...base, executive: null, periodPreset };
  }

  const lang = base.data.preferredLanguage;
  const chrome = await loadRestaurantShellChrome();
  const period = resolveCockpitPeriod(
    periodPreset,
    base.data.cockpit.period_to
  );
  if (!period) {
    return { ...base, executive: null, periodPreset };
  }

  const snapshot = buildCockpitPeriodSnapshot(base.data.posFactRows, period, {
    timezone: base.data.timezone,
    currency: base.data.cockpit.currency,
    lang,
    marginRows: base.profitability?.marginRows,
  });

  const week = {
    thisWeek: base.data.cockpit.this_week
      ? {
          from: base.data.cockpit.this_week.from,
          to: base.data.cockpit.this_week.to,
        }
      : null,
    lastWeek: base.data.cockpit.last_week
      ? {
          from: base.data.cockpit.last_week.from,
          to: base.data.cockpit.last_week.to,
        }
      : null,
    deltaPct: base.data.cockpit.week_delta_pct,
  };
  const kpis = buildCockpitKpiStripModel(snapshot, lang, week);
  const headline = buildCockpitHeadline(snapshot, lang);
  const comparisonLabel = cockpitComparisonPhrases(period, lang).chipLabel;

  const recipeCoverage = recipeCoverageFromProfitability(base.profitability);
  const ingredientsTotal = base.profitability?.setupCounts.ingredients_count;
  const ingredientsWithout =
    base.profitability?.dataQuality.ingredients_without_cost_entries;
  const ingredientsWithCost =
    ingredientsTotal != null && ingredientsWithout != null
      ? Math.max(0, ingredientsTotal - ingredientsWithout)
      : null;
  const posConnected = await companyHasActivePosConnection(base.data.companyId);
  const health = buildCockpitDataHealth({
    lang,
    currency: snapshot.currency,
    saleLineCount: base.data.rowCount,
    otherCurrencyExcluded:
      snapshot.other_currency_excluded ||
      (base.profitability?.dataQuality.currency_mismatch_rows ?? 0),
    dishesWithoutRecipe:
      base.profitability?.kpis.menu_items_without_recipe ?? 0,
    recipeCoveragePct: recipeCoverage,
    costCoveragePct: snapshot.cost.coverage_pct,
    allTimeCostCoveragePct: base.profitability?.kpis.cost_coverage_pct ?? null,
    ingredientsWithCost,
    ingredientsTotal: ingredientsTotal ?? null,
    lastSyncedAt: chrome.lastSyncedAt,
    posConnected,
    salesLoaded: base.data.rowCount > 0 && !base.data.readError,
    readError: Boolean(base.data.readError || base.profitability?.readError),
    truncated: Boolean(base.data.truncated || base.profitability?.truncated),
  });

  const setup = base.profitability
    ? setupProgress(
        base.profitability.setupCounts,
        base.profitability.dataQuality
      )
    : null;

  const lowMargin = base.profitability?.lowMargin[0];
  const facts = selectCockpitInsights(snapshot, lang, {
    lowMarginDish: lowMargin
      ? {
          name: lowMargin.name,
          margin_pct: lowMargin.cost.gross_margin_pct ?? 0,
        }
      : null,
    dishesWithoutRecipe:
      base.profitability?.kpis.menu_items_without_recipe ?? 0,
  });
  const insights: WordedCockpitInsights = {
    insights: wordedFromFacts(facts),
    source: "deterministic",
  };
  const insightCacheKey = cockpitInsightCacheKey({
    companyId: base.data.companyId,
    locationId: base.resolvedLocationId,
    preset: period.preset,
    from: period.current.from,
    to: period.current.to,
    lang,
    factsHash: hashCockpitInsightFacts(facts),
    dataVersion: cockpitFactsDataVersion({
      latestSaleDate: base.data.cockpit.period_to,
      rowCount: base.data.rowCount,
    }),
  });

  return {
    ...base,
    periodPreset,
    executive: {
      snapshot,
      kpis,
      headline,
      insights,
      insightFacts: facts,
      insightCacheKey,
      comparisonLabel,
      health,
      setup,
      lastSyncedAt: chrome.lastSyncedAt,
    },
  };
}

async function companyHasActivePosConnection(
  companyId: string
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("restaurant_pos_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { id?: string } | null)?.id);
  } catch (err) {
    console.error("[loadCockpitExecutivePage] pos connection:", err);
    return false;
  }
}

function recipeCoverageFromProfitability(
  profitability: ProfitabilityData | null
): number | null {
  if (!profitability) return null;
  const total = profitability.marginRows.reduce((s, r) => s + r.revenue, 0);
  if (total <= 0) return 0;
  const withRecipe = profitability.marginRows
    .filter((r) => r.cost.status !== "missing_recipe")
    .reduce((s, r) => s + r.revenue, 0);
  return (withRecipe / total) * 100;
}

export interface CockpitScope {
  companyId: string;
  locationId: string | null;
  brandId: string | null;
}

export type CockpitExecutivesByPeriod = {
  last_7: CockpitExecutiveView | null;
  month: CockpitExecutiveView | null;
};

export interface PeriodCostPair {
  cost: PeriodCostKpis;
  previous_cost: PeriodCostKpis;
}

export interface BothPeriodCostKpis {
  last_7: PeriodCostPair | null;
  month: PeriodCostPair | null;
  source: "memory" | "rows" | "empty" | "none";
}

export interface CockpitExecutiveFastModel {
  mode: "live" | "sample";
  reason?: SampleReason;
  scope: CockpitScope | null;
  lang: PreferredLanguage;
  timezone: string;
  currency: string;
  rowCount: number;
  truncated: boolean;
  readError: boolean;
  rollupSource: "rpc" | "rows" | "none";
  cockpit: CockpitSalesAggregate;
  executive: CockpitExecutiveView | null;
  executives: CockpitExecutivesByPeriod;
  periodPreset: CockpitPeriodPreset;
  lastSyncedAt: string | null;
}

function emptyExecutives(): CockpitExecutivesByPeriod {
  return { last_7: null, month: null };
}

const PERIOD_COST_BUNDLE_TTL_MS = 90_000;
const periodCostBundleCache = new Map<
  string,
  { expiresAt: number; value: BothPeriodCostKpis }
>();

export function clearPeriodCostBundleCacheForTests(): void {
  periodCostBundleCache.clear();
}

function readPeriodCostBundleCache(key: string): BothPeriodCostKpis | null {
  const hit = periodCostBundleCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    periodCostBundleCache.delete(key);
    return null;
  }
  periodCostBundleCache.delete(key);
  periodCostBundleCache.set(key, hit);
  return hit.value;
}

function writePeriodCostBundleCache(
  key: string,
  value: BothPeriodCostKpis
): void {
  if (periodCostBundleCache.has(key)) periodCostBundleCache.delete(key);
  periodCostBundleCache.set(key, {
    expiresAt: Date.now() + PERIOD_COST_BUNDLE_TTL_MS,
    value,
  });
  while (periodCostBundleCache.size > 50) {
    const oldest = periodCostBundleCache.keys().next().value;
    if (oldest === undefined) break;
    periodCostBundleCache.delete(oldest);
  }
}

export const loadCachedCockpitPosRollup = cache(
  async (
    companyId: string,
    locationId: string | null,
    timezone: string,
    currency: string
  ) => {
    const supabase = await createClient();
    const read = (client: Parameters<typeof fetchCockpitPosRollup>[0]) =>
      fetchCockpitPosRollup(client, companyId, {
        locationId,
        timezone,
        currency,
      });
    // The rollup (an RPC over every sales row) is kept across requests for 5
    // minutes and expired with the company's sales tag (POS sync / upload,
    // shifts, goals, restaurants). Only a good rollup is cached; the RPC checks
    // membership with the caller's token, so it runs RLS-bound.
    const token = await accessTokenOf(supabase);
    if (!token) return read(supabase);
    return cachedForCompany(
      {
        name: "cockpit-pos-rollup",
        companyId,
        parts: { location: locationId, tz: timezone, currency },
        tags: [salesTag(companyId)],
      },
      async () => {
        const result = await read(await cacheClientFor(token));
        if (result.error || result.missing || !result.rollup) {
          throw new Error("rollup not cacheable");
        }
        return result;
      },
      () => read(supabase)
    );
  }
);

export interface CockpitTabsModel {
  lang: PreferredLanguage;
  profitability: ProfitabilityData | null;
  rowCount: number;
  readError: boolean;
  truncated: boolean;
  resolvedLocationId: string | null;
}

export interface SalesAreaModel {
  mode: "live" | "sample";
  reason?: SampleReason;
  lang: PreferredLanguage;
  cockpit: CockpitSalesAggregate;
  explorerRows: ExplorerRow[];
  targets: TargetMap;
  displayCurrency: string;
}

const resolveCockpitScope = cache(resolveCockpitScopeUncached);

async function resolveCockpitScopeUncached(
  requestedLocationId?: string
): Promise<
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      scope: CockpitScope;
    }
  | { ok: false; reason: SampleReason }
> {
  try {
    return await timeCockpitStep(
      "scope",
      async () => {
        // Independent: the client (cookies) and the cached sign-in.
        const [supabase, user] = await Promise.all([
          createClient(),
          getCachedAuthUser(),
        ]);
        if (!user?.id) return { ok: false, reason: "unauthenticated" as const };
        const companyId = await getCachedCompanyId(user.id);
        if (!companyId) return { ok: false, reason: "no_company" as const };
        let locationId: string | null = null;
        let brandId: string | null = null;
        if (requestedLocationId) {
          const context = await resolveRestaurantContext(
            supabase,
            companyId,
            requestedLocationId
          );
          if (context.selected) {
            locationId = context.selected.locationId;
            brandId = context.selected.brandId;
          }
        }
        return {
          ok: true as const,
          supabase,
          scope: { companyId, locationId, brandId },
        };
      },
      { location: requestedLocationId ?? null }
    );
  } catch (err) {
    console.error("[resolveCockpitScope] failed:", err);
    return { ok: false, reason: "env_missing" };
  }
}

function weekFromCockpit(cockpit: CockpitSalesAggregate) {
  return {
    thisWeek: cockpit.this_week
      ? { from: cockpit.this_week.from, to: cockpit.this_week.to }
      : null,
    lastWeek: cockpit.last_week
      ? { from: cockpit.last_week.from, to: cockpit.last_week.to }
      : null,
    deltaPct: cockpit.week_delta_pct,
  };
}

function executiveFromSnapshot(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage,
  cockpit: CockpitSalesAggregate,
  extras: {
    companyId: string;
    locationId: string | null;
    profitability: ProfitabilityData | null;
    rowCount: number;
    lastSyncedAt: string | null;
    posConnected: boolean;
    readError: boolean;
    truncated: boolean;
    costPending?: boolean;
  }
): CockpitExecutiveView {
  const kpis = buildCockpitKpiStripModel(
    snapshot,
    lang,
    weekFromCockpit(cockpit)
  );
  if (extras.costPending) kpis.cost_pending = true;
  const headline = buildCockpitHeadline(snapshot, lang);
  const comparisonLabel = cockpitComparisonPhrases(
    snapshot.period,
    lang
  ).chipLabel;
  const recipeCoverage = recipeCoverageFromProfitability(extras.profitability);
  const ingredientsTotal = extras.profitability?.setupCounts.ingredients_count;
  const ingredientsWithout =
    extras.profitability?.dataQuality.ingredients_without_cost_entries;
  const ingredientsWithCost =
    ingredientsTotal != null && ingredientsWithout != null
      ? Math.max(0, ingredientsTotal - ingredientsWithout)
      : null;
  const health = buildCockpitDataHealth({
    lang,
    currency: snapshot.currency,
    saleLineCount: extras.rowCount,
    otherCurrencyExcluded:
      snapshot.other_currency_excluded ||
      (extras.profitability?.dataQuality.currency_mismatch_rows ?? 0),
    dishesWithoutRecipe:
      extras.profitability?.kpis.menu_items_without_recipe ?? 0,
    recipeCoveragePct: recipeCoverage,
    costCoveragePct: snapshot.cost.coverage_pct,
    allTimeCostCoveragePct:
      extras.profitability?.kpis.cost_coverage_pct ?? null,
    ingredientsWithCost,
    ingredientsTotal: ingredientsTotal ?? null,
    lastSyncedAt: extras.lastSyncedAt,
    posConnected: extras.posConnected,
    salesLoaded: extras.rowCount > 0 && !extras.readError,
    readError: extras.readError,
    truncated: extras.truncated,
  });
  // R1-09b (D3): the same checklist as Menú › Resumen.
  const setup = extras.profitability?.dishEconomics
    ? menuSetupProgress(extras.profitability.dishEconomics)
    : extras.profitability
      ? setupProgress(
          extras.profitability.setupCounts,
          extras.profitability.dataQuality
        )
      : null;
  const lowMargin = extras.profitability?.lowMargin[0];
  const facts = selectCockpitInsights(snapshot, lang, {
    lowMarginDish: lowMargin
      ? {
          name: lowMargin.name,
          margin_pct: lowMargin.cost.gross_margin_pct ?? 0,
        }
      : null,
    dishesWithoutRecipe:
      extras.profitability?.kpis.menu_items_without_recipe ?? 0,
  });
  return {
    snapshot,
    kpis,
    headline,
    insights: { insights: wordedFromFacts(facts), source: "deterministic" },
    insightFacts: facts,
    insightCacheKey: cockpitInsightCacheKey({
      companyId: extras.companyId,
      locationId: extras.locationId,
      preset: snapshot.period.preset,
      from: snapshot.period.current.from,
      to: snapshot.period.current.to,
      lang,
      factsHash: hashCockpitInsightFacts(facts),
      dataVersion: cockpitFactsDataVersion({
        latestSaleDate: cockpit.period_to,
        rowCount: extras.rowCount,
      }),
    }),
    comparisonLabel,
    health,
    setup,
    lastSyncedAt: extras.lastSyncedAt,
  };
}

/**
 * Fast executive strip: one RPC (or a fallback row walk). Does not wait
 * for profitability or explorer rows.
 */
export const loadCockpitExecutiveFast = cache(loadCockpitExecutiveFastUncached);

async function loadCockpitExecutiveFastUncached(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<CockpitExecutiveFastModel> {
  try {
    return await loadCockpitExecutiveFastBody(requestedLocationId, periodRaw);
  } finally {
    applyCockpitServerTimingHeader();
  }
}

async function loadCockpitExecutiveFastBody(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<CockpitExecutiveFastModel> {
  const periodPreset = parseCockpitPeriodPreset(periodRaw);
  // R1-14: the shell chrome and the scope share the (cached) sign-in and
  // company reads and are otherwise independent: one wait, not two.
  const [chrome, resolved] = await Promise.all([
    loadRestaurantShellChrome(),
    resolveCockpitScope(requestedLocationId),
  ]);
  const lang = chrome.lang;
  if (!resolved.ok) {
    return {
      mode: "sample",
      reason: resolved.reason,
      scope: null,
      lang,
      timezone: "UTC",
      currency: "USD",
      rowCount: 0,
      truncated: false,
      readError: false,
      rollupSource: "none",
      cockpit: emptyCockpitSalesAggregate(),
      executive: null,
      executives: emptyExecutives(),
      periodPreset,
      lastSyncedAt: chrome.lastSyncedAt,
    };
  }
  const { supabase, scope } = resolved;
  const started = Date.now();
  const [currency, timezone, posConnected] = await Promise.all([
    timeCockpitStep("currency", () =>
      resolveCompanyCurrency(supabase, scope.companyId)
    ),
    timeCockpitStep("timezone", () =>
      resolvePosTimezone(supabase, scope.companyId)
    ),
    timeCockpitStep("pos-connection", () =>
      companyHasActivePosConnection(scope.companyId)
    ),
  ]);
  const rpc = await loadCachedCockpitPosRollup(
    scope.companyId,
    scope.locationId,
    timezone,
    currency
  );
  let cockpit: CockpitSalesAggregate;
  let rowCount = 0;
  let truncated = false;
  let readError = false;
  let rollupSource: "rpc" | "rows" = "rows";
  let snapshotRows: Parameters<typeof buildCockpitPeriodSnapshot>[0] | null =
    null;

  if (rpc.rollup && rpc.rollup.row_count > 0) {
    rollupSource = "rpc";
    rowCount = rpc.rollup.row_count;
    cockpit = rollupToCockpitSalesAggregate(rpc.rollup, { timezone, currency });
  } else if (
    rpc.rollup &&
    rpc.rollup.row_count === 0 &&
    !rpc.missing &&
    !rpc.error
  ) {
    return {
      mode: "sample",
      reason: "no_sales",
      scope,
      lang,
      timezone,
      currency,
      rowCount: 0,
      truncated: false,
      readError: false,
      rollupSource: "rpc",
      cockpit: emptyCockpitSalesAggregate(timezone, currency),
      executive: null,
      executives: emptyExecutives(),
      periodPreset,
      lastSyncedAt: chrome.lastSyncedAt,
    };
  } else {
    const pos = await timeCockpitStep(
      "pos-rows",
      () => loadCachedPosSalesRows(scope.companyId, scope.locationId),
      { source: "rows" }
    );
    if (pos.error) {
      readError = true;
      cockpit = emptyCockpitSalesAggregate(timezone, currency);
    } else if (pos.rows.length === 0) {
      return {
        mode: "sample",
        reason: "no_sales",
        scope,
        lang,
        timezone,
        currency,
        rowCount: 0,
        truncated: false,
        readError: false,
        rollupSource: "rows",
        cockpit: emptyCockpitSalesAggregate(timezone, currency),
        executive: null,
        executives: emptyExecutives(),
        periodPreset,
        lastSyncedAt: chrome.lastSyncedAt,
      };
    } else {
      snapshotRows = pos.rows;
      rowCount = pos.rows.length;
      truncated = pos.truncated;
      cockpit = buildCockpitSalesAggregate(pos.rows, { timezone, currency });
    }
  }

  const extras = {
    companyId: scope.companyId,
    locationId: scope.locationId,
    profitability: null,
    rowCount,
    lastSyncedAt: chrome.lastSyncedAt,
    posConnected,
    readError,
    truncated,
    costPending: true,
  };
  const executives = emptyExecutives();
  for (const preset of ["last_7", "month"] as const) {
    const period = resolveCockpitPeriod(preset, cockpit.period_to);
    if (!period) continue;
    const snapshot = snapshotRows
      ? buildCockpitPeriodSnapshot(snapshotRows, period, {
          timezone,
          currency,
          lang,
        })
      : rpc.rollup
        ? buildCockpitPeriodSnapshotFromRollup(rpc.rollup, period, {
            timezone,
            currency,
            lang,
          })
        : null;
    if (snapshot) {
      executives[preset] = executiveFromSnapshot(
        snapshot,
        lang,
        cockpit,
        extras
      );
    }
  }
  const executive = executives[periodPreset];

  logCockpitTiming("executive-fast", {
    source: rollupSource,
    rpcMs: rpc.elapsedMs,
    rpcError: rpc.error?.message ?? null,
    totalMs: Date.now() - started,
    rows: rowCount,
    location: scope.locationId,
    periods: (["last_7", "month"] as const).filter(
      (preset) => executives[preset] != null
    ),
  });

  return {
    mode: "live",
    scope,
    lang,
    timezone,
    currency,
    rowCount,
    truncated,
    readError,
    rollupSource,
    cockpit,
    executive,
    executives,
    periodPreset,
    lastSyncedAt: chrome.lastSyncedAt,
  };
}

export const loadCockpitTabsModel = cache(loadCockpitTabsModelUncached);

async function loadCockpitTabsModelUncached(
  requestedLocationId?: string
): Promise<CockpitTabsModel> {
  // Independent reads (both share the cached sign-in and company): one wait.
  const [chrome, resolved] = await Promise.all([
    loadRestaurantShellChrome(),
    resolveCockpitScope(requestedLocationId),
  ]);
  if (!resolved.ok) {
    return {
      lang: chrome.lang,
      profitability: null,
      rowCount: 0,
      readError: false,
      truncated: false,
      resolvedLocationId: null,
    };
  }
  const started = Date.now();
  const profitability = await timeCockpitStep("tabs-profitability", () =>
    loadCachedProfitability(
      resolved.scope.companyId,
      resolved.scope.locationId,
      resolved.scope.brandId
    )
  );
  logCockpitTiming("tabs", {
    totalMs: Date.now() - started,
    source: profitability.posSource ?? "none",
    posRows: profitability.setupCounts.pos_sales_count,
    location: resolved.scope.locationId,
  });
  applyCockpitServerTimingHeader();
  return {
    lang: chrome.lang,
    profitability,
    rowCount: profitability.setupCounts.pos_sales_count,
    readError: profitability.readError,
    truncated: profitability.truncated,
    resolvedLocationId: resolved.scope.locationId,
  };
}

export async function loadSalesHeroModel(
  requestedLocationId?: string
): Promise<{
  mode: "live" | "sample";
  reason?: SampleReason;
  lang: PreferredLanguage;
  cockpit: CockpitSalesAggregate;
}> {
  const fast = await loadCockpitExecutiveFast(requestedLocationId);
  return {
    mode: fast.mode,
    reason: fast.reason,
    lang: fast.lang,
    cockpit: fast.cockpit,
  };
}

export const loadSalesExplorerModel = cache(loadSalesExplorerModelUncached);

async function loadSalesExplorerModelUncached(
  requestedLocationId?: string
): Promise<SalesAreaModel> {
  const chrome = await loadRestaurantShellChrome();
  const resolved = await resolveCockpitScope(requestedLocationId);
  if (!resolved.ok) {
    return {
      mode: "sample",
      reason: resolved.reason,
      lang: chrome.lang,
      cockpit: emptyCockpitSalesAggregate(),
      explorerRows: [],
      targets: {},
      displayCurrency: "USD",
    };
  }
  const started = Date.now();
  const [currency, timezone, pos, targets] = await Promise.all([
    resolveCompanyCurrency(resolved.supabase, resolved.scope.companyId),
    resolvePosTimezone(resolved.supabase, resolved.scope.companyId),
    loadCachedPosSalesRows(resolved.scope.companyId, resolved.scope.locationId),
    getRestaurantKpiTargets(resolved.supabase, resolved.scope.companyId).catch(
      (err) => {
        console.error("[loadSalesExplorerModel] targets:", err);
        return {} as TargetMap;
      }
    ),
  ]);
  if (pos.error) {
    return {
      mode: "live",
      lang: chrome.lang,
      cockpit: emptyCockpitSalesAggregate(timezone, currency),
      explorerRows: [],
      targets,
      displayCurrency: currency,
    };
  }
  if (pos.rows.length === 0) {
    return {
      mode: "sample",
      reason: "no_sales",
      lang: chrome.lang,
      cockpit: emptyCockpitSalesAggregate(timezone, currency),
      explorerRows: [],
      targets,
      displayCurrency: currency,
    };
  }
  const cockpit = buildCockpitSalesAggregate(pos.rows, { timezone, currency });
  const explorerRows = pos.rows.map(toExplorerRow);
  logCockpitTiming("sales", {
    totalMs: Date.now() - started,
    rows: explorerRows.length,
    pages: pos.pages ?? 0,
    payloadBytes: Buffer.byteLength(JSON.stringify(explorerRows)),
    location: resolved.scope.locationId,
  });
  applyCockpitServerTimingHeader();
  return {
    mode: "live",
    lang: chrome.lang,
    cockpit,
    explorerRows,
    targets,
    displayCurrency: currency,
  };
}

export const loadBothPeriodCostKpis = cache(loadBothPeriodCostKpisUncached);

async function loadBothPeriodCostKpisUncached(
  requestedLocationId: string | undefined,
  options: { timezone: string; currency: string }
): Promise<BothPeriodCostKpis> {
  return timeCockpitStep("costs", async () => {
    const empty: BothPeriodCostKpis = {
      last_7: null,
      month: null,
      source: "none",
    };
    const resolved = await resolveCockpitScope(requestedLocationId);
    if (!resolved.ok) return empty;
    const started = Date.now();
    const rpc = await loadCachedCockpitPosRollup(
      resolved.scope.companyId,
      resolved.scope.locationId,
      options.timezone,
      options.currency
    );
    const latestSaleDate = rpc.rollup?.period_to ?? null;
    const cacheKey = [
      resolved.scope.companyId,
      resolved.scope.locationId ?? "all",
      latestSaleDate ?? "none",
      rpc.rollup?.row_count ?? 0,
    ].join(":");
    const cached = readPeriodCostBundleCache(cacheKey);
    if (cached) {
      logCockpitTiming("costs", {
        ms: Date.now() - started,
        source: "memory",
        location: resolved.scope.locationId,
      });
      return cached;
    }

    const profitability = await loadCachedProfitability(
      resolved.scope.companyId,
      resolved.scope.locationId,
      resolved.scope.brandId
    );
    // R1-09a: same loader as Menú and Recetas, run for each period.
    if (profitability.dishEconomics && latestSaleDate) {
      const value = await periodCostKpisFromSharedLoader(
        resolved.scope.companyId,
        resolved.scope.locationId,
        latestSaleDate
      );
      writePeriodCostBundleCache(cacheKey, value);
      logCockpitTiming("costs", {
        ms: Date.now() - started,
        source: "dish-economics",
        location: resolved.scope.locationId,
      });
      return value;
    }
    const hasCompleteCost = profitability.marginRows.some(
      (row) =>
        row.cost.status === "complete" &&
        row.cost.cost !== null &&
        Number.isFinite(row.cost.cost)
    );
    if (!hasCompleteCost) {
      const emptyPair: PeriodCostPair = {
        cost: EMPTY_PERIOD_COST,
        previous_cost: EMPTY_PERIOD_COST,
      };
      const value: BothPeriodCostKpis = {
        last_7: emptyPair,
        month: emptyPair,
        source: "empty",
      };
      writePeriodCostBundleCache(cacheKey, value);
      logCockpitTiming("costs", {
        ms: Date.now() - started,
        source: "empty",
        location: resolved.scope.locationId,
      });
      return value;
    }

    const pos = await loadCachedPosSalesRows(
      resolved.scope.companyId,
      resolved.scope.locationId
    );
    if (pos.error || pos.rows.length === 0) return empty;
    const anchor = latestSaleDate ?? maxSaleDate(pos.rows, options.timezone);
    const value: BothPeriodCostKpis = {
      last_7: null,
      month: null,
      source: "rows",
    };
    for (const preset of ["last_7", "month"] as const) {
      const period = resolveCockpitPeriod(preset, anchor);
      if (!period) continue;
      value[preset] = {
        cost: periodCostKpisFromProductLines(
          productLinesFromCostRows(
            rowsInCockpitRange(pos.rows, period.current, options.timezone),
            options.currency
          ),
          itemCostLookupForPeriod(profitability, period.current.to),
          options.currency
        ),
        previous_cost: periodCostKpisFromProductLines(
          productLinesFromCostRows(
            rowsInCockpitRange(pos.rows, period.previous, options.timezone),
            options.currency
          ),
          itemCostLookupForPeriod(profitability, period.previous.to),
          options.currency
        ),
      };
    }
    writePeriodCostBundleCache(cacheKey, value);
    logCockpitTiming("costs", {
      ms: Date.now() - started,
      source: "rows",
      rows: pos.rows.length,
      location: resolved.scope.locationId,
      periods: (["last_7", "month"] as const).filter(
        (preset) => value[preset] != null
      ),
    });
    return value;
  });
}

async function periodCostKpisFromSharedLoader(
  companyId: string,
  locationId: string | null,
  anchor: string
): Promise<BothPeriodCostKpis> {
  const value: BothPeriodCostKpis = {
    last_7: null,
    month: null,
    source: "rows",
  };
  const kpisFor = async (range: InclusiveDateRange) => {
    const load = await loadDishEconomics(
      companyId,
      range.from,
      range.to,
      locationId
    );
    return load.ok
      ? periodCostKpisFromDishEconomics(load.result)
      : EMPTY_PERIOD_COST;
  };
  await Promise.all(
    (["last_7", "month"] as const).map(async (preset) => {
      const period = resolveCockpitPeriod(preset, anchor);
      if (!period) return;
      const [cost, previous] = await Promise.all([
        kpisFor(period.current),
        kpisFor(period.previous),
      ]);
      value[preset] = { cost, previous_cost: previous };
    })
  );
  return value;
}

export async function loadPeriodCostSnapshot(
  requestedLocationId: string | undefined,
  period: CockpitPeriod,
  options: { timezone: string; currency: string; lang: PreferredLanguage }
): Promise<CockpitPeriodSnapshot | null> {
  const both = await loadBothPeriodCostKpis(requestedLocationId, options);
  const pair = both[period.preset];
  if (!pair) return null;
  const resolved = await resolveCockpitScope(requestedLocationId);
  if (!resolved.ok) return null;
  const rpc = await loadCachedCockpitPosRollup(
    resolved.scope.companyId,
    resolved.scope.locationId,
    options.timezone,
    options.currency
  );
  const snapshot = rpc.rollup
    ? buildCockpitPeriodSnapshotFromRollup(rpc.rollup, period, {
        timezone: options.timezone,
        currency: options.currency,
        lang: options.lang,
      })
    : null;
  if (!snapshot) return null;
  return {
    ...snapshot,
    cost: pair.cost,
    previous_cost: pair.previous_cost,
  };
}

function rowsInCockpitRange(
  rows: CockpitFactRow[],
  range: InclusiveDateRange,
  timezone: string
): CockpitFactRow[] {
  return rows.filter((row) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) return false;
    const dateKey = localSaleDateKey(row, timezone);
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && inInclusiveRange(dateKey, range)
    );
  });
}

function itemCostLookupForPeriod(
  profitability: ProfitabilityData,
  asOfDate: string
) {
  const names = itemCostLookupFromMarginRows(profitability.marginRows);
  const costing = costingDataFromProfitability(profitability);
  if (!costing) return names;
  const costs = calculateAllMenuItemCosts(costing, { asOfDate });
  const unitCostByMenuItemId = new Map<string, number | null>();
  for (const [id, cost] of costs) {
    const complete =
      cost.status === "complete" &&
      cost.cost !== null &&
      Number.isFinite(cost.cost);
    unitCostByMenuItemId.set(id, complete ? cost.cost : null);
  }
  return {
    unitCostByMenuItemId,
    menuItemIdByRawName: names.menuItemIdByRawName,
  };
}

function maxSaleDate(rows: CockpitFactRow[], timezone: string): string | null {
  let max: string | null = null;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    const dateKey = localSaleDateKey(row, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (max === null || dateKey > max) max = dateKey;
  }
  return max;
}
