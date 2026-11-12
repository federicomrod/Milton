// lib/restaurant/mobile-manager/rentabilidad.ts
//
// Rentabilidad for the phone: loadRentabilidadPage is the very function the web
// page calls (same cached Ventas cube, same food cost, same fixed costs, same
// computeRentabilidad). This file only picks the fields the screen draws; no
// profit, margin or break-even number is computed here.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadRentabilidadPage,
  loadRentabilidadPages,
  type RentabilidadPageData,
} from "@/lib/restaurant/rentabilidad-server";
import { dataReasons, type DataReasons } from "./data-quality";
import { findingText } from "@/lib/restaurant/rentabilidad-copy";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { monthStartOf, previousMonthStart } from "@/lib/restaurant/fixed-costs";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface RentabilidadPayload {
  currency: string;
  locationId: string;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  isCurrentMonth: boolean;
  hasData: boolean;
  /** «estimada»: an included input is a Milton estimate; the screen says so. */
  basis: "real" | "estimada";
  sales: number | null;
  /** Estimated profit of the month (the projection for the current one). */
  profit: number | null;
  profitPct: number | null;
  breakEven: {
    perDay: number | null;
    /**
     * A per-day figure from only the confirmed categories (status "partial").
     * Separate from `perDay` so an older app build never shows it unlabelled.
     */
    partialPerDay: number | null;
    /** Sales the month needs to cover its costs: the web's per-day figure × its open days. */
    monthSales: number | null;
    avgSalesPerDay: number | null;
    day: number | null;
    daysInMonth: number;
    actualDays: number;
    /**
     * "complete" | "partial" | "unavailable" from the shared fixed-cost engine.
     * A partial per-day figure uses only the confirmed categories: label it as
     * such. Added field; older app builds ignore it.
     */
    status: "complete" | "partial" | "unavailable";
    /** What keeps it from being complete (category names, "impuestos", "margin", "open_days"). */
    missing: string[];
  };
  cada100: Array<{ key: string; pct: number }> | null;
  cada100Loss: boolean;
  fixedTotal: number | null;
  foodCostPct: number | null;
  /** Sentences from the web copy, in the app's language. */
  findings: string[];
  /** Parallel to `findings`: which finding it is (for the icon). */
  findingKinds: string[];
  /** Why a figure of THIS month is missing, and how complete its data is. */
  reasons: DataReasons;
  /**
   * Only on the current month when it cannot show a profit yet: the most recent
   * earlier month that can, whole, so the app labels it as that month. Never
   * a projection for another month; null when there is none (or not asked).
   */
  latest: RentabilidadPayload | null;
}

/** How far back to look for the most recent month with data. */
export const LATEST_LOOKBACK_MONTHS = 6;

export function parseMonth(raw: string | null): string | null | "invalid" {
  if (raw === null || raw === "") return null;
  const m = monthStartOf(raw);
  return m ?? "invalid";
}

export function shapeRentabilidad(
  data: RentabilidadPageData,
  locationId: string,
  lang: PreferredLanguage
): RentabilidadPayload {
  const m = data.month;
  const money = (n: number) => formatMoney(n, data.currency, lang);
  return {
    currency: data.currency,
    locationId,
    month: m.month,
    isCurrentMonth: m.isCurrentMonth,
    hasData: m.hasData,
    basis: m.basis,
    sales: m.hasData ? m.monthTotals.sales : null,
    profit: m.profit,
    profitPct: m.profitPct,
    breakEven: {
      perDay: m.figures.status === "complete" ? m.breakEvenPerDay : null,
      partialPerDay: m.figures.status === "partial" ? m.breakEvenPerDay : null,
      monthSales:
        m.figures.status !== "complete" || m.breakEvenPerDay === null
          ? null
          : Math.round(m.breakEvenPerDay * m.openDays),
      avgSalesPerDay: m.avgSalesPerDay,
      day: m.breakEvenDay ? m.breakEvenDay.day : null,
      daysInMonth: m.daysInMonth,
      actualDays: m.actualDays,
      status: m.figures.status,
      missing: m.figures.missing.map((x) =>
        x.kind === "category"
          ? x.category
          : x.kind === "tax"
            ? "impuestos"
            : x.kind === "margin"
              ? "margin"
              : "open_days"
      ),
    },
    cada100: m.cada100
      ? m.cada100.map((p) => ({ key: p.key, pct: p.pct }))
      : null,
    cada100Loss: m.cada100Loss,
    fixedTotal: m.fixed.total,
    // The web's own «De cada $100» share for food; no ratio is computed here.
    foodCostPct: m.cada100?.find((p) => p.key === "comida")?.pct ?? null,
    findings: data.findings.map((f) => findingText(f, m, money, lang)),
    findingKinds: data.findings.map((f) => f.kind),
    reasons: dataReasons(m),
    latest: null,
  };
}

export async function buildRentabilidad(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string;
  restaurantIds: string[];
  month: string;
  lang: PreferredLanguage;
}): Promise<RentabilidadPayload> {
  const data = await loadRentabilidadPage({
    supabase: args.supabase,
    companyId: args.companyId,
    locationId: args.locationId,
    restaurantIds: args.restaurantIds,
    month: args.month,
  });
  return shapeRentabilidad(data, args.locationId, args.lang);
}

/** A month the screen can lead with: it has sales and a profit figure. */
const hasProfit = (p: RentabilidadPayload) => p.hasData && p.profit !== null;

/**
 * The current month, and — when it has no profit figure yet — the most recent
 * earlier month that does (`latest`), found in one shared load.
 */
export async function buildRentabilidadWithLatest(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string;
  restaurantIds: string[];
  month: string;
  lang: PreferredLanguage;
}): Promise<RentabilidadPayload> {
  const { lang, month, locationId, ...rest } = args;
  const earlier: string[] = [];
  for (let i = 0, m = month; i < LATEST_LOOKBACK_MONTHS; i++) {
    m = previousMonthStart(m);
    earlier.push(m);
  }
  const pages = await loadRentabilidadPages({
    ...rest,
    locationId,
    months: [month, ...earlier],
  });
  const current = shapeRentabilidad(pages[month], locationId, lang);
  if (hasProfit(current)) return current;
  for (const m of earlier) {
    const candidate = shapeRentabilidad(pages[m], locationId, lang);
    if (hasProfit(candidate)) return { ...current, latest: candidate };
  }
  return current;
}
