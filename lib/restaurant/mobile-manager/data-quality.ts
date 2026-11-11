// lib/restaurant/mobile-manager/data-quality.ts
//
// Why a number is missing, and how complete the data behind a month is, for the
// phone's Costos and Rentabilidad. Pure: it only READS fields the web's
// computeRentabilidad already produced (coverage, fixed, monthTotals). No new
// financial figure is invented; a ratio is only ever one of those fields over
// another, and an unknown stays null.

import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";

export type FoodCostStatus = "ok" | "no_sales" | "no_costed_dishes";

export interface DataReasons {
  /** The month has sales (so a missing cost is not just «nothing sold yet»). */
  hasSales: boolean;
  foodCost: {
    /** ok = a food cost can be shown; otherwise the reason it cannot. */
    status: FoodCostStatus;
    /** Food cost ÷ sales, 0–100. The web's «De cada $100» share when there is one. */
    pct: number | null;
    /** Share of the month's dish sales that have a costed recipe, 0–1; null without dish sales. */
    coveredPct: number | null;
    /** Share without a cost, 0–1; null without dish sales. */
    uncoveredPct: number | null;
    /** Dishes sold this month without a cost. */
    uncoveredDishes: number;
    /** …by what is missing: no recipe, recipe still a draft, an ingredient without a price. */
    uncoveredByReason: {
      sinReceta: number;
      borrador: number;
      sinPrecio: number;
    };
  };
  fixed: {
    /** At least one fixed-cost category has an amount for the month. */
    loaded: boolean;
    /** Every category is there (the total is a real total). */
    complete: boolean;
    /** Categories still without an amount: planilla, alquiler, servicios, otros, impuestos. */
    missing: string[];
  };
  /** Planilla (staff) of the month, for Inicio's «Costo de personal». */
  staff: {
    /** The month has a planilla amount. */
    loaded: boolean;
    /** Planilla ÷ sales, 0–1: the web's own `planillaPct`; null when not loaded or no sales. */
    pct: number | null;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function dataReasons(m: RentabilidadMonth): DataReasons {
  const sales = m.monthTotals.sales;
  const hasSales = m.hasData && sales > 0;
  const cov = m.coverage;
  const hasDishSales =
    cov.pct > 0 || cov.uncoveredPct > 0 || cov.uncovered.length > 0;

  const status: FoodCostStatus = !hasSales
    ? "no_sales"
    : cov.pct <= 0
      ? "no_costed_dishes"
      : "ok";

  const webShare = m.cada100?.find((p) => p.key === "comida")?.pct ?? null;
  const pct =
    status !== "ok"
      ? null
      : (webShare ?? round1((m.monthTotals.food / sales) * 100));

  const byReason = { sinReceta: 0, borrador: 0, sinPrecio: 0 };
  for (const d of cov.uncovered) {
    if (d.reason === "sin_receta") byReason.sinReceta += 1;
    else if (d.reason === "borrador") byReason.borrador += 1;
    else if (d.reason === "sin_precio") byReason.sinPrecio += 1;
  }

  const amounts = Object.values(m.fixed.amounts ?? {});
  return {
    hasSales,
    foodCost: {
      status,
      pct,
      coveredPct: hasDishSales ? cov.pct : null,
      uncoveredPct: hasDishSales ? cov.uncoveredPct : null,
      uncoveredDishes: cov.uncovered.length,
      uncoveredByReason: byReason,
    },
    fixed: {
      loaded: amounts.some((v) => v !== null && v !== undefined),
      complete: m.fixed.total !== null,
      missing: [...m.fixed.missing],
    },
    staff: {
      loaded:
        m.fixed.amounts?.planilla !== null &&
        m.fixed.amounts?.planilla !== undefined,
      pct: hasSales ? (m.planillaPct ?? null) : null,
    },
  };
}
