// lib/restaurant/sales-page-data.ts
//
// Sales page loader (#130). Uses the request-level cached POS / rollup
// path from #136 (loadCockpitExecutiveFast + loadCachedPosSalesRows).
// Insights stay in sales-insights.ts. Explorer rows are not serialized
// here — detalle fetches them from /api/restaurant/cockpit-sales.

import {
  loadCockpitExecutiveFast,
  type CockpitExecutiveFastModel,
} from "@/lib/restaurant/cockpit-page-data";
import {
  applyCockpitServerTimingHeader,
  logCockpitTiming,
  timeCockpitStep,
} from "@/lib/restaurant/cockpit-timing";
import { loadCachedPosSalesRows } from "@/lib/restaurant/pos-read-cache";
import { createClient } from "@/lib/supabase/server";
import { rollupToCockpitSalesAggregate } from "@/lib/restaurant/cockpit-pos-rollup";
import {
  fetchSalesPeriodRollup,
  salesDayStatsFromRollup,
} from "@/lib/restaurant/sales-period-rollup";
import {
  buildCockpitSalesAggregate,
  type CockpitSalesAggregate,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  cockpitComparisonPhrases,
  type CockpitComparisonPhrases,
} from "@/lib/restaurant/cockpit-executive";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import {
  cockpitFactsDataVersion,
  cockpitInsightCacheKey,
  hashCockpitInsightFacts,
} from "@/lib/restaurant/cockpit-insights-ai";
import {
  parseCockpitPeriodPreset,
  resolveCockpitPeriod,
  type CockpitPeriod,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { SampleReason } from "@/lib/restaurant/supabase-sales";
import {
  buildSalesInsights,
  filterRowsForSalesPeriod,
  salesDayStatsFromRows,
  type SalesDayStats,
  type SalesInsights,
} from "@/lib/restaurant/sales-insights";

export interface SalesPageView {
  period: CockpitPeriod;
  periodPreset: CockpitPeriodPreset;
  comparisonLabel: string;
  phrases: CockpitComparisonPhrases;
  scoped: CockpitSalesAggregate;
  insights: SalesInsights;
  interpretationFact: CockpitInsightFact | null;
  interpretationCacheKey: string;
}

export interface SalesPageModel {
  mode: CockpitExecutiveFastModel["mode"];
  reason?: SampleReason;
  lang: PreferredLanguage;
  timezone: string;
  currency: string;
  periodPreset: CockpitPeriodPreset;
  latestSaleDate: string | null;
  sales: SalesPageView | null;
}

export async function loadSalesPageModel(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<SalesPageModel> {
  const started = Date.now();
  const periodPreset = parseCockpitPeriodPreset(periodRaw);
  const finish = (extra: Record<string, unknown> = {}) => {
    logCockpitTiming("sales-page", {
      totalMs: Date.now() - started,
      period: periodPreset,
      location: requestedLocationId ?? null,
      ...extra,
    });
    applyCockpitServerTimingHeader();
  };

  const fast = await loadCockpitExecutiveFast(requestedLocationId, periodRaw);
  const base = {
    mode: fast.mode,
    reason: fast.reason,
    lang: fast.lang,
    timezone: fast.timezone,
    currency: fast.currency,
    periodPreset,
    latestSaleDate: fast.cockpit.period_to,
  };

  if (fast.mode !== "live" || !fast.scope) {
    finish({ source: fast.mode });
    return { ...base, sales: null };
  }

  const scope = fast.scope;
  const period = resolveCockpitPeriod(periodPreset, fast.cockpit.period_to);
  if (!period) {
    finish({ source: "no-period", location: scope.locationId });
    return { ...base, sales: null };
  }

  // R1-14: the period's figures come from one SQL rollup (047); the raw row
  // walk below is the fallback when it is not applied.
  let scoped: CockpitSalesAggregate;
  let stats: SalesDayStats;
  let rowsReviewed = 0;
  const periodRead = await timeCockpitStep(
    "sales-period-rollup",
    async () =>
      fetchSalesPeriodRollup(await createClient(), {
        companyId: scope.companyId,
        locationId: scope.locationId,
        timezone: fast.timezone,
        currency: fast.currency,
        from: period.current.from,
        to: period.current.to,
      }),
    { location: scope.locationId }
  );
  if (periodRead.ok) {
    scoped = rollupToCockpitSalesAggregate(periodRead.rollup, {
      timezone: fast.timezone,
      currency: fast.currency,
    });
    stats = salesDayStatsFromRollup(periodRead.rollup);
    rowsReviewed = periodRead.rollup.row_count;
  } else {
    const pos = await timeCockpitStep(
      "sales-pos-rows",
      () => loadCachedPosSalesRows(scope.companyId, scope.locationId),
      { location: scope.locationId }
    );
    if (pos.error) {
      finish({ source: "pos-error", location: scope.locationId });
      return { ...base, sales: null };
    }
    const filtered = filterRowsForSalesPeriod(pos.rows, period, fast.timezone);
    scoped = buildCockpitSalesAggregate(filtered, {
      timezone: fast.timezone,
      currency: fast.currency,
    });
    stats = salesDayStatsFromRows(filtered, {
      timezone: fast.timezone,
      currency: fast.currency,
    });
    rowsReviewed = filtered.length;
  }
  const insights = buildSalesInsights(scoped, fast.lang, stats, {
    period: period.current,
  });
  const phrases = cockpitComparisonPhrases(period, fast.lang);
  const interpretationCacheKey = cockpitInsightCacheKey({
    companyId: `sales:${scope.companyId}`,
    locationId: scope.locationId,
    preset: period.preset,
    from: period.current.from,
    to: period.current.to,
    lang: fast.lang,
    factsHash: insights.interpretationFact
      ? hashCockpitInsightFacts([insights.interpretationFact])
      : "none",
    dataVersion: cockpitFactsDataVersion({
      latestSaleDate: fast.cockpit.period_to,
      rowCount: fast.rowCount,
    }),
  });

  finish({
    source: periodRead.ok ? "rpc" : "rows",
    filtered: rowsReviewed,
    location: scope.locationId,
  });
  return {
    ...base,
    sales: {
      period,
      periodPreset,
      comparisonLabel: phrases.chipLabel,
      phrases,
      scoped,
      insights,
      interpretationFact: insights.interpretationFact,
      interpretationCacheKey,
    },
  };
}
