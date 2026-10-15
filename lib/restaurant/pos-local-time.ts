// lib/restaurant/pos-local-time.ts
//
// Restaurant-local weekday / hour for a POS line. Shared by Ask Milton
// and the cockpit heatmap so both use the same timezone rules.

import { getLocalMoment } from "@/lib/restaurant/email/scheduler";
import { businessMoment } from "@/lib/restaurant/business-day";

export const WEEKDAY_KEYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/**
 * Calendar weekday of a YYYY-MM-DD key, independent of the runtime TZ.
 * Used only when `order_placed_at` is missing — `sale_date` is already local.
 */
export function weekdayFromDateKey(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

/**
 * Local weekday (0=Sun) and hour for a POS line in `timezone`.
 * Prefer `order_placed_at` so a UTC Saturday morning can land on Friday
 * evening in America/El_Salvador. Fall back to the local `sale_date`.
 */
export function localWeekdayAndHour(
  row: {
    sale_date: string;
    order_placed_at: string | null;
    /**
     * R1-17a: minutes after midnight before which a sale still belongs to the
     * PREVIOUS business day (migration 054). 0 / absent = the calendar day.
     * The date and weekday returned are the business ones; the hour stays the
     * real clock hour.
     */
    business_cutoff_min?: number | null;
  },
  timezone: string
): { weekday: number; hour: number | null; dateKey: string } {
  if (row.order_placed_at && row.business_cutoff_min) {
    const b = businessMoment(row, timezone, row.business_cutoff_min);
    return { weekday: b.weekday, hour: b.hour, dateKey: b.date };
  }
  if (row.order_placed_at) {
    const instant = new Date(row.order_placed_at);
    if (!Number.isNaN(instant.getTime())) {
      const local = getLocalMoment(instant, timezone);
      return {
        weekday: local.weekday,
        hour: local.hour,
        dateKey: local.dateKey,
      };
    }
  }
  return {
    weekday: weekdayFromDateKey(row.sale_date),
    hour: null,
    dateKey: row.sale_date,
  };
}
