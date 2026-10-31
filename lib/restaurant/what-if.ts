// lib/restaurant/what-if.ts
//
// «¿Y si…?» on Rentabilidad (#401). Pure functions, no I/O, no React: the
// panel starts from the month's real figures, the person changes sales, food
// cost %, Impuestos % or a fixed cost, and break-even and ganancia are
// recomputed here. Nothing is saved and nothing flows back into the real KPIs.
//
// Same formulas as the page (lib/restaurant/fixed-costs.ts):
//   Impuestos change the margen bruto (Ventas × tasa ÷ (1 + tasa) comes out of
//   the margin, once) and are never added to the fixed costs.
//   A missing fixed cost is null: the result is null («Falta»), never $0.

import {
  AMOUNT_CATEGORIES,
  breakEvenPerDay,
  contributionMarginPct,
  type AmountCategory,
} from "@/lib/restaurant/fixed-costs";
import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";

export interface WhatIfValues {
  /** Ventas del mes (full month: actual + projected days). */
  sales: number;
  /** Food cost as a percent of Ventas (31 = 31%); null when there are no sales to measure it. */
  foodPct: number | null;
  /** Impuestos rate in percent; null = not set (calculated as 0%, like the page). */
  impuestosPct: number | null;
  /** The four fixed costs; null = missing. */
  amounts: Record<AmountCategory, number | null>;
}

/** What does not change in a simulation. */
export interface WhatIfContext {
  /** Merma no planeada (0 until #408). */
  waste: number;
  /** Días que abres en el mes. */
  openDays: number;
}

export interface WhatIfResult {
  /** Margen bruto % (0–1); null without sales or food cost %. */
  marginPct: number | null;
  /** Sum of the four fixed costs; null when one is missing. */
  fixedTotal: number | null;
  /** Ventas − Impuestos − Comida − Merma − Costos fijos; null when anything it needs is missing. */
  profit: number | null;
  /** Ventas por día needed to cover the fixed costs; null when it cannot be calculated. */
  breakEvenPerDay: number | null;
  /** Impuestos in the month's sales (a variable cost, informational). */
  impuestos: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The real figures of the month, as the starting (and reset) values. */
export function whatIfBase(m: RentabilidadMonth): WhatIfValues {
  const sales = m.monthTotals.sales;
  return {
    sales,
    foodPct: sales > 0 ? (m.monthTotals.food / sales) * 100 : null,
    impuestosPct: m.impuestosPct,
    amounts: { ...m.fixed.amounts },
  };
}

export function whatIfContext(m: RentabilidadMonth): WhatIfContext {
  return { waste: m.monthTotals.waste, openDays: m.openDays };
}

export function sameValues(a: WhatIfValues, b: WhatIfValues): boolean {
  return (
    a.sales === b.sales &&
    a.foodPct === b.foodPct &&
    a.impuestosPct === b.impuestosPct &&
    AMOUNT_CATEGORIES.every((c) => a.amounts[c] === b.amounts[c])
  );
}

/** The real result of the month, straight from the server numbers. */
export function realResult(m: RentabilidadMonth): WhatIfResult {
  const sales = m.monthTotals.sales;
  const margin =
    sales > 0
      ? {
          sales,
          foodCost: m.monthTotals.food,
          unplannedWaste: m.monthTotals.waste,
        }
      : null;
  return {
    marginPct: margin ? contributionMarginPct(margin, m.impuestosPct) : null,
    fixedTotal: m.fixed.total,
    profit: m.profit,
    breakEvenPerDay: m.breakEvenPerDay,
    impuestos: m.monthTotals.impuestos,
  };
}

/**
 * The simulated result. When `values` equal the real figures the real result
 * is returned untouched, so «Restablecer» lands exactly on the server numbers.
 */
export function simulate(
  values: WhatIfValues,
  ctx: WhatIfContext,
  real?: { month: RentabilidadMonth }
): WhatIfResult {
  if (real && sameValues(values, whatIfBase(real.month)))
    return realResult(real.month);

  let fixedTotal: number | null = 0;
  for (const cat of AMOUNT_CATEGORIES) {
    const v = values.amounts[cat];
    fixedTotal =
      v === null || !Number.isFinite(v) || fixedTotal === null
        ? null
        : fixedTotal + v;
  }

  const salesOk = Number.isFinite(values.sales) && values.sales > 0;
  const foodOk = values.foodPct !== null && Number.isFinite(values.foodPct);
  const margin =
    salesOk && foodOk
      ? {
          sales: values.sales,
          foodCost: (values.sales * (values.foodPct as number)) / 100,
          unplannedWaste: ctx.waste,
        }
      : null;
  const marginPct = margin
    ? contributionMarginPct(margin, values.impuestosPct)
    : null;
  const profit =
    margin === null || marginPct === null || fixedTotal === null
      ? null
      : marginPct * margin.sales - fixedTotal;
  const be = breakEvenPerDay({
    amounts: values.amounts,
    impuestosPct: values.impuestosPct,
    margin,
    openDays: ctx.openDays,
  });
  const rate = (values.impuestosPct ?? 0) / 100;
  return {
    marginPct,
    fixedTotal: fixedTotal === null ? null : round2(fixedTotal),
    profit: profit === null ? null : round2(profit),
    breakEvenPerDay: be === null ? null : round2(be),
    impuestos: salesOk ? (values.sales * rate) / (1 + rate) : 0,
  };
}
