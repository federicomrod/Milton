// lib/restaurant/cockpit-page-data.ts
//
// Shared loader for the cockpit and the thin Sales / Menu / Costs routes.
// Same fetches as the original cockpit page — no KPI math lives here.

import { createClient } from "@/lib/supabase/server";
import {
  getRestaurantKpiTargets,
  type TargetMap,
} from "@/lib/restaurant/supabase-targets";
import {
  fetchRealRestaurantDashboardData,
  resolveCompanyIdForUser,
  type RestaurantDashboardData,
} from "@/lib/restaurant/supabase-sales";
import {
  fetchProfitabilityData,
  type ProfitabilityData,
} from "@/lib/restaurant/profitability-server";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  parseCockpitPeriodPreset,
  resolveCockpitPeriod,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import {
  buildCockpitHeadline,
  buildCockpitKpiStripModel,
  buildCockpitPeriodSnapshot,
  type CockpitKpiStripModel,
  type CockpitPeriodSnapshot,
} from "@/lib/restaurant/cockpit-executive";
import { buildCockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";
import type { CockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";
import {
  setupProgress,
  type SetupProgress,
} from "@/lib/restaurant/setup-progress";
import { selectCockpitInsights } from "@/lib/restaurant/cockpit-insights";
import {
  cockpitInsightCacheKey,
  wordCockpitInsights,
  type WordedCockpitInsights,
} from "@/lib/restaurant/cockpit-insights-ai";

export interface CockpitPageModel {
  data: RestaurantDashboardData;
  targets: TargetMap;
  profitability: ProfitabilityData | null;
}

export interface MenuAreaModel {
  profitability: ProfitabilityData | null;
}

export interface CockpitExecutiveView {
  snapshot: CockpitPeriodSnapshot;
  kpis: CockpitKpiStripModel;
  headline: string;
  insights: WordedCockpitInsights;
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

  try {
    const supabase = await createClient();

    let selectedLocationId: string | null = null;
    let selectedBrandId: string | null = null;
    if (requestedLocationId) {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.id) {
        const companyIdForContext = await resolveCompanyIdForUser(
          supabase,
          userData.user.id
        );
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
      try {
        targets = await getRestaurantKpiTargets(supabase, data.companyId);
      } catch (err) {
        console.error("[loadCockpitPageModel] targets load failed:", err);
        targets = {};
      }
      try {
        profitability = await fetchProfitabilityData(
          supabase,
          data.companyId,
          selectedLocationId
            ? { locationId: selectedLocationId, brandId: selectedBrandId }
            : null,
          data.readError ? undefined : { posRows: data.posFactRows }
        );
      } catch (err) {
        console.error("[loadCockpitPageModel] profitability load failed:", err);
        profitability = null;
      }
    }
  } catch (err) {
    console.error("[loadCockpitPageModel] Supabase init failed:", err);
    data = { mode: "sample", reason: "env_missing" };
  }

  return { data, targets, profitability };
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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { profitability: null };

    const companyId = await resolveCompanyIdForUser(supabase, user.id);
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

    const profitability = await fetchProfitabilityData(
      supabase,
      companyId,
      selectedLocationId
        ? { locationId: selectedLocationId, brandId: selectedBrandId }
        : null
    );
    return { profitability };
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
    thisWeek: base.data.cockpit.this_week ?? period.current,
    lastWeek: base.data.cockpit.last_week ?? period.previous,
    deltaPct: base.data.cockpit.week_delta_pct,
  };
  const kpis = buildCockpitKpiStripModel(snapshot, lang, week);
  const headline = buildCockpitHeadline(snapshot, lang);

  const recipeCoverage = recipeCoverageFromProfitability(base.profitability);
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
    costCoveragePct:
      base.profitability?.kpis.cost_coverage_pct ?? snapshot.cost.coverage_pct,
    lastSyncedAt: chrome.lastSyncedAt,
    posConnected: Boolean(chrome.lastSyncedAt) || base.data.rowCount > 0,
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

  const facts = selectCockpitInsights(snapshot, lang);
  const insights = await wordCockpitInsights(
    facts,
    lang,
    cockpitInsightCacheKey({
      companyId: base.data.companyId,
      locationId: requestedLocationId,
      preset: period.preset,
      from: period.current.from,
      to: period.current.to,
      lang,
    })
  );

  return {
    ...base,
    periodPreset,
    executive: {
      snapshot,
      kpis,
      headline,
      insights,
      health,
      setup,
      lastSyncedAt: chrome.lastSyncedAt,
    },
  };
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
