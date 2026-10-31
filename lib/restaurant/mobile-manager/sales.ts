// lib/restaurant/mobile-manager/sales.ts
//
// Ventas for the phone: the SAME cube and the SAME pure functions as Ventas ›
// Detalle on the web (loadSalesDetailCached, prepareCube, computeDetail), asked
// for the four ranges of the mockup. No sales math lives here: this file only
// chooses the dates and picks fields out of DetailView.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_STATE,
  computeDetail,
  prepareCube,
  type CompareKey,
  type DetailState,
  type DetailView,
} from "@/lib/restaurant/sales-detail";
import {
  loadSalesDetailCached,
  type SalesDetailPayload,
} from "@/lib/restaurant/sales-detail-server";
import {
  loadDishCostContextWith,
  loadDishEconomicsWith,
} from "@/lib/restaurant/costing/dish-economics-server";
import { addDays } from "@/lib/restaurant/rentabilidad";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export const VENTAS_PERIODS = ["day", "week", "month", "year"] as const;
export type VentasPeriod = (typeof VENTAS_PERIODS)[number];

export function parseVentasPeriod(raw: string | null): VentasPeriod | null {
  if (raw === null || raw === "") return "day";
  return (VENTAS_PERIODS as readonly string[]).includes(raw)
    ? (raw as VentasPeriod)
    : null;
}

/**
 * The range of a period, ending on the last day the cube has. Ayer compares
 * with the same weekday last week; the others with the period before.
 */
export function periodSpec(
  last: string,
  period: VentasPeriod
): { from: string; to: string; compare: CompareKey } {
  switch (period) {
    case "day":
      return { from: last, to: last, compare: "prev_week" };
    case "week":
      return { from: addDays(last, -6), to: last, compare: "prev_period" };
    case "month":
      return { from: addDays(last, -29), to: last, compare: "prev_period" };
    case "year":
      return { from: addDays(last, -364), to: last, compare: "prev_period" };
  }
}

function stateFor(
  range: { from: string; to: string },
  compare: CompareKey,
  over: Partial<DetailState> = {}
): DetailState {
  return {
    ...DEFAULT_STATE,
    period: "custom",
    from: range.from,
    to: range.to,
    compare,
    ...over,
  };
}

export function viewFor(
  payload: SalesDetailPayload,
  period: VentasPeriod,
  lang: PreferredLanguage,
  over: Partial<DetailState> = {}
): DetailView | null {
  const last = payload.cube.last_day;
  if (!last) return null;
  const spec = periodSpec(last, period);
  return computeDetail({
    prepared: prepareCube(payload.cube),
    state: stateFor(spec, spec.compare, over),
    targets: payload.targets,
    scope: {
      locationId: payload.locationId,
      restaurantIds: payload.restaurants.map((r) => r.id),
    },
    shiftsVisible: payload.shiftsVisible,
    lang,
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A year of days is drawn as twelve month bars (no previous bar: months differ in length). */
function monthlyBars(
  days: ReadonlyArray<{ date: string; net: number }>
): VentasPayload["daily"] {
  const byMonth = new Map<string, number>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + d.net);
  }
  return [...byMonth.entries()].map(([date, net]) => ({
    date,
    net: round2(net),
    previousNet: null,
  }));
}

export interface VentasPayload {
  period: VentasPeriod;
  currency: string;
  locationId: string | null;
  empty: boolean;
  range: { from: string; to: string } | null;
  /** The range was cut to what the data holds. */
  clipped: boolean;
  compareLabel: string | null;
  total: { value: number | null; delta: number | null };
  tickets: { value: number | null; delta: number | null };
  avgTicket: { value: number | null; delta: number | null };
  daily: Array<{ date: string; net: number; previousNet: number | null }>;
  channels: Array<{ label: string; net: number; share: number }>;
  /** null = the dish list could not be read (the screen says so). */
  dishes: Array<{ name: string; units: number; net: number }> | null;
}

export async function buildVentas(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string | null;
  period: VentasPeriod;
  lang: PreferredLanguage;
}): Promise<VentasPayload> {
  const { supabase, companyId, locationId, period, lang } = args;
  const payload = await loadSalesDetailCached(supabase, companyId, locationId);
  const base: VentasPayload = {
    period,
    currency: payload.currency,
    locationId,
    empty: true,
    range: null,
    clipped: false,
    compareLabel: null,
    total: { value: null, delta: null },
    tickets: { value: null, delta: null },
    avgTicket: { value: null, delta: null },
    daily: [],
    channels: [],
    dishes: [],
  };
  const view = viewFor(payload, period, lang, { dim: "canal" });
  if (!view) return base;

  // The same days of the comparison period, bar by bar.
  const previous = view.compare.baseline
    ? computeDetail({
        prepared: prepareCube(payload.cube),
        state: stateFor(view.compare.baseline.range, "prev_period"),
        targets: [],
        scope: {
          locationId: payload.locationId,
          restaurantIds: payload.restaurants.map((r) => r.id),
        },
        shiftsVisible: false,
        lang,
      })
    : null;

  let dishes: VentasPayload["dishes"] = null;
  try {
    const ctx = await loadDishCostContextWith(supabase, companyId);
    if (ctx.ok) {
      const res = await loadDishEconomicsWith(
        supabase,
        {
          companyId,
          from: view.range.from,
          to: view.range.to,
          locationId,
          asOfDate: null,
        },
        ctx.context
      );
      if (res.ok) {
        dishes = res.result.menu_dishes
          .filter((d) => !d.excluded_reason && d.net_sales > 0)
          .sort((a, b) => b.net_sales - a.net_sales)
          .map((d) => ({
            name: d.name,
            units: d.units,
            net: round2(d.net_sales),
          }));
      }
    }
  } catch (err) {
    console.error(
      "[mobile-ventas] dishes failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }

  return {
    ...base,
    empty: view.empty,
    range: view.range,
    clipped: view.clipped,
    compareLabel: view.compare.label,
    total: { value: view.kpis.net.value, delta: view.kpis.net.delta },
    tickets: {
      value: view.kpis.tickets.value,
      delta: view.kpis.tickets.delta,
    },
    avgTicket: {
      value: view.kpis.ticket.value,
      delta: view.kpis.ticket.delta,
    },
    daily:
      period === "year"
        ? monthlyBars(view.daily)
        : view.daily.map((d, i) => ({
            date: d.date,
            net: d.net,
            previousNet: previous?.daily[i]?.net ?? null,
          })),
    channels: view.dimRows.map((r) => ({
      label: r.label,
      net: r.net,
      share: round2(r.share),
    })),
    dishes,
  };
}
