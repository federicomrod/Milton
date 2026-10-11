// lib/restaurant/cockpit-period.ts
//
// Date-range contract for the executive Cockpit (#129). The header toggle
// is last 7 days vs the 7 before, or the calendar month of the latest
// sale vs the month before. Windows are anchored to the latest local
// sale_date (same as weekWindowsFromAnchor) so July staging data still
// compares against July, not the wall-clock month.
//
// Loaders honour this contract. React never computes the windows.

import {
  WEEK_LENGTH_DAYS,
  shiftDateKey,
} from "@/lib/restaurant/cockpit-aggregates";

export const COCKPIT_PERIOD_PARAM = "period";

export type CockpitPeriodPreset = "last_7" | "month";

export const DEFAULT_COCKPIT_PERIOD: CockpitPeriodPreset = "last_7";

export interface InclusiveDateRange {
  from: string;
  to: string;
}

export interface CockpitPeriod {
  preset: CockpitPeriodPreset;
  current: InclusiveDateRange;
  previous: InclusiveDateRange;
}

export function parseCockpitPeriodPreset(
  raw: string | null | undefined
): CockpitPeriodPreset {
  return raw === "month" ? "month" : DEFAULT_COCKPIT_PERIOD;
}

export function isYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function daysInclusive(from: string, to: string): number {
  const a = ymdToUtc(from);
  const b = ymdToUtc(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export function enumerateDates(from: string, to: string): string[] {
  if (!isYmd(from) || !isYmd(to) || from > to) return [];
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return out;
}

export function inInclusiveRange(
  dateKey: string,
  range: InclusiveDateRange
): boolean {
  return dateKey >= range.from && dateKey <= range.to;
}

/**
 * Percent change, one decimal. Zero previous is null unless current is
 * also zero (then 0) — never Infinity, never a fabricated swing.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function monthStart(dateKey: string): string {
  const [y, m] = dateKey.split("-");
  return `${y}-${m}-01`;
}

export function monthEnd(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function previousMonthEnd(dateKey: string): string {
  return shiftDateKey(monthStart(dateKey), -1);
}

export function resolveCockpitPeriod(
  preset: CockpitPeriodPreset,
  latestSaleDate: string | null | undefined
): CockpitPeriod | null {
  if (!isYmd(latestSaleDate)) return null;
  if (preset === "last_7") {
    const currentTo = latestSaleDate;
    const currentFrom = shiftDateKey(latestSaleDate, -(WEEK_LENGTH_DAYS - 1));
    const previousTo = shiftDateKey(latestSaleDate, -WEEK_LENGTH_DAYS);
    const previousFrom = shiftDateKey(
      latestSaleDate,
      -(WEEK_LENGTH_DAYS * 2 - 1)
    );
    return {
      preset,
      current: { from: currentFrom, to: currentTo },
      previous: { from: previousFrom, to: previousTo },
    };
  }
  const currentFrom = monthStart(latestSaleDate);
  const currentTo = monthEnd(latestSaleDate);
  const prevTo = previousMonthEnd(latestSaleDate);
  const prevFrom = monthStart(prevTo);
  return {
    preset,
    current: { from: currentFrom, to: currentTo },
    previous: { from: prevFrom, to: prevTo },
  };
}

function ymdToUtc(iso: string): Date | null {
  if (!isYmd(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
