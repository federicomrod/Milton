// lib/restaurant/what-if.ts
//
// «¿Y si…?» on Rentabilidad (#401, compact panel). Pure functions, no I/O, no
// React. Three sliders move the month's real figures and the ganancia and the
// día de equilibrio are recomputed here. Nothing is saved and nothing flows
// back into the real KPIs.
//
//   Subir precios   sales rise by p%, the dishes sold stay the same: the
//                   food cost does not move.
//   Más clientes    sales AND food cost rise together by c%.
//   Costos fijos    a monthly amount added to (or taken from) the fixed costs.
//   Impuestos       the tax inside sales (Ventas × tasa ÷ (1 + tasa)) follows
//                   the new sales and comes out of the margin, never out of
//                   the fixed costs.
//
// Missing is null, never 0: a month with a missing fixed cost has no result.

import { taxInSales } from "@/lib/restaurant/fixed-costs";
import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";

export interface WhatIfSliders {
  /** Subir precios, in percent (3 = +3%). */
  pricePct: number;
  /** Más clientes, in percent (−10 = 10% fewer). */
  customersPct: number;
  /** Costos fijos: a monthly amount, in money. */
  fixedDelta: number;
}

export const ZERO_SLIDERS: WhatIfSliders = {
  pricePct: 0,
  customersPct: 0,
  fixedDelta: 0,
};

export interface WhatIfBreakEven {
  date: string;
  day: number;
  projected: boolean;
}

export interface WhatIfResult {
  /** Month profit; null when it cannot be calculated. */
  profit: number | null;
  /** First day the cumulative margin covers the fixed costs; null = not covered. */
  breakEven: WhatIfBreakEven | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isZero(s: WhatIfSliders): boolean {
  return s.pricePct === 0 && s.customersPct === 0 && s.fixedDelta === 0;
}

/** The real result of the month, straight from the server numbers. */
export function realResult(m: RentabilidadMonth): WhatIfResult {
  const be = m.breakEvenDay;
  return {
    profit: m.profit,
    breakEven: be
      ? { date: be.date, day: be.day, projected: be.projected }
      : null,
  };
}

/**
 * The simulated result. With every slider at zero the real result is returned
 * untouched, so «Restablecer» lands exactly on the server's figures.
 */
export function simulate(m: RentabilidadMonth, s: WhatIfSliders): WhatIfResult {
  if (isZero(s)) return realResult(m);
  const fixedBase = m.fixed.total;
  if (fixedBase === null || m.days.length === 0)
    return { profit: null, breakEven: null };

  const salesFactor = (1 + s.pricePct / 100) * (1 + s.customersPct / 100);
  const foodFactor = 1 + s.customersPct / 100;
  const fixed = Math.max(0, fixedBase + s.fixedDelta);
  const need = Math.round(fixed * 100);

  let cum = 0;
  let hit: WhatIfBreakEven | null = null;
  for (const d of m.days) {
    const sales = d.sales * salesFactor;
    const margin =
      sales - taxInSales(sales, m.impuestosPct) - d.food * foodFactor - d.waste;
    cum += margin;
    if (hit === null && Math.round(cum * 100) >= need)
      hit = {
        date: d.date,
        day: Number(d.date.slice(8, 10)),
        projected: d.projected,
      };
  }
  return { profit: round2(cum - fixed), breakEven: hit };
}

/** Slider range for «Costos fijos»: ±25% of the month's fixed costs, in steps of 50 or 100. */
export function fixedRange(fixedTotal: number | null): {
  min: number;
  max: number;
  step: number;
} {
  const base = fixedTotal ?? 0;
  const max = Math.max(500, Math.round((base * 0.25) / 100) * 100);
  return { min: -max, max, step: max >= 5000 ? 100 : 50 };
}
