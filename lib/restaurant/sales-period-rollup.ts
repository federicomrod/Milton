// lib/restaurant/sales-period-rollup.ts
//
// R1-14: Ventas used to page every raw pos_sales_items row to build one
// period's insights. Migration 047 (sales_period_rollup) does the sums in
// Postgres for a LOCAL-date period and returns one jsonb value: the same
// rollup the Cockpit uses plus the per-day / weekday / slot figures that
// salesDayStatsFromRows computed in Node (distinct tickets are counted in
// SQL, never re-added). The converters here turn it into the same DTOs the
// row walk produced, so buildSalesInsights is untouched.
//
// If the function is missing (047 not applied) or errors, the caller falls
// back to the row walk: slower, same numbers.

import type { SupabaseClient } from "@supabase/supabase-js";
import { WEEKDAY_KEYS } from "@/lib/restaurant/pos-local-time";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  parseCockpitPosRollup,
  type CockpitPosRollup,
} from "@/lib/restaurant/cockpit-pos-rollup";
import type {
  BestDate,
  PeakSlot,
  SalesDayStats,
  WeekdayStat,
} from "@/lib/restaurant/sales-insights";
import { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";

export const SALES_PERIOD_ROLLUP_RPC = "sales_period_rollup";

export interface SalesPeriodRollup extends CockpitPosRollup {
  stat_days: Array<{
    date: string;
    weekday: number;
    net_sales: number;
    net_raw: number;
    tickets: number;
  }>;
  stat_weekdays: Array<{ weekday: number; net_sales: number; tickets: number }>;
  stat_slots: Array<{
    weekday: number;
    hour: number;
    net_sales: number;
    tickets: number;
    days: number;
  }>;
  stat_tickets: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => !!v && typeof v === "object"
      )
    : [];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseSalesPeriodRollup(raw: unknown): SalesPeriodRollup | null {
  const base = parseCockpitPosRollup(raw);
  if (!base) return null;
  const row = raw as Record<string, unknown>;
  return {
    ...base,
    stat_days: rows(row.stat_days).map((d) => ({
      date: String(d.date),
      weekday: num(d.weekday),
      net_sales: num(d.net_sales),
      net_raw: num(d.net_raw),
      tickets: num(d.tickets),
    })),
    stat_weekdays: rows(row.stat_weekdays).map((d) => ({
      weekday: num(d.weekday),
      net_sales: num(d.net_sales),
      tickets: num(d.tickets),
    })),
    stat_slots: rows(row.stat_slots).map((d) => ({
      weekday: num(d.weekday),
      hour: num(d.hour),
      net_sales: num(d.net_sales),
      tickets: num(d.tickets),
      days: num(d.days),
    })),
    stat_tickets: num(row.stat_tickets),
  };
}

/** Same result as salesDayStatsFromRows over the period's rows. */
export function salesDayStatsFromRollup(
  rollup: SalesPeriodRollup
): SalesDayStats {
  const daysWithSalesByWeekday = new Map<number, number>();
  for (const day of rollup.stat_days) {
    if (day.net_raw > 0) {
      daysWithSalesByWeekday.set(
        day.weekday,
        (daysWithSalesByWeekday.get(day.weekday) ?? 0) + 1
      );
    }
  }
  const byWeekday = new Map(rollup.stat_weekdays.map((w) => [w.weekday, w]));
  const weekdays: WeekdayStat[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const w = byWeekday.get(weekday);
    const days = daysWithSalesByWeekday.get(weekday) ?? 0;
    const net = w?.net_sales ?? 0;
    weekdays.push({
      weekday,
      weekday_key: WEEKDAY_KEYS[weekday],
      net_sales: round2(net),
      tickets: w?.tickets ?? 0,
      days,
      avg_per_day: days > 0 ? round2(net / days) : 0,
    });
  }
  const slots: PeakSlot[] = rollup.stat_slots
    .map((s) => ({
      weekday: s.weekday,
      weekday_key: WEEKDAY_KEYS[s.weekday],
      hour: s.hour,
      net_sales: round2(s.net_sales),
      tickets: s.tickets,
      days: s.days,
      avg_per_day: s.days > 0 ? round2(s.net_sales / s.days) : 0,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);

  let best: BestDate | null = null;
  for (const day of rollup.stat_days) {
    if (day.net_raw <= 0) continue;
    if (
      !best ||
      day.net_raw > best.net_sales ||
      (day.net_raw === best.net_sales && day.date < best.date)
    ) {
      best = {
        date: day.date,
        weekday: day.weekday,
        weekday_key: WEEKDAY_KEYS[day.weekday],
        net_sales: round2(day.net_raw),
        tickets: day.tickets,
      };
    }
  }
  return {
    days_with_sales: rollup.stat_days.filter((d) => d.net_raw > 0).length,
    tickets: rollup.stat_tickets,
    weekdays,
    slots,
    best_date: best,
  };
}

export type SalesPeriodRead =
  | { ok: true; rollup: SalesPeriodRollup; ms: number }
  | { ok: false };

/** When the function is missing, do not pay a failed call every load. */
let unavailableUntil = 0;
const UNAVAILABLE_MS = 60_000;

export async function fetchSalesPeriodRollup(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    locationId: string | null;
    timezone: string;
    currency: string;
    from: string;
    to: string;
  }
): Promise<SalesPeriodRead> {
  if (Date.now() < unavailableUntil) return { ok: false };
  const started = Date.now();
  const { data, error } = await supabase.rpc(SALES_PERIOD_ROLLUP_RPC, {
    p_company_id: input.companyId,
    p_location_id: input.locationId,
    p_timezone: normalizeTimezone(input.timezone) ?? "UTC",
    p_currency: input.currency,
    p_from: input.from,
    p_to: input.to,
  });
  const ms = Date.now() - started;
  if (error) {
    logCockpitTiming("sales-period-rpc", { ms, source: "error" });
    // Not a member (42501) is about this caller, not the function.
    if (error.code !== "42501") unavailableUntil = Date.now() + UNAVAILABLE_MS;
    return { ok: false };
  }
  const rollup = parseSalesPeriodRollup(data);
  if (!rollup) return { ok: false };
  logCockpitTiming("sales-period-rpc", {
    ms,
    source: "rpc",
    rows: rollup.row_count,
  });
  return { ok: true, rollup, ms };
}
