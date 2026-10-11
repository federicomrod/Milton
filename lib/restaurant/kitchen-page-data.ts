// lib/restaurant/kitchen-page-data.ts
//
// Kitchen page loader (#148). Same shell / period as Sales (#135).
// Insights stay in kitchen-insights.ts. No KPI math in React.

import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { loadCockpitExecutiveFast } from "@/lib/restaurant/cockpit-page-data";
import {
  applyCockpitServerTimingHeader,
  logCockpitTiming,
  timeCockpitStep,
} from "@/lib/restaurant/cockpit-timing";
import {
  parseCockpitPeriodPreset,
  resolveCockpitPeriod,
  type CockpitPeriod,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import {
  formatCompactDateRange,
  shiftDateKey,
} from "@/lib/restaurant/cockpit-aggregates";
import { cockpitComparisonPhrases } from "@/lib/restaurant/cockpit-executive";
import {
  cockpitFactsDataVersion,
  cockpitInsightCacheKey,
  hashCockpitInsightFacts,
} from "@/lib/restaurant/cockpit-insights-ai";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  fetchKitchenAttentionBundle,
  localKitchenInstant,
} from "@/lib/restaurant/kitchen-attention";
import {
  buildKitchenInsights,
  type KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";

export interface KitchenPageModel {
  lang: PreferredLanguage;
  timezone: string;
  currency: string;
  periodPreset: CockpitPeriodPreset;
  period: CockpitPeriod | null;
  comparisonLabel: string | null;
  locationId: string | null;
  companyId: string | null;
  canManage: boolean;
  locations: { id: string; name: string }[];
  insights: KitchenInsights | null;
  insightCacheKey: string;
  source: "rpc" | "rows" | "denied" | "none";
}

function todayKeyInZone(timezone: string): string {
  return localKitchenInstant(new Date().toISOString(), timezone).dateKey;
}

export async function loadKitchenPageModel(
  requestedLocationId?: string,
  periodRaw?: string | null
): Promise<KitchenPageModel> {
  const started = Date.now();
  const periodPreset = parseCockpitPeriodPreset(periodRaw);
  const chrome = await loadRestaurantShellChrome();
  const lang = chrome.lang;
  const finish = (extra: Record<string, unknown> = {}) => {
    logCockpitTiming("kitchen-page", {
      totalMs: Date.now() - started,
      period: periodPreset,
      location: requestedLocationId ?? null,
      ...extra,
    });
    applyCockpitServerTimingHeader();
  };

  const supabase = await createClient();
  const user = await getCachedAuthUser();
  if (!user?.id) {
    finish({ source: "unauthenticated" });
    return emptyModel(lang, periodPreset);
  }
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) {
    finish({ source: "no_company" });
    return emptyModel(lang, periodPreset);
  }

  let locationId: string | null = null;
  if (requestedLocationId) {
    const context = await resolveRestaurantContext(
      supabase,
      companyId,
      requestedLocationId
    );
    locationId = context.selected?.locationId ?? null;
  }

  const [
    timezone,
    currency,
    isMiltonAdmin,
    membershipRole,
    locationsRes,
    fast,
  ] = await Promise.all([
    timeCockpitStep("kitchen-timezone", () =>
      resolvePosTimezone(supabase, companyId)
    ),
    timeCockpitStep("kitchen-currency", () =>
      resolveCompanyCurrency(supabase, companyId)
    ),
    isUserAdminServer(user.id),
    loadMembershipRole(companyId, user.id),
    supabase
      .from("restaurant_locations")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    loadCockpitExecutiveFast(requestedLocationId, periodRaw),
  ]);

  const canManage = canManageKitchenQr({ isMiltonAdmin, membershipRole });
  const locations = (locationsRes.data ?? []) as { id: string; name: string }[];

  const wallToday = todayKeyInZone(timezone);
  const saleAnchor = fast.cockpit.period_to;
  let period = resolveCockpitPeriod(periodPreset, saleAnchor);
  const fetchRange = period?.current ?? {
    from: shiftDateKey(wallToday, -62),
    to: wallToday,
  };

  const attention = await timeCockpitStep(
    "kitchen-events",
    () =>
      fetchKitchenAttentionBundle(supabase, {
        companyId,
        locationId,
        period: fetchRange,
        timezone,
      }),
    { location: locationId }
  );

  if (!period) {
    const latestEvent = [
      ...attention.bundle.reports.map((row) => row.local_date),
      ...attention.bundle.drafts.map((row) => row.local_date),
    ]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .at(-1);
    period = resolveCockpitPeriod(periodPreset, latestEvent ?? wallToday);
  }

  if (!period) {
    finish({ source: "no-period" });
    return {
      ...emptyModel(lang, periodPreset),
      timezone,
      currency,
      locationId,
      companyId,
      canManage,
      locations,
    };
  }

  const todayKey = period.current.to;

  const insights = buildKitchenInsights(attention.bundle, lang, {
    period: period.current,
    todayKey,
    periodLabel: formatCompactDateRange(
      period.current.from,
      period.current.to,
      lang === "es" ? "es" : "en-GB"
    ),
  });
  const phrases = cockpitComparisonPhrases(period, lang);
  const insightCacheKey = cockpitInsightCacheKey({
    companyId: `kitchen:${companyId}`,
    locationId,
    preset: period.preset,
    from: period.current.from,
    to: period.current.to,
    lang,
    factsHash: insights.insightFacts.length
      ? hashCockpitInsightFacts(insights.insightFacts)
      : "none",
    dataVersion: cockpitFactsDataVersion({
      latestSaleDate: todayKey,
      rowCount:
        attention.bundle.reports.length + attention.bundle.drafts.length,
    }),
  });

  finish({
    source: attention.source,
    reports: attention.bundle.reports.length,
    drafts: attention.bundle.drafts.length,
    location: locationId,
  });

  return {
    lang,
    timezone,
    currency,
    periodPreset,
    period,
    comparisonLabel: phrases.chipLabel,
    locationId,
    companyId,
    canManage,
    locations,
    insights,
    insightCacheKey,
    source: attention.source,
  };
}

function emptyModel(
  lang: PreferredLanguage,
  periodPreset: CockpitPeriodPreset
): KitchenPageModel {
  return {
    lang,
    timezone: "UTC",
    currency: "USD",
    periodPreset,
    period: null,
    comparisonLabel: null,
    locationId: null,
    companyId: null,
    canManage: false,
    locations: [],
    insights: null,
    insightCacheKey: "",
    source: "none",
  };
}
