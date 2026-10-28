// lib/restaurant/rentabilidad.ts
//
// Rentabilidad + Costos fijos, Fase 1a (#399, epic #415). Every formula of the
// Rentabilidad page, as pure functions (no I/O): one restaurant, one calendar
// month. `rentabilidad-server.ts` only loads the inputs.
//
//   Ventas netas        the Ventas page's net sales (tips out), by business day
//   Impuestos           Ventas × tasa ÷ (1 + tasa): a variable cost, out of the
//                       margin exactly once and never added to fixed costs
//   Comida y bebida     recipe cost × units of the dishes with an approved
//                       recipe in force. No gap-fill: an uncovered dish adds no
//                       cost, and a missing price is «Sin precio», never $0
//   Merma no planeada   an explicit input (0 until #408)
//   Costos fijos        the four amounts of #418 (confirmed lines only)
//
// Missing values are `null`, never 0.

import {
  AMOUNT_CATEGORIES,
  breakEvenPerDay,
  contributionMarginPct,
  daysInMonth,
  nextMonthStart,
  previousMonthStart,
  splitLargestRemainder,
  taxInSales,
  fixedCostCompleteness,
  type AmountCategory,
  type EffectiveFixedCosts,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";
import { displayName } from "@/lib/restaurant/sentence-case";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` of day `day` of `month` (`YYYY-MM-01`). */
export function dateOfDay(month: string, day: number): string {
  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` date. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The restaurant's business date for `now`: the local date in its timezone,
 * minus one day before the business-day cutoff (minutes after midnight).
 */
export function businessToday(
  now: Date,
  timeZone: string,
  cutoffMinutes = 0
): string {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const date = `${String(get("year")).padStart(4, "0")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`;
  const minutes = get("hour") * 60 + get("minute");
  return minutes < cutoffMinutes ? addDays(date, -1) : date;
}

// ---------------------------------------------------------------------------
// Food cost and coverage
// ---------------------------------------------------------------------------

/** One sold dish, as dish-economics reports it for the period. */
export interface SoldDish {
  /** The product id the recipe link opens (Menú › Platos). */
  odooProductId: number;
  name: string;
  netSales: number;
  units: number;
  /** Cost of one unit; null = unknown, never 0. */
  unitCost: number | null;
  /** Counted in the food cost (approved recipe in force, costed). */
  inCogs: boolean;
  /** Counted as covered sales (approved, or «sin costo», or combo parts). */
  covered: boolean;
  /** Out of food costing (not a dish): in neither side of the coverage. */
  excluded: boolean;
  /** dish-economics status: aprobado · borrador · sin_receta · falta_precio… */
  status: string;
}

export type UncoveredReason = "borrador" | "sin_receta" | "sin_precio";

export interface UncoveredDish {
  odooProductId: number;
  name: string;
  /** 0–1, share of the food sales. */
  share: number;
  netSales: number;
  reason: UncoveredReason;
  /** A draft recipe exists: the button is «Aprobar», else «Crear receta». */
  hasDraft: boolean;
}

export interface FoodCostInput {
  /** Σ unit cost × units of the dishes counted in the food cost. */
  cogs: number;
  /** Net sales of the dish list for the period (the base of `cogs`). */
  periodSales: number;
  /** Coverage denominator: periodSales minus the excluded products. */
  foodSales: number;
  coveredSales: number;
  uncovered: UncoveredDish[];
}

export const EMPTY_FOOD: FoodCostInput = {
  cogs: 0,
  periodSales: 0,
  foodSales: 0,
  coveredSales: 0,
  uncovered: [],
};

/**
 * Food cost and coverage from the sold dishes. Only dishes with a costed
 * approved recipe add cost; the rest are listed, never filled with an
 * estimate or an extrapolated %.
 */
export function foodCostFromDishes(dishes: readonly SoldDish[]): FoodCostInput {
  let cogs = 0;
  let periodSales = 0;
  let foodSales = 0;
  let coveredSales = 0;
  for (const d of dishes) {
    periodSales += d.netSales;
    if (d.excluded) continue;
    foodSales += d.netSales;
    if (d.covered) coveredSales += d.netSales;
    if (d.inCogs && d.unitCost !== null && Number.isFinite(d.unitCost))
      cogs += d.unitCost * d.units;
  }
  const uncovered: UncoveredDish[] = dishes
    .filter((d) => !d.excluded && !d.covered && d.netSales > 0)
    .map((d) => ({
      odooProductId: d.odooProductId,
      name: displayName(d.name),
      share: foodSales > 0 ? d.netSales / foodSales : 0,
      netSales: round2(d.netSales),
      reason: (d.status === "falta_precio"
        ? "sin_precio"
        : d.status === "borrador" || d.status === "estimado"
          ? "borrador"
          : "sin_receta") as UncoveredReason,
      hasDraft: d.status === "borrador" || d.status === "estimado",
    }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name, "es"));
  return {
    cogs: round2(cogs),
    periodSales: round2(periodSales),
    foodSales: round2(foodSales),
    coveredSales: round2(coveredSales),
    uncovered,
  };
}

// ---------------------------------------------------------------------------
// The month
// ---------------------------------------------------------------------------

export interface RentabilidadInput {
  /** `YYYY-MM-01`. */
  month: string;
  /** The restaurant's business date today (`YYYY-MM-DD`). */
  today: string;
  /**
   * Net sales by business date. Include the weeks before the month: the
   * projection reads the last 4 weeks of the same weekday. A date with no key
   * has no data.
   */
  dailySales: Readonly<Record<string, number>>;
  food: FoodCostInput;
  /** Unplanned waste over the actual days (0 until #408). */
  unplannedWaste?: number;
  /** The restaurant's own and shared fixed costs (confirmed lines only). */
  fixed: EffectiveFixedCosts;
  /** An included fixed-cost line is a Milton estimate. */
  fixedHasEstimate?: boolean;
  /** ISO weekdays the restaurant opens; null = every day. */
  openWeekdays: readonly number[] | null;
  /** Número de días que abres en el mes (openDaysInMonth). */
  openDays: number;
}

export interface DayRow {
  date: string;
  weekday: number;
  /** True for a day after yesterday (projection). */
  projected: boolean;
  sales: number;
  impuestos: number;
  food: number;
  waste: number;
  margin: number;
  cumMargin: number;
}

export interface PnlTotals {
  sales: number;
  impuestos: number;
  food: number;
  waste: number;
  margin: number;
  /** Margen bruto ÷ Ventas, 0–1; null without sales. */
  marginPct: number | null;
}

export interface Cada100Part {
  key:
    | "comida"
    | "merma"
    | "impuestos"
    | "planilla"
    | "alquiler"
    | "servicios"
    | "otros"
    | "ganancia";
  /** Tenths of a percent are kept: 31.0 → 31. */
  pct: number;
}

export interface WeekdayAverage {
  weekday: number;
  /** Average of the actual days of that weekday; null with none. */
  avg: number | null;
  days: number;
}

export interface Coverage {
  /** 0–1, covered sales ÷ the food sales. */
  pct: number;
  uncoveredPct: number;
  /** «Tus platos con receta dejan X% de margen» (covered dishes only), 0–1. */
  coveredMarginPct: number | null;
  uncovered: UncoveredDish[];
}

export interface RentabilidadMonth {
  month: string;
  /** Last day with actual data counted (0 = none yet). */
  actualDays: number;
  daysInMonth: number;
  isCurrentMonth: boolean;
  hasData: boolean;
  basis: "real" | "estimada";
  /** The tax rate is not set: the page says «se calcula con 0%». */
  impuestosUndefined: boolean;
  impuestosPct: number | null;
  /** Merma no planeada is not valued yet: the line says «Disponible pronto». */
  wasteAvailable: boolean;
  fixed: {
    amounts: Record<AmountCategory, number | null>;
    /** null = a category is missing. */
    total: number | null;
    missing: FixedCostCategory[];
    missingAmounts: AmountCategory[];
  };
  actual: PnlTotals;
  /** The full month: actual + projected days (current month); = actual when closed. */
  monthTotals: PnlTotals;
  /** Present only in the current month, always labelled as projection. */
  projection: PnlTotals | null;
  /** Cumulative margin through yesterday − the full month's fixed costs. */
  profitToDate: number | null;
  /** Month profit (the projection for the current month, else the actual). */
  profit: number | null;
  profitPct: number | null;
  breakEvenPerDay: number | null;
  /** First day the cumulative margin ≥ the month's fixed costs. */
  breakEvenDay: { date: string; day: number; projected: boolean } | null;
  avgSalesPerDay: number | null;
  weekdayAverages: WeekdayAverage[];
  costoPrimo: number | null;
  cada100: Cada100Part[] | null;
  /** True when the costs are above sales: the bar shows a loss. */
  cada100Loss: boolean;
  days: DayRow[];
  coverage: Coverage;
  openDays: number;
  openWeekdays: number[] | null;
}

function zeroTotals(): PnlTotals {
  return {
    sales: 0,
    impuestos: 0,
    food: 0,
    waste: 0,
    margin: 0,
    marginPct: null,
  };
}

function totalsOf(rows: readonly DayRow[]): PnlTotals {
  const t = zeroTotals();
  for (const r of rows) {
    t.sales += r.sales;
    t.impuestos += r.impuestos;
    t.food += r.food;
    t.waste += r.waste;
    t.margin += r.margin;
  }
  t.marginPct = t.sales > 0 ? t.margin / t.sales : null;
  return t;
}

/** Mean of the up-to-4 most recent same-weekday days on or before `last`. */
function weekdayProjection(
  dailySales: Readonly<Record<string, number>>,
  date: string,
  last: string
): number {
  // Walk back whole weeks from the first same weekday on or before `last`.
  let probe = date;
  while (probe > last) probe = addDays(probe, -7);
  const values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const v = dailySales[addDays(probe, -7 * i)];
    if (typeof v === "number") values.push(v);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function computeRentabilidad(
  input: RentabilidadInput
): RentabilidadMonth {
  const { month, today, food } = input;
  const total = daysInMonth(month);
  const yesterday = addDays(today, -1);
  const nextMonth = nextMonthStart(month);
  const isCurrentMonth = today >= month && today < nextMonth;
  const actualDays =
    today >= nextMonth
      ? total
      : isCurrentMonth
        ? Math.max(0, Math.min(total, Number(today.slice(8, 10)) - 1))
        : 0;

  const impuestosPct = input.fixed.impuestosPct;
  const completeness = fixedCostCompleteness(input.fixed);
  let fixedTotal: number | null = 0;
  for (const cat of AMOUNT_CATEGORIES) {
    const v = input.fixed.amounts[cat];
    fixedTotal = v === null || fixedTotal === null ? null : fixedTotal + v;
  }

  const foodRate = food.periodSales > 0 ? food.cogs / food.periodSales : 0;
  const waste = input.unplannedWaste ?? 0;
  const wastePerDay = actualDays > 0 ? waste / actualDays : 0;
  const open = input.openWeekdays ? new Set(input.openWeekdays) : null;

  const days: DayRow[] = [];
  let cum = 0;
  for (let day = 1; day <= total; day++) {
    const date = dateOfDay(month, day);
    const projected = day > actualDays;
    if (projected && !isCurrentMonth) break; // a closed or future month has no projection
    const weekday = isoWeekday(date);
    const sales = projected
      ? !open || open.has(weekday)
        ? weekdayProjection(input.dailySales, date, yesterday)
        : 0
      : (input.dailySales[date] ?? 0);
    const impuestos = taxInSales(sales, impuestosPct);
    const foodCost = sales * foodRate;
    const wasteDay = wastePerDay;
    const margin = sales - impuestos - foodCost - wasteDay;
    cum += margin;
    days.push({
      date,
      weekday,
      projected,
      sales,
      impuestos,
      food: foodCost,
      waste: wasteDay,
      margin,
      cumMargin: cum,
    });
  }

  const actualRows = days.filter((d) => !d.projected);
  const actual = totalsOf(actualRows);
  const full = totalsOf(days);
  const projection = isCurrentMonth && actualDays < total ? full : null;
  const monthTotals = full;

  const marginInputs =
    monthTotals.sales > 0
      ? {
          sales: monthTotals.sales,
          foodCost: monthTotals.food,
          unplannedWaste: monthTotals.waste,
        }
      : null;
  const cm = marginInputs
    ? contributionMarginPct(marginInputs, impuestosPct)
    : null;
  const profit =
    fixedTotal === null || !marginInputs || cm === null
      ? null
      : cm * marginInputs.sales - fixedTotal;
  const profitToDate =
    fixedTotal === null || actualDays === 0 ? null : actual.margin - fixedTotal;
  const breakEven = breakEvenPerDay({
    amounts: input.fixed.amounts,
    impuestosPct,
    margin: marginInputs,
    openDays: input.openDays,
  });

  let breakEvenDay: RentabilidadMonth["breakEvenDay"] = null;
  if (fixedTotal !== null) {
    const hit = days.find((d) => d.cumMargin >= (fixedTotal as number));
    if (hit)
      breakEvenDay = {
        date: hit.date,
        day: Number(hit.date.slice(8, 10)),
        projected: hit.projected,
      };
  }

  const withData = actualRows.filter((d) => d.date in input.dailySales);
  const weekdayAverages: WeekdayAverage[] = [1, 2, 3, 4, 5, 6, 7].map(
    (weekday) => {
      const rows = withData.filter((d) => d.weekday === weekday);
      return {
        weekday,
        days: rows.length,
        avg: rows.length
          ? rows.reduce((s, r) => s + r.sales, 0) / rows.length
          : null,
      };
    }
  );

  const planilla = input.fixed.amounts.planilla;
  const costoPrimo =
    planilla === null || monthTotals.sales <= 0
      ? null
      : (monthTotals.food + monthTotals.waste + planilla) / monthTotals.sales;

  let cada100: Cada100Part[] | null = null;
  let cada100Loss = false;
  if (fixedTotal !== null && profit !== null && monthTotals.sales > 0) {
    const s = monthTotals.sales;
    const costs: Array<[Cada100Part["key"], number]> = [
      ["comida", monthTotals.food],
      ["merma", monthTotals.waste],
    ];
    if (monthTotals.impuestos > 0)
      costs.push(["impuestos", monthTotals.impuestos]);
    costs.push(
      ["planilla", input.fixed.amounts.planilla ?? 0],
      ["alquiler", input.fixed.amounts.alquiler ?? 0],
      ["servicios", input.fixed.amounts.servicios ?? 0],
      ["otros", input.fixed.amounts.otros ?? 0]
    );
    cada100Loss = profit < 0;
    const parts = cada100Loss
      ? costs
      : [...costs, ["ganancia", profit] as [Cada100Part["key"], number]];
    const costShare = costs.reduce((a, [, v]) => a + v, 0) / s;
    // Tenths of a percent; the parts add to exactly 100 (1000 tenths).
    const target = cada100Loss ? Math.round(costShare * 1000) : 1000;
    const tenths = splitLargestRemainder(
      target,
      parts.map(([, v]) => Math.max(v, 0))
    );
    cada100 = parts.map(([key], i) => ({ key, pct: tenths[i] / 10 }));
  }

  const hasData = withData.length > 0 || monthTotals.sales > 0;
  const uncoveredPct =
    food.foodSales > 0 ? 1 - food.coveredSales / food.foodSales : 0;

  return {
    month,
    actualDays,
    daysInMonth: total,
    isCurrentMonth,
    hasData,
    basis: input.fixedHasEstimate ? "estimada" : "real",
    impuestosUndefined: impuestosPct === null,
    impuestosPct,
    wasteAvailable: false,
    fixed: {
      amounts: input.fixed.amounts,
      total: fixedTotal === null ? null : round2(fixedTotal),
      missing: completeness.missing,
      missingAmounts: completeness.missingAmounts,
    },
    actual,
    monthTotals,
    projection,
    profitToDate: profitToDate === null ? null : round2(profitToDate),
    profit: profit === null ? null : round2(profit),
    profitPct:
      profit === null || monthTotals.sales <= 0
        ? null
        : profit / monthTotals.sales,
    breakEvenPerDay: breakEven === null ? null : round2(breakEven),
    breakEvenDay,
    avgSalesPerDay: withData.length
      ? withData.reduce((s, r) => s + r.sales, 0) / withData.length
      : null,
    weekdayAverages,
    costoPrimo,
    cada100,
    cada100Loss,
    days,
    coverage: {
      pct: food.foodSales > 0 ? food.coveredSales / food.foodSales : 0,
      uncoveredPct: Math.max(0, uncoveredPct),
      coveredMarginPct:
        food.coveredSales > 0
          ? (food.coveredSales - food.cogs) / food.coveredSales
          : null,
      uncovered: food.uncovered,
    },
    openDays: input.openDays,
    openWeekdays: input.openWeekdays ? [...input.openWeekdays] : null,
  };
}

// ---------------------------------------------------------------------------
// Real-only accessor and comparison chips
// ---------------------------------------------------------------------------

export interface RealRentabilidad {
  month: string;
  profit: number | null;
  profitToDate: number | null;
  breakEvenPerDay: number | null;
  breakEvenDay: number | null;
}

/**
 * The numbers anything outside the Rentabilidad page may use (Cockpit,
 * Objetivos, the daily email, the comparison chips). null whenever an
 * included input is a Milton estimate: an estimate never leaves this page.
 */
export function realOnly(month: RentabilidadMonth): RealRentabilidad | null {
  if (month.basis !== "real") return null;
  return {
    month: month.month,
    profit: month.profit,
    profitToDate: month.profitToDate,
    breakEvenPerDay: month.breakEvenPerDay,
    breakEvenDay: month.breakEvenDay ? month.breakEvenDay.day : null,
  };
}

export interface ComparisonChips {
  /** Positive = the día de equilibrio came N days earlier than last month. */
  daysEarlier: number | null;
  /** This month's profit − last month's, in money. */
  profitDelta: number | null;
}

/** null when either month includes an estimate (real numbers only). */
export function comparisonChips(
  current: RentabilidadMonth,
  previous: RentabilidadMonth | null
): ComparisonChips | null {
  if (!previous) return null;
  const a = realOnly(current);
  const b = realOnly(previous);
  if (!a || !b) return null;
  const daysEarlier =
    a.breakEvenDay !== null && b.breakEvenDay !== null
      ? b.breakEvenDay - a.breakEvenDay
      : null;
  const profitDelta =
    a.profit !== null && b.profit !== null ? round2(a.profit - b.profit) : null;
  if (daysEarlier === null && profitDelta === null) return null;
  return { daysEarlier, profitDelta };
}

export { previousMonthStart };

// ---------------------------------------------------------------------------
// Template findings (no AI)
// ---------------------------------------------------------------------------

export interface MiltonFinding {
  kind: "below_break_even" | "best_weekday";
  weekdays: number[];
  /** The weekday that pays the difference (kind = below_break_even). */
  payerWeekday?: number;
  amounts: Record<string, number>;
}

/**
 * Findings from real numbers: the weekdays whose average sales are below the
 * daily break-even, and the weekday that pays the difference.
 */
export function miltonFindings(month: RentabilidadMonth): MiltonFinding[] {
  const be = month.breakEvenPerDay;
  if (be === null) return [];
  const known = month.weekdayAverages.filter(
    (w): w is WeekdayAverage & { avg: number } => w.avg !== null
  );
  if (known.length < 2) return [];
  const below = known.filter((w) => w.avg < be);
  const out: MiltonFinding[] = [];
  if (below.length > 0) {
    const best = known.reduce((a, b) => (b.avg > a.avg ? b : a));
    out.push({
      kind: "below_break_even",
      weekdays: below.map((w) => w.weekday),
      payerWeekday: best.avg >= be ? best.weekday : undefined,
      amounts: {
        breakEven: be,
        best: best.avg,
        lowest: Math.min(...below.map((w) => w.avg)),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ganancia real vs estimada helpers
// ---------------------------------------------------------------------------

export type { AmountCategory, EffectiveFixedCosts };
