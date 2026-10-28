// lib/restaurant/rentabilidad-server.ts
//
// Rentabilidad + Costos fijos, Fase 1a (#399). Loads the inputs of
// `rentabilidad.ts` for one restaurant and a few months and hands them to the
// pure functions. No formula lives here.
//
//   sales      the Ventas cube (loadSalesDetailCached: the SAME cached read the
//              Ventas page uses), net of tips, by business day. Never a second
//              revenue definition.
//   food cost  dish-economics once per month, costed as of the month's last day
//              (a closed month) or with today's prices (the current month).
//              Cached by (company, restaurant, month, costing date).
//   fixed      restaurant_fixed_costs (#418), confirmed lines only.
//
// A month is never read one day or one dish at a time.

import type { SupabaseClient } from "@supabase/supabase-js";
import { accessTokenOf, cacheClientFor } from "@/lib/restaurant/cache-client";
import {
  cachedForCompany,
  costingTag,
  salesTag,
} from "@/lib/restaurant/cache-tags";
import {
  loadDishCostContextWith,
  loadDishEconomicsWith,
  type DishCostContext,
} from "@/lib/restaurant/costing/dish-economics-server";
import type { DishEconomics } from "@/lib/restaurant/costing/dish-economics";
import { loadBusinessDayConfig } from "@/lib/restaurant/business-day-server";
import { cutoffFor } from "@/lib/restaurant/business-day";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { loadSalesDetailCached } from "@/lib/restaurant/sales-detail-server";
import type { DetailCube } from "@/lib/restaurant/sales-detail-cube";
import {
  groupSharesFor,
  listFixedCosts,
  type MarginRead,
} from "@/lib/restaurant/fixed-costs-server";
import {
  effectiveFixedCosts,
  nextMonthStart,
  openDaysInMonth,
  previousMonthStart,
} from "@/lib/restaurant/fixed-costs";
import {
  addDays,
  businessToday,
  comparisonChips,
  computeRentabilidad,
  EMPTY_FOOD,
  foodCostFromDishes,
  miltonFindings,
  type ComparisonChips,
  type FoodCostInput,
  type MiltonFinding,
  type RentabilidadMonth,
  type SoldDish,
} from "@/lib/restaurant/rentabilidad";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net sales by business date (tips out): the Ventas cube's `net`, summed per day. */
export function dailyNetSales(cube: DetailCube): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of cube.rows) {
    const date = cube.dates[row[0]];
    if (!date) continue;
    out[date] = (out[date] ?? 0) + row[8];
  }
  for (const date of Object.keys(out)) out[date] = round2(out[date]);
  return out;
}

export function toSoldDish(d: DishEconomics): SoldDish {
  return {
    odooProductId: d.odoo_product_id,
    name: d.menu_dish_name ?? d.name,
    netSales: d.net_sales,
    units: d.units_sold,
    unitCost: d.unit_cost,
    inCogs: d.in_cogs,
    covered: d.covered,
    excluded: !!d.excluded_reason,
    status: d.status,
  };
}

export interface RentabilidadLoad {
  currency: string;
  timezone: string;
  /** The restaurant's business date today. */
  today: string;
  locationId: string;
  months: Record<string, RentabilidadMonth>;
}

