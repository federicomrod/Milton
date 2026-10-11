// lib/restaurant/sales-page-data.ts
//
// Sales page loader (#130). Reuses the one paginated POS read from
// loadCockpitPageModel, then honours the cockpit period contract and
// builds deterministic sales insights. No extra POS round-trip.

import {
  loadCockpitPageModel,
  type CockpitPageModel,
} from "@/lib/restaurant/cockpit-page-data";
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
import type { ExplorerRow } from "@/lib/restaurant/supabase-sales";
import {
  buildSalesInsights,
  filterExplorerRowsForPeriod,
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
  explorerRows: ExplorerRow[];
  interpretationFact: CockpitInsightFact | null;
  interpretationCacheKey: string;
}

export interface SalesPageModel extends CockpitPageModel {
  sales: SalesPageView | null;
  periodPreset: CockpitPeriodPreset;
}

export async function loadSalesPageModel(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<SalesPageModel> {
  const periodPreset = parseCockpitPeriodPreset(periodRaw);
  const base = await loadCockpitPageModel(requestedLocationId);
  if (base.data.mode !== "live") {
    return { ...base, sales: null, periodPreset };
  }

  const lang = base.data.preferredLanguage;
  const period = resolveCockpitPeriod(
    periodPreset,
    base.data.cockpit.period_to
  );
  if (!period) {
    return { ...base, sales: null, periodPreset };
  }

  const timezone = base.data.timezone;
  const currency = base.data.cockpit.currency;
  const filtered = filterRowsForSalesPeriod(
    base.data.posFactRows,
    period,
    timezone
  );
  const scoped = buildCockpitSalesAggregate(filtered, { timezone, currency });
  const stats = salesDayStatsFromRows(filtered, { timezone, currency });
  const insights = buildSalesInsights(scoped, lang, stats);
  const explorerRows = filterExplorerRowsForPeriod(
    base.data.explorerRows,
    period
  );
  const phrases = cockpitComparisonPhrases(period, lang);
  const interpretationCacheKey = cockpitInsightCacheKey({
    companyId: `sales:${base.data.companyId}`,
    locationId: base.resolvedLocationId,
    preset: period.preset,
    from: period.current.from,
    to: period.current.to,
    lang,
    factsHash: insights.interpretationFact
      ? hashCockpitInsightFacts([insights.interpretationFact])
      : "none",
    dataVersion: cockpitFactsDataVersion({
      latestSaleDate: base.data.cockpit.period_to,
      rowCount: base.data.rowCount,
    }),
  });

  return {
    ...base,
    periodPreset,
    sales: {
      period,
      periodPreset,
      comparisonLabel: phrases.chipLabel,
      phrases,
      scoped,
      insights,
      explorerRows,
      interpretationFact: insights.interpretationFact,
      interpretationCacheKey,
    },
  };
}
