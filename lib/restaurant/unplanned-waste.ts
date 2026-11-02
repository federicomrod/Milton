// lib/restaurant/unplanned-waste.ts
//
// #408 · valuing unplanned waste. Pure, no I/O.
//   - AI drafts do not count; only CONFIRMED lines do.
//   - A confirmed line is valued at the effective cost of the report's day
//     (the same effectiveLineCost the recipe editor uses). No quantity or no
//     usable price = no value: it is counted and shown as «⚑ Falta», never $0.
//   - The month is projected at the daily average × days of the month.
//   - Unplanned waste never enters a dish cost.

import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import { convertUnitStr } from "@/lib/restaurant/units";

export type WasteStatus = "draft" | "confirmed";

export interface WasteLine {
  status: WasteStatus;
  /** Filled when the line was confirmed; null = no value. */
  value: number | null;
}

/** A price is usable only above 0 (never a free ingredient by accident). */
const usable = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export interface ValuedLine {
  unitCost: number;
  value: number;
}

/**
 * Value one line at the cost of its day: price (per price unit, as of the
 * day) × quantity, after the one loss factor that applies. Null when the
 * quantity or the price is missing, or the unit cannot be converted.
 */
export function valueWasteLine(i: {
  quantity: number | null;
  unit: string | null;
  price: number | null;
  priceUnit: string | null;
  ownLossPct: number | null;
  bufferPct: number;
}): ValuedLine | null {
  if (!usable(i.quantity) || !usable(i.price)) return null;
  let inPriceUnit = i.quantity;
  if (i.unit && i.priceUnit) {
    const c = convertUnitStr(i.quantity, i.unit, i.priceUnit);
    if (!c.ok) return null;
    inPriceUnit = c.value;
  }
  const e = effectiveLineCost({
    amount: i.price * inPriceUnit,
    kind: "ingredient",
    ownYieldLossPct: i.ownLossPct,
    insideMeasuredPrep: false,
    bufferPct: i.bufferPct,
  });
  if (e.effective === null || !usable(e.effective)) return null;
  const unitCost = e.effective / inPriceUnit;
  return { unitCost, value: e.effective };
}

export interface WasteSummary {
  /** Sum of the confirmed, valued lines. */
  amount: number;
  /** Confirmed lines (valued or not). */
  counted: number;
  /** Confirmed lines with no value: ⚑ Falta. */
  missing: number;
  /** Drafts waiting for a manager (not counted anywhere). */
  drafts: number;
}

export function summarizeWaste(lines: readonly WasteLine[]): WasteSummary {
  const s: WasteSummary = { amount: 0, counted: 0, missing: 0, drafts: 0 };
  for (const l of lines) {
    if (l.status !== "confirmed") {
      s.drafts += 1;
      continue;
    }
    s.counted += 1;
    if (l.value !== null && usable(l.value)) s.amount += l.value;
    else s.missing += 1;
  }
  s.amount = Math.round(s.amount * 100) / 100;
  return s;
}

/** The month's waste: the daily average of the days so far × the days of the month. */
export function projectMonthWaste(
  amountToDate: number,
  actualDays: number,
  daysInMonth: number
): number | null {
  if (!(actualDays > 0) || !(daysInMonth > 0)) return null;
  return Math.round((amountToDate / actualDays) * daysInMonth * 100) / 100;
}

export interface WastePlanVsReported {
  /** Planned waste as % of purchase cost (0–100). */
  plannedPct: number;
  /** Reported (confirmed, valued) waste as % of purchase cost (0–100). */
  reportedPct: number;
  /** Reported − planned, in money (positive = more waste than planned). */
  difference: number;
}

/**
 * «Hasta ayer, de lo que compraste: planeaste X% de merma, reportaste Y%: $Z de
 * diferencia». X is the loss the recipes plan for (each purchase at its
 * ingredient's own yield, else the buffer); Y counts only valued confirmed
 * lines. Null without purchases.
 */
export function planVsReported(i: {
  purchases: number;
  planned: number;
  reported: number;
}): WastePlanVsReported | null {
  if (!usable(i.purchases)) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    plannedPct: r((i.planned / i.purchases) * 100),
    reportedPct: r((i.reported / i.purchases) * 100),
    difference: Math.round((i.reported - i.planned) * 100) / 100,
  };
}

/** Planned waste in money: each purchase × the loss % that applies to it. */
export function plannedWaste(
  purchases: ReadonlyArray<{ cost: number; lossPct: number }>
): number {
  let sum = 0;
  for (const p of purchases)
    if (usable(p.cost) && p.lossPct > 0) sum += p.cost * (p.lossPct / 100);
  return Math.round(sum * 100) / 100;
}
