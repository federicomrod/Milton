// lib/restaurant/cockpit-math.ts
//
// R1-16: the arithmetic of the Cockpit and of the Objetivos references.
// Pure: dates are YYYY-MM-DD strings, nothing reads a clock or the network.
//
// Rules (Sofia's proposal §4)
//   * Trailing average daily sales = Σ sales in the window ÷ CALENDAR days of
//     the window. A closed day with no sales counts (it is a real day). Days
//     before the first POS day do not count: the window is cut to where the
//     data starts, and the caller says "solo N meses de datos".
//   * A % KPI (food cost, margin) over a window is Σ cost ÷ Σ sales — never
//     the average of daily percentages — and two of them are compared in
//     points.
//   * A comparison never lines a full period up against a partial one: the
//     other side has the same number of days, aligned by weekday.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { addDays, eachDay, weekdayIndex } from "@/lib/restaurant/objetivos";

export { addDays, eachDay, weekdayIndex };

export interface DayPoint {
  date: string;
  net_sales: number;
  tickets?: number;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    +from.slice(0, 4),
    +from.slice(5, 7) - 1,
    +from.slice(8, 10)
  );
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** `ymd` moved back by n calendar months (the day is clamped: 31 Mar − 1 month = 28/29 Feb). */
export function subMonths(ymd: string, n: number): string {
  const y = +ymd.slice(0, 4);
  const m = +ymd.slice(5, 7) - 1;
  const d = +ymd.slice(8, 10);
  const total = y * 12 + m - n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Sums and averages over calendar days
// ---------------------------------------------------------------------------

export function indexByDate(daily: readonly DayPoint[]): Map<string, DayPoint> {
  const m = new Map<string, DayPoint>();
  for (const d of daily) {
    const prev = m.get(d.date);
    m.set(
      d.date,
      prev
        ? {
            date: d.date,
            net_sales: prev.net_sales + d.net_sales,
            tickets: (prev.tickets ?? 0) + (d.tickets ?? 0),
          }
        : { ...d }
    );
  }
  return m;
}

export interface WindowSales {
  /** Σ sales ÷ calendar days; null when the window has no days. */
  avg: number | null;
  /** Calendar days counted (zero-sales days included; days before the data excluded). */
  days: number;
  sales: number;
  tickets: number;
  /** First day actually counted. */
  from: string;
  to: string;
}

/**
 * Σ sales ÷ calendar days over [from, to], cut to `firstDay` when the data
 * starts later. Days with no row count as 0 sales.
 */
export function windowSales(
  byDate: ReadonlyMap<string, DayPoint>,
  from: string,
  to: string,
  firstDay?: string | null
): WindowSales {
  const start = firstDay && firstDay > from ? firstDay : from;
  if (start > to)
    return { avg: null, days: 0, sales: 0, tickets: 0, from: start, to };
  let sales = 0;
  let tickets = 0;
  for (const day of eachDay(start, to)) {
    const p = byDate.get(day);
    if (p) {
      sales += p.net_sales;
      tickets += p.tickets ?? 0;
    }
  }
  const days = daysBetween(start, to);
  return { avg: sales / days, days, sales, tickets, from: start, to };
}

export interface TrailingWindow {
  from: string;
  to: string;
  /** The window was cut because the data starts later than N months ago. */
  cut: boolean;
  days: number;
}

/** N calendar months ending on `to`, cut to where the data starts. */
export function trailingWindow(
  to: string,
  months: number,
  firstDay: string | null
): TrailingWindow {
  const wanted = addDays(subMonths(to, months), 1);
  const cut = !!firstDay && firstDay > wanted;
  const from = cut ? (firstDay as string) : wanted;
  return { from, to, cut, days: from > to ? 0 : daysBetween(from, to) };
}

/** "solo 4 meses de datos" / "solo 20 días de datos" when the window is cut, else null. */
export function dataSpanNote(
  w: TrailingWindow,
  lang: PreferredLanguage = "es"
): string | null {
  if (!w.cut) return null;
  const d = getDictionary(lang).cockpit.dataSpan;
  if (w.days < 30)
    return fmt(w.days === 1 ? d.daysOne : d.daysOther, { n: w.days });
  const months = Math.floor(w.days / 30.4375);
  return fmt(months === 1 ? d.monthsOne : d.monthsOther, { n: months });
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

/** Percent change, one decimal; null when the base is 0 or missing (never ∞). */
export function pctChange(
  current: number | null,
  base: number | null
): number | null {
  if (current === null || base === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  if (base === 0) return current === 0 ? 0 : null;
  return Math.round(((current - base) / Math.abs(base)) * 1000) / 10;
}

/** Points between two percentages, one decimal. */
export function ptsChange(
  current: number | null,
  base: number | null
): number | null {
  if (current === null || base === null) return null;
  return Math.round((current - base) * 10) / 10;
}

/** Σ cost ÷ Σ sales as a percentage; null without sales (never 0, never NaN). */
export function ratioOfSums(cost: number, sales: number): number | null {
  return sales > 0 ? (cost / sales) * 100 : null;
}

export interface Range {
  from: string;
  to: string;
}

/** The same days, `n` days earlier (7 keeps the weekdays aligned). */
export function shiftRange(range: Range, n: number): Range {
  return { from: addDays(range.from, -n), to: addDays(range.to, -n) };
}

/**
 * "Mes pasado" for a period: the block of the same length that immediately
 * precedes it when the period is a month or longer (30 d vs the 30 d
 * before); a shorter period (Hoy, 7 d) goes back four weeks, so weekdays
 * stay aligned and a partial week is never set against a full one.
 */
export function previousMonthRange(range: Range): Range {
  const len = daysBetween(range.from, range.to);
  return shiftRange(range, len >= 28 ? len : 28);
}

/** "Semana pasada": the same days one week earlier. */
export function previousWeekRange(range: Range): Range {
  return shiftRange(range, 7);
}
