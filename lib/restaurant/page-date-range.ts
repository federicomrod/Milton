// lib/restaurant/page-date-range.ts
//
// Shared operating-page date range (Cockpit / Sales / Menu / Costs).
// Stored in `?from=` / `?to=` (YYYY-MM-DD, inclusive). Pure — no I/O.
// Presentation matches "Jul 1 - Jul 31, 2026". Defaults to the current
// calendar month so a first visit has a concrete range without writing
// the URL (the header writes params when the operator changes them).

import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import { formatYmd } from "@/lib/restaurant/odoo/sync-control";

export const DATE_FROM_PARAM = "from";
export const DATE_TO_PARAM = "to";

export interface PageDateRange {
  from: string;
  to: string;
}

export function defaultPageDateRange(now: Date = new Date()): PageDateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatYmd(start), to: formatYmd(end) };
}

export function isValidYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

/**
 * Reads from/to from a query-param map. Invalid or inverted ranges fall
 * back to the default month (does not throw).
 */
export function parsePageDateRange(
  params: { get: (key: string) => string | null } | URLSearchParams,
  now: Date = new Date()
): PageDateRange {
  const fallback = defaultPageDateRange(now);
  const rawFrom = params.get(DATE_FROM_PARAM);
  const rawTo = params.get(DATE_TO_PARAM);
  if (!isValidYmd(rawFrom) || !isValidYmd(rawTo)) return fallback;
  if (rawFrom > rawTo) return { from: rawTo, to: rawFrom };
  return { from: rawFrom, to: rawTo };
}

export function hasExplicitPageDateRange(params: {
  get: (key: string) => string | null;
}): boolean {
  return isValidYmd(params.get(DATE_FROM_PARAM)) &&
    isValidYmd(params.get(DATE_TO_PARAM));
}

/** "Jul 1 - Jul 31, 2026" (en) / "1 jul - 31 jul 2026" (es). */
export function formatPageDateRangeLabel(
  range: PageDateRange,
  locale: string = "en-US"
): string {
  const parse = (iso: string): Date | null => {
    if (!DATE_RE.test(iso)) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parse(range.from);
  const end = parse(range.to);
  if (!start || !end) return `${range.from} - ${range.to}`;

  const monthDay = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const monthDayYear = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (range.from === range.to) return monthDayYear.format(start);

  const sameYear = start.getFullYear() === end.getFullYear();
  const left = sameYear ? monthDay.format(start) : monthDayYear.format(start);
  const right = monthDayYear.format(end);
  return `${left} - ${right}`;
}

export function pageDateRangeSearchString(range: PageDateRange): string {
  const params = new URLSearchParams();
  params.set(DATE_FROM_PARAM, range.from);
  params.set(DATE_TO_PARAM, range.to);
  return params.toString();
}