export async function loadRentabilidad(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string;
  restaurantIds: string[];
  months: string[];
  now?: Date;
}): Promise<RentabilidadLoad> {
  const { supabase, companyId, locationId, restaurantIds } = args;
  const months = [...new Set(args.months)];
  const [currency, timezone, config, sales] = await Promise.all([
    resolveCompanyCurrency(supabase, companyId),
    resolvePosTimezone(supabase, companyId),
    loadBusinessDayConfig(supabase, companyId),
    loadSalesDetailCached(supabase, companyId, locationId),
  ]);
  const today = businessToday(
    args.now ?? new Date(),
    timezone,
    cutoffFor(config, locationId)
  );
  const yesterday = addDays(today, -1);
  const dailySales = dailyNetSales(sales.cube);

  const activeShifts = (config.shiftsByLocation.get(locationId) ?? []).filter(
    (s) => s.active !== false
  );
  const weekdays = [...new Set(activeShifts.flatMap((s) => s.weekdays ?? []))]
    .filter((d) => d >= 1 && d <= 7)
    .sort();

  // One recipes/prices context per request, read only when a month misses the cache.
  let contextP: Promise<
    { ok: true; context: DishCostContext } | { ok: false; error: string }
  > | null = null;
  const token = await accessTokenOf(supabase);
  const costContext = (client: SupabaseClient) => {
    contextP ??= loadDishCostContextWith(client, companyId);
    return contextP;
  };

  async function foodFor(month: string): Promise<FoodCostInput> {
    const monthEnd = addDays(nextMonthStart(month), -1);
    const to = monthEnd < yesterday ? monthEnd : yesterday;
    if (to < month) return EMPTY_FOOD; // nothing sold yet in this month
    // A closed month: the prices as of its last day. The current month: today's.
    const asOfDate = monthEnd < today ? monthEnd : null;
    const compute = async (client: SupabaseClient): Promise<FoodCostInput> => {
      const ctx = await costContext(client);
      if (!ctx.ok) throw new Error(ctx.error);
      const res = await loadDishEconomicsWith(
        client,
        { companyId, from: month, to, locationId, asOfDate },
        ctx.context
      );
      if (!res.ok) throw new Error(res.error);
      return foodCostFromDishes(res.result.dishes.map(toSoldDish));
    };
    if (!token) return compute(supabase);
    return cachedForCompany(
      {
        name: "rentabilidad-food",
        companyId,
        parts: {
          location: locationId,
          month,
          // closed month: its last day; current month: today's prices
          costingDate: asOfDate ?? `today-${today}`,
          to,
        },
        tags: [salesTag(companyId), costingTag(companyId)],
      },
      async () => compute(await cacheClientFor(token)),
      () => compute(supabase)
    );
  }

  async function fixedFor(month: string) {
    const [own, group] = await Promise.all([
      listFixedCosts(supabase, companyId, month, locationId),
      groupSharesFor(supabase, companyId, month, locationId, restaurantIds, {
        confirmedOnly: true,
      }),
    ]);
    const confirmed = own.filter((l) => l.status === "confirmed");
    return {
      costs: effectiveFixedCosts(confirmed, group.shares, group.impuestosPct),
      hasEstimate:
        confirmed.some((l) => l.source === "estimate") || group.hasEstimate,
    };
  }

  const results = await Promise.all(
    months.map(async (month) => {
      const [food, fixed] = await Promise.all([
        foodFor(month),
        fixedFor(month),
      ]);
      const monthEnd = addDays(nextMonthStart(month), -1);
      const windowTo = monthEnd < yesterday ? monthEnd : yesterday;
      // The food rate is cost ÷ the Ventas sales of the same days: the month's
      // food cost is exactly the dishes' cost, whatever the base they were read on.
      let windowSales = 0;
      for (const [date, v] of Object.entries(dailySales))
        if (date >= month && date <= windowTo) windowSales += v;
      return [
        month,
        computeRentabilidad({
          month,
          today,
          dailySales,
          food: { ...food, periodSales: round2(windowSales) },
          unplannedWaste: 0, // valuation arrives in #408
          fixed: fixed.costs,
          fixedHasEstimate: fixed.hasEstimate,
          openWeekdays: weekdays.length ? weekdays : null,
          openDays: openDaysInMonth(
            month,
            activeShifts.length
              ? activeShifts.map((s) => s.weekdays ?? [])
              : null
          ),
        }),
      ] as const;
    })
  );
  return {
    currency,
    timezone,
    today,
    locationId,
    months: Object.fromEntries(results),
  };
}

export interface RentabilidadPageData {
  currency: string;
  today: string;
  month: RentabilidadMonth;
  previous: RentabilidadMonth | null;
  chips: ComparisonChips | null;
  findings: MiltonFinding[];
}

/** The selected month plus the previous one (for the comparison chips). */
export async function loadRentabilidadPage(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string;
  restaurantIds: string[];
  month: string;
}): Promise<RentabilidadPageData> {
  const prev = previousMonthStart(args.month);
  const load = await loadRentabilidad({
    ...args,
    months: [args.month, prev],
  });
  const month = load.months[args.month];
  const previous = load.months[prev] ?? null;
  return {
    currency: load.currency,
    today: load.today,
    month,
    previous: previous && previous.hasData ? previous : null,
    chips: comparisonChips(
      month,
      previous && previous.hasData ? previous : null
    ),
    findings: miltonFindings(month),
  };
}

/**
 * The margin the Costos fijos tab uses: the same month numbers as the
 * Rentabilidad page (so both show the same break-even). The selected month
 * (projected, if it is the current one); with no sales yet, the last month
 * that has them.
 */
export async function loadMonthMargin(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string | null;
  restaurantIds: string[];
  month: string;
}): Promise<MarginRead> {
  if (!args.locationId)
    return {
      ok: false,
      reason:
        "El punto de equilibrio se calcula por restaurante: elige uno arriba.",
    };
  try {
    const prev = previousMonthStart(args.month);
    const load = await loadRentabilidad({
      supabase: args.supabase,
      companyId: args.companyId,
      locationId: args.locationId,
      restaurantIds: args.restaurantIds,
      months: [args.month, prev],
    });
    const pick = [load.months[args.month], load.months[prev]].find(
      (m) => m && m.monthTotals.sales > 0
    );
    if (!pick)
      return {
        ok: false,
        reason: "Aún no hay ventas para calcular el margen.",
      };
    return {
      ok: true,
      margin: {
        sales: pick.monthTotals.sales,
        foodCost: pick.monthTotals.food,
        unplannedWaste: pick.monthTotals.waste,
      },
    };
  } catch (err) {
    console.error("[rentabilidad] margin load failed:", err);
    return { ok: false, reason: "No se pudo leer el margen en este momento." };
  }
}
