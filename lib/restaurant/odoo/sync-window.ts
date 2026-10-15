// lib/restaurant/odoo/sync-window.ts
//
// Shared date-window helpers for the manual Odoo sync and the read-only
// audit. Both stay inside the same 92-day cap so a founder can't pull an
// unbounded range from the client's Odoo.

export const MAX_RANGE_DAYS = 92;
export const QUERY_PAD_DAYS = 1;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  return (
    (new Date(`${endDate}T00:00:00Z`).getTime() -
      new Date(`${startDate}T00:00:00Z`).getTime()) /
      86_400_000 +
    1
  );
}

export type DateRangeParse =
  | { ok: true; start_date: string; end_date: string; rangeDays: number }
  | { ok: false; error: string };

export function parseInclusiveDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): DateRangeParse {
  if (
    !startDate ||
    !endDate ||
    !DATE_RE.test(startDate) ||
    !DATE_RE.test(endDate)
  ) {
    return {
      ok: false,
      error: "start_date and end_date are required, format YYYY-MM-DD",
    };
  }
  if (startDate > endDate) {
    return { ok: false, error: "start_date must be on or before end_date" };
  }
  const rangeDays = inclusiveDayCount(startDate, endDate);
  if (rangeDays > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Requested range spans ${rangeDays} days; the manual sync is capped at ${MAX_RANGE_DAYS} days per call`,
    };
  }
  return { ok: true, start_date: startDate, end_date: endDate, rangeDays };
}
