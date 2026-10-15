// lib/restaurant/cockpit-daily.ts
//
// R1-16: the day-by-day net sales the Cockpit and Objetivos are built on, from
// the one SQL rollup (cockpit_pos_rollup.daily) or, when that function is not
// applied, from the raw rows with the same rules (tips out, local date).

import type { CockpitPosRollup } from "@/lib/restaurant/cockpit-pos-rollup";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { localSaleDateKey } from "@/lib/restaurant/cockpit-executive";
import { classifySaleLine } from "@/lib/restaurant/sales-revenue";
import type { DayPoint } from "@/lib/restaurant/cockpit-math";

export function dailyFromRollup(rollup: CockpitPosRollup | null): DayPoint[] {
  return (rollup?.daily ?? []).map((d) => ({
    date: d.date,
    net_sales: d.net_sales,
    tickets: d.tickets,
  }));
}

/** Net sales (tips out) and tickets per LOCAL day from raw rows. */
export function dailyFromRows(
  rows: readonly CockpitFactRow[],
  timezone: string,
  currency?: string
): DayPoint[] {
  const net = new Map<string, number>();
  const checks = new Map<string, Set<string>>();
  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    const day = localSaleDateKey(row, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const classified = classifySaleLine(row);
    net.set(day, (net.get(day) ?? 0) + (classified.isTip ? 0 : classified.net));
    const key = row.check_id ?? row.order_id ?? null;
    if (key) {
      const set = checks.get(day) ?? new Set<string>();
      set.add(key);
      checks.set(day, set);
    }
  }
  return [...net.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, n]) => ({
      date,
      net_sales: Math.round(n * 100) / 100,
      tickets: checks.get(date)?.size ?? 0,
    }));
}
