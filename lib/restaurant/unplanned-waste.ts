// lib/restaurant/unplanned-waste.ts
//
// #408 · valuing unplanned waste. Pure, no I/O.
//   - AI drafts do not count; only CONFIRMED lines do.
//   - A confirmed line is valued at the purchase price per as-bought unit (no
//     yield, no buffer: the merma is already in the dish cost). No quantity,
//     no unit or no usable price = «Sin costo»: its quantity is shown, it is
//     kept out of the $ total, and it is never $0.
//   - Drafts older than 7 days are «Vencido»: never counted, still confirmable.
//   - The month is projected at the average per OPEN day × the open days
//     left (calendar days only when no open days are set).
//   - Unplanned waste never enters a dish cost.

import { convertUnitStr } from "@/lib/restaurant/units";

export type WasteStatus = "draft" | "confirmed";

export interface WasteLine {
  status: WasteStatus;
  /** Filled when the line was confirmed; null = no value («Sin costo»). */
  value: number | null;
  /** Needed to tell a stale draft («Vencido») from a fresh one. */
  createdAt?: string;
}

/** A price is usable only above 0 (never a free ingredient by accident). */
const usable = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export interface ValuedLine {
  unitCost: number;
  value: number;
}

/**
 * Value one line at the purchase price per AS-BOUGHT unit (Sofia): price ×
 * quantity, with NO yield or buffer on top (the merma is already in the dish
 * cost, so adding it here would count it twice). The quantity must be in a
 * unit that converts to the price's unit: with no unit, no price unit or no
 * conversion the line has no cost (null), never the raw quantity read as if
 * it were in the price unit.
 */
export function valueWasteLine(i: {
  quantity: number | null;
  unit: string | null;
  price: number | null;
  priceUnit: string | null;
}): ValuedLine | null {
  if (!usable(i.quantity) || !usable(i.price)) return null;
  if (!i.unit || !i.priceUnit) return null;
  const c = convertUnitStr(i.quantity, i.unit, i.priceUnit);
  if (!c.ok || !usable(c.value)) return null;
  const value = i.price * c.value;
  if (!usable(value)) return null;
  return { unitCost: value / i.quantity, value };
}

/** Drafts left unconfirmed for this long are «Vencido» (never counted). */
export const DRAFT_EXPIRY_DAYS = 7;

export function isExpiredDraft(
  createdAt: string,
  now: Date = new Date()
): boolean {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > DRAFT_EXPIRY_DAYS * 86_400_000;
}

/** The first day of the Cocina history window (`YYYY-MM-DD`). */
export function historySince(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Share of the confirmed lines that have a cost, 0–100 (null without lines). */
export function valuedPct(counted: number, missing: number): number | null {
  if (!(counted > 0)) return null;
  return Math.round(((counted - missing) / counted) * 100);
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
  /** Of those drafts, the ones older than 7 days («Vencido»). */
  expired: number;
}

export function summarizeWaste(
  lines: readonly WasteLine[],
  now: Date = new Date()
): WasteSummary {
  const s: WasteSummary = {
    amount: 0,
    counted: 0,
    missing: 0,
    drafts: 0,
    expired: 0,
  };
  for (const l of lines) {
    if (l.status !== "confirmed") {
      s.drafts += 1;
      if (l.createdAt && isExpiredDraft(l.createdAt, now)) s.expired += 1;
      continue;
    }
    s.counted += 1;
    if (l.value !== null && usable(l.value)) s.amount += l.value;
    else s.missing += 1;
  }
  s.amount = Math.round(s.amount * 100) / 100;
  return s;
}

/**
 * The month's waste: the average per OPEN day so far × the open days of the
 * month (the same days the break-even uses). Pass calendar day counts only
 * when the restaurant has no open days set.
 */
export function projectMonthWaste(
  amountToDate: number,
  daysSoFar: number,
  daysInMonth: number
): number | null {
  if (!(daysSoFar > 0) || !(daysInMonth > 0)) return null;
  return Math.round((amountToDate / daysSoFar) * daysInMonth * 100) / 100;
}

export interface WastePlanVsReported {
  /** Planned waste as % of purchase cost (0–100). */
  plannedPct: number;
  /** Reported (confirmed, valued) waste as % of purchase cost (0–100). */
  reportedPct: number;
  /** Reported − planned, in money (positive = more waste than planned). */
  difference: number;
  /** Computed across ALL the company's restaurants (purchases are company-wide). */
  allRestaurants?: boolean;
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
  allRestaurants?: boolean;
}): WastePlanVsReported | null {
  if (!usable(i.purchases)) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    plannedPct: r((i.planned / i.purchases) * 100),
    reportedPct: r((i.reported / i.purchases) * 100),
    difference: Math.round((i.reported - i.planned) * 100) / 100,
    ...(i.allRestaurants ? { allRestaurants: true } : {}),
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
