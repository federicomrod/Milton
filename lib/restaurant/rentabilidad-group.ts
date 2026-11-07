// lib/restaurant/rentabilidad-group.ts
//
// Rentabilidad #402: «Todos los restaurantes». One line per restaurant (from
// the same `computeRentabilidad` month the single-restaurant page shows) plus
// a Todos total. Pure functions, no I/O, no React.
//
//   Todos = the exact sum of the lines AS SHOWN, to the cent (integer cents, so
//   the total can never drift from what the lines add up to). The group
//   cost split is already exact: each line's fixed costs include its share,
//   split by largest remainder in fixed-costs.ts (splitGroupAmount).
//   Different currencies: no total, and the caller says why.
//   Missing is null, never 0: a missing fixed cost makes that line's profit,
//   and the Todos profit, «⚑ Falta».

import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";

export interface GroupLineInput {
  locationId: string;
  name: string;
  currency: string;
  month: RentabilidadMonth;
}

export interface GroupLine {
  locationId: string;
  name: string;
  currency: string;
  /** False when the restaurant sold nothing in the month. */
  hasData: boolean;
  sales: number;
  /** Margen bruto in money, and as a share of sales (0–1). */
  margin: number;
  marginPct: number | null;
  /** Includes the restaurant's share of the group costs; null = a cost is missing. */
  fixedTotal: number | null;
  missingFixed: boolean;
  profit: number | null;
  /** A fixed cost used is a Milton estimate. */
  estimate: boolean;
  breakEvenDay: { day: number; projected: boolean } | null;
  /** Share of food sales without a recipe cost (0–1), only when the flag shows. */
  uncoveredPct: number | null;
}

export interface GroupTotal {
  sales: number;
  margin: number;
  marginPct: number | null;
  fixedTotal: number | null;
  profit: number | null;
  /** «Ganancia estimada»: at least one line has an estimate. */
  estimate: boolean;
  breakEvenDay: { day: number; projected: boolean } | null;
  /** Names of the lines that stop fixedTotal / profit from being a number. */
  missingFixed: string[];
  noSales: string[];
}

export interface GroupView {
  lines: GroupLine[];
  /** null when the lines report in different currencies. */
  total: GroupTotal | null;
  /** The currencies found, when there is more than one. */
  currencies: string[];
  /** The single currency when there is a total. */
  currency: string | null;
}

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

export function groupLine(input: GroupLineInput): GroupLine {
  const m = input.month;
  const sales = fromCents(cents(m.monthTotals.sales));
  const be = m.breakEvenDay;
  const flagged =
    m.hasData &&
    m.coverage.uncovered.length > 0 &&
    m.coverage.uncoveredPct >= 0.0005;
  return {
    locationId: input.locationId,
    name: input.name,
    currency: input.currency,
    hasData: m.hasData,
    sales,
    margin: fromCents(cents(m.monthTotals.margin)),
    marginPct: m.monthTotals.marginPct,
    fixedTotal: m.fixed.total,
    missingFixed: m.fixed.total === null,
    profit: m.profit,
    estimate: m.basis === "estimada",
    breakEvenDay: be ? { day: be.day, projected: be.projected } : null,
    uncoveredPct: flagged ? m.coverage.uncoveredPct : null,
  };
}

/** First day the group's cumulative margin covers the group's fixed costs. */
function groupBreakEven(
  inputs: readonly GroupLineInput[],
  fixedTotal: number
): GroupTotal["breakEvenDay"] {
  const byDate = new Map<string, { cum: number; projected: boolean }>();
  for (const { month } of inputs) {
    for (const d of month.days) {
      const cur = byDate.get(d.date) ?? { cum: 0, projected: false };
      cur.cum += d.cumMargin;
      cur.projected = cur.projected || d.projected;
      byDate.set(d.date, cur);
    }
  }
  const dates = [...byDate.keys()].sort();
  const need = cents(fixedTotal);
  for (const date of dates) {
    const v = byDate.get(date)!;
    if (cents(v.cum) >= need)
      return { day: Number(date.slice(8, 10)), projected: v.projected };
  }
  return null;
}

export function buildGroupView(inputs: readonly GroupLineInput[]): GroupView {
  const lines = inputs.map(groupLine);
  const currencies = [...new Set(lines.map((l) => l.currency))];
  if (currencies.length > 1)
    return { lines, total: null, currencies, currency: null };

  let sales = 0;
  let margin = 0;
  let fixed: number | null = 0;
  let profit: number | null = 0;
  for (const l of lines) {
    sales += cents(l.sales);
    margin += cents(l.margin);
    fixed =
      fixed === null || l.fixedTotal === null
        ? null
        : fixed + cents(l.fixedTotal);
    profit =
      profit === null || l.profit === null ? null : profit + cents(l.profit);
  }
  const fixedTotal = fixed === null ? null : fromCents(fixed);
  return {
    lines,
    currencies,
    currency: currencies[0] ?? null,
    total: {
      sales: fromCents(sales),
      margin: fromCents(margin),
      marginPct: sales > 0 ? margin / sales : null,
      fixedTotal,
      profit: profit === null ? null : fromCents(profit),
      estimate: lines.some((l) => l.estimate),
      breakEvenDay:
        fixedTotal === null || sales <= 0
          ? null
          : groupBreakEven(inputs, fixedTotal),
      missingFixed: lines.filter((l) => l.missingFixed).map((l) => l.name),
      noSales: lines
        .filter((l) => !l.missingFixed && l.profit === null)
        .map((l) => l.name),
    },
  };
}
