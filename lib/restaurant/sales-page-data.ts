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

  const period = resolveCockpitPeriod(periodPreset, fast.cockpit.period_to);
  if (!period) {
    finish({ source: "no-period", location: fast.scope.locationId });
    return { ...base, sales: null };
  }

  const pos = await timeCockpitStep(
    "sales-pos-rows",
    () => loadCachedPosSalesRows(fast.scope.companyId, fast.scope.locationId),
    { location: fast.scope.locationId }
  );
  if (pos.error) {
    finish({ source: "pos-error", location: fast.scope.locationId });
    return { ...base, sales: null };
  }

  const filtered = filterRowsForSalesPeriod(pos.rows, period, fast.timezone);
  const scoped = buildCockpitSalesAggregate(filtered, {
    timezone: fast.timezone,
    currency: fast.currency,
  });
  const stats = salesDayStatsFromRows(filtered, {
    timezone: fast.timezone,
    currency: fast.currency,
  });
  const insights = buildSalesInsights(scoped, fast.lang, stats, {
    period: period.current,
  });
  const phrases = cockpitComparisonPhrases(period, fast.lang);
  const interpretationCacheKey = cockpitInsightCacheKey({
    companyId: `sales:${fast.scope.companyId}`,
    locationId: fast.scope.locationId,
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
    source: "live",
    rows: pos.rows.length,
    filtered: filtered.length,
    location: fast.scope.locationId,
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
