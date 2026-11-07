// lib/restaurant/mobile-manager/rentabilidad.ts
//
// Rentabilidad for the phone: loadRentabilidadPage is the very function the web
// page calls (same cached Ventas cube, same food cost, same fixed costs, same
// computeRentabilidad). This file only picks the fields the screen draws; no
// profit, margin or break-even number is computed here.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadRentabilidadPage,
  type RentabilidadPageData,
} from "@/lib/restaurant/rentabilidad-server";
import { findingText } from "@/lib/restaurant/rentabilidad-copy";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";
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
    /** Sales the month needs to cover its costs: the web's per-day figure × its open days. */
    monthSales: number | null;
    avgSalesPerDay: number | null;
    day: number | null;
    daysInMonth: number;
    actualDays: number;
  };
  cada100: Array<{ key: string; pct: number }> | null;
  cada100Loss: boolean;
  fixedTotal: number | null;
  foodCostPct: number | null;
  /** Sentences from the web copy, in the app's language. */
  findings: string[];
  /** Parallel to `findings`: which finding it is (for the icon). */
  findingKinds: string[];
}

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
      perDay: m.breakEvenPerDay,
      monthSales:
        m.breakEvenPerDay === null
          ? null
          : Math.round(m.breakEvenPerDay * m.openDays),
      avgSalesPerDay: m.avgSalesPerDay,
      day: m.breakEvenDay ? m.breakEvenDay.day : null,
      daysInMonth: m.daysInMonth,
      actualDays: m.actualDays,
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
