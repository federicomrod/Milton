// lib/restaurant/cockpit-pos-rollup.ts
//
// Client for migration 031 `cockpit_pos_rollup` plus the converters that
// turn that one JSON object into the same DTOs the in-memory walk
// produces. When the RPC is missing (staging has not pasted 031 yet) the
// loaders fall back to fetchAllRows — same numbers, slower.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DINNER_START_HOUR,
  emptyCockpitSalesAggregate,
  type CategoryMixRow,
  type CockpitSalesAggregate,
  type HeatmapCell,
  type MixSeriesPoint,
  type WeekWindow,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  emptyRevenueBreakdown,
  finalizeRevenueBreakdown,
  type RevenueBreakdown,
} from "@/lib/restaurant/sales-revenue";
import { WEEKDAY_KEYS } from "@/lib/restaurant/pos-local-time";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  enumerateDates,
  inInclusiveRange,
  type CockpitPeriod,
} from "@/lib/restaurant/cockpit-period";
import {
  type ChannelShare,
  type CockpitPeriodSnapshot,
  type DailyNetPoint,
  type PeriodBucket,
} from "@/lib/restaurant/cockpit-executive";
import { salesChannelLabel } from "@/lib/restaurant/sales-channel-labels";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { deltaPct } from "@/lib/restaurant/cockpit-period";
import type { PeriodCostKpis } from "@/lib/restaurant/cockpit-cost-coverage";
import { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";

export { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";

export const COCKPIT_POS_ROLLUP_RPC = "cockpit_pos_rollup";

export interface RollupDailyRow {
  date: string;
  net_sales: number;
  gross_sales: number;
  discounts: number;
  tips: number;
  tickets: number;
  units: number;
  discounts_estimated: boolean;
}

export interface RollupHeatCell {
  weekday: number;
  hour: number;
  net_sales: number;
  tickets: number;
}

export interface RollupMixPoint {
  period: string;
  key: string;
  net_sales: number;
}

export interface RollupChannelDay {
  date: string;
  channel: string;
  net_sales: number;
}

export interface CockpitPosRollup {
  row_count: number;
  period_from: string | null;
  period_to: string | null;
  revenue: RevenueBreakdown;
  tickets: number;
  units: number;
  daily: RollupDailyRow[];
  heatmap_cells: RollupHeatCell[];
  hours_seen: number[];
  lunch: { net_sales: number; tickets: number };
  dinner: { net_sales: number; tickets: number };
  channel_weeks: RollupMixPoint[];
  payment_weeks: RollupMixPoint[];
  category_mix: CategoryMixRow[];
  channel_by_day: RollupChannelDay[];
  this_week: WeekWindow | null;
  last_week: WeekWindow | null;
}

export const EMPTY_PERIOD_COST: PeriodCostKpis = {
  coverage_pct: 0,
  covered_net: 0,
  estimated_cogs: 0,
  food_cost_pct: null,
  gross_margin_pct: null,
};

export function isMissingRpcError(
  error: {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null,
  rpcName: string = COCKPIT_POS_ROLLUP_RPC
): boolean {
  if (!error) return false;
  const hay = [error.message, error.code, error.details, error.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    hay.includes(rpcName.toLowerCase()) ||
    hay.includes("could not find the function") ||
    hay.includes("does not exist")
  );
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function weekWindow(value: unknown): WeekWindow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const from = str(row.from);
  const to = str(row.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    net_sales: num(row.net_sales),
    tickets: num(row.tickets),
  };
}

export function parseCockpitPosRollup(raw: unknown): CockpitPosRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const revenueIn =
    row.revenue && typeof row.revenue === "object"
      ? (row.revenue as Record<string, unknown>)
      : {};
  const revenue = finalizeRevenueBreakdown({
    gross_sales: num(revenueIn.gross_sales),
    discounts: num(revenueIn.discounts),
    net_sales: num(revenueIn.net_sales),
    tips: num(revenueIn.tips),
    odoo_like_total: num(revenueIn.odoo_like_total),
    discounts_estimated: revenueIn.discounts_estimated === true,
  });
  const daily = Array.isArray(row.daily)
    ? row.daily.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const d = item as Record<string, unknown>;
        const date = str(d.date);
        if (!date) return [];
        return [
          {
            date,
            net_sales: num(d.net_sales),
            gross_sales: num(d.gross_sales),
            discounts: num(d.discounts),
            tips: num(d.tips),
            tickets: num(d.tickets),
            units: num(d.units),
            discounts_estimated: d.discounts_estimated === true,
          },
        ];
      })
    : [];
  return {
    row_count: num(row.row_count),
    period_from: str(row.period_from),
    period_to: str(row.period_to),
    revenue,
    tickets: num(row.tickets),
    units: num(row.units),
    daily,
    heatmap_cells: Array.isArray(row.heatmap_cells)
      ? row.heatmap_cells.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const c = item as Record<string, unknown>;
          return [
            {
              weekday: num(c.weekday),
              hour: num(c.hour),
              net_sales: num(c.net_sales),
              tickets: num(c.tickets),
            },
          ];
        })
      : [],
    hours_seen: Array.isArray(row.hours_seen)
      ? row.hours_seen.filter(
          (h): h is number => typeof h === "number" && Number.isFinite(h)
        )
      : [],
    lunch: {
      net_sales: num(
        row.lunch && typeof row.lunch === "object"
          ? (row.lunch as Record<string, unknown>).net_sales
          : 0
      ),
      tickets: num(
        row.lunch && typeof row.lunch === "object"
          ? (row.lunch as Record<string, unknown>).tickets
          : 0
      ),
    },
    dinner: {
      net_sales: num(
        row.dinner && typeof row.dinner === "object"
          ? (row.dinner as Record<string, unknown>).net_sales
          : 0
      ),
      tickets: num(
        row.dinner && typeof row.dinner === "object"
          ? (row.dinner as Record<string, unknown>).tickets
          : 0
      ),
    },
    channel_weeks: Array.isArray(row.channel_weeks)
      ? row.channel_weeks.flatMap((item) => mixPoint(item))
      : [],
    payment_weeks: Array.isArray(row.payment_weeks)
      ? row.payment_weeks.flatMap((item) => mixPoint(item))
      : [],
    category_mix: Array.isArray(row.category_mix)
      ? row.category_mix.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const c = item as Record<string, unknown>;
          return [
            {
              category: str(c.category),
              net_sales: num(c.net_sales),
              tickets: num(c.tickets),
              units: num(c.units),
            },
          ];
        })
      : [],
    channel_by_day: Array.isArray(row.channel_by_day)
      ? row.channel_by_day.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const c = item as Record<string, unknown>;
          const date = str(c.date);
          const channel = str(c.channel) ?? "unknown";
          if (!date) return [];
          return [{ date, channel, net_sales: num(c.net_sales) }];
        })
      : [],
    this_week: weekWindow(row.this_week),
    last_week: weekWindow(row.last_week),
  };
}

function mixPoint(item: unknown): RollupMixPoint[] {
  if (!item || typeof item !== "object") return [];
  const row = item as Record<string, unknown>;
  const period = str(row.period);
  const key = str(row.key) ?? "unknown";
  if (!period) return [];
  return [{ period, key, net_sales: num(row.net_sales) }];
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function toMixSeries(points: RollupMixPoint[]): MixSeriesPoint[] {
  const byPeriod = new Map<string, Map<string, number>>();
  for (const point of points) {
    let week = byPeriod.get(point.period);
    if (!week) {
      week = new Map();
      byPeriod.set(point.period, week);
    }
    week.set(point.key, (week.get(point.key) ?? 0) + point.net_sales);
  }
  return Array.from(byPeriod.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, values]) => ({
      period,
      values: Object.fromEntries(
        Array.from(values.entries()).map(([k, v]) => [
          k,
          Math.round(v * 100) / 100,
        ])
      ),
    }));
}

function heatmapFromRollup(rollup: CockpitPosRollup): HeatmapCell[] {
  const heatNet = new Map<string, number>();
  const heatTickets = new Map<string, number>();
  const hoursSeen = new Set(rollup.hours_seen);
  for (const cell of rollup.heatmap_cells) {
    hoursSeen.add(cell.hour);
    const key = `${cell.weekday}-${cell.hour}`;
    heatNet.set(key, cell.net_sales);
    heatTickets.set(key, cell.tickets);
  }
  const heatmap: HeatmapCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${weekday}-${hour}`;
      const net = heatNet.get(key) ?? 0;
      if (net === 0 && !hoursSeen.has(hour)) continue;
      heatmap.push({
        weekday,
        weekday_key: WEEKDAY_KEYS[weekday],
        hour,
        net_sales: Math.round(net * 100) / 100,
        tickets: heatTickets.get(key) ?? 0,
      });
    }
  }
  return heatmap;
}

function daypartOf(
  daypart: "lunch" | "dinner",
  bucket: { net_sales: number; tickets: number }
) {
  return {
    daypart,
    hours:
      daypart === "lunch"
        ? `00:00–${String(DINNER_START_HOUR).padStart(2, "0")}:00`
        : `${String(DINNER_START_HOUR).padStart(2, "0")}:00–24:00`,
    net_sales: Math.round(bucket.net_sales * 100) / 100,
    tickets: bucket.tickets,
    avg_ticket: bucket.tickets > 0 ? bucket.net_sales / bucket.tickets : 0,
  };
}

export function rollupToCockpitSalesAggregate(
  rollup: CockpitPosRollup,
  options: { timezone?: string; currency?: string } = {}
): CockpitSalesAggregate {
  const timezone = normalizeTimezone(options.timezone) ?? "UTC";
  const currency = options.currency ?? "USD";
  const empty = emptyCockpitSalesAggregate(timezone, currency);
  if (rollup.row_count <= 0) return empty;
  const tickets = rollup.tickets;
  const thisWeek = rollup.this_week;
  const lastWeek = rollup.last_week;
  return {
    currency,
    timezone,
    period_from: rollup.period_from,
    period_to: rollup.period_to,
    revenue: rollup.revenue,
    tickets,
    units: rollup.units,
    avg_ticket: tickets > 0 ? rollup.revenue.net_sales / tickets : 0,
    this_week: thisWeek,
    last_week: lastWeek,
    week_delta_pct:
      thisWeek && lastWeek
        ? pctChange(thisWeek.net_sales, lastWeek.net_sales)
        : null,
    heatmap: heatmapFromRollup(rollup),
    dayparts: [
      daypartOf("lunch", rollup.lunch),
      daypartOf("dinner", rollup.dinner),
    ],
    channel_mix_over_time: toMixSeries(rollup.channel_weeks),
    payment_mix_over_time: toMixSeries(rollup.payment_weeks),
    category_mix: [...rollup.category_mix].sort(
      (a, b) => b.net_sales - a.net_sales
    ),
    rows_reviewed: rollup.row_count,
  };
}

function bucketFromDaily(
  days: RollupDailyRow[],
  range: { from: string; to: string },
  allTimeTickets: number,
  periodFrom: string | null,
  periodTo: string | null
): PeriodBucket {
  const revenue = emptyRevenueBreakdown();
  let tickets = 0;
  let units = 0;
  let rows = 0;
  for (const day of days) {
    if (!inInclusiveRange(day.date, range)) continue;
    revenue.gross_sales += day.gross_sales;
    revenue.discounts += day.discounts;
    revenue.net_sales += day.net_sales;
    revenue.tips += day.tips;
    revenue.odoo_like_total += day.net_sales + day.tips;
    if (day.discounts_estimated) revenue.discounts_estimated = true;
    tickets += day.tickets;
    units += day.units;
    rows += 1;
  }
  const finalized = finalizeRevenueBreakdown(revenue);
  const fullSpan =
    periodFrom === range.from &&
    periodTo === range.to &&
    Number.isFinite(allTimeTickets);
  const ticketCount = fullSpan ? allTimeTickets : tickets;
  return {
    net_sales: finalized.net_sales,
    gross_sales: finalized.gross_sales,
    discounts: finalized.discounts,
    tips: finalized.tips,
    tickets: ticketCount,
    units: Math.round(units * 1000) / 1000,
    avg_ticket: ticketCount > 0 ? finalized.net_sales / ticketCount : 0,
    discounts_estimated: finalized.discounts_estimated,
    rows_reviewed: rows,
  };
}

export function buildCockpitPeriodSnapshotFromRollup(
  rollup: CockpitPosRollup,
  period: CockpitPeriod,
  options: { timezone?: string; currency?: string; lang: PreferredLanguage }
): CockpitPeriodSnapshot {
  const timezone = normalizeTimezone(options.timezone) ?? "UTC";
  const currency = options.currency ?? "USD";
  const byDate = new Map(rollup.daily.map((d) => [d.date, d]));
  const current = bucketFromDaily(
    rollup.daily,
    period.current,
    rollup.tickets,
    rollup.period_from,
    rollup.period_to
  );
  const previous = bucketFromDaily(
    rollup.daily,
    period.previous,
    rollup.tickets,
    rollup.period_from,
    rollup.period_to
  );
  const currentDates = enumerateDates(period.current.from, period.current.to);
  const previousDates = enumerateDates(
    period.previous.from,
    period.previous.to
  );
  const daily: DailyNetPoint[] = currentDates.map((date, index) => {
    const cell = byDate.get(date);
    const currentNet = cell?.net_sales ?? 0;
    const tickets = cell?.tickets ?? 0;
    const previousDate =
      period.preset === "month"
        ? (previousDates.find((d) => d.slice(8) === date.slice(8)) ?? null)
        : (previousDates[index] ?? null);
    const previousNet =
      previousDate !== null ? (byDate.get(previousDate)?.net_sales ?? 0) : null;
    return {
      date,
      previous_date: previousDate,
      current_net: Math.round(currentNet * 100) / 100,
      previous_net:
        previousNet === null ? null : Math.round(previousNet * 100) / 100,
      current_tickets: tickets,
      current_avg_ticket: tickets > 0 ? currentNet / tickets : 0,
      vs_previous_pct:
        previousNet === null ? null : deltaPct(currentNet, previousNet),
    };
  });

  const currentChannel = new Map<string, number>();
  const previousChannel = new Map<string, number>();
  for (const row of rollup.channel_by_day) {
    if (inInclusiveRange(row.date, period.current)) {
      currentChannel.set(
        row.channel,
        (currentChannel.get(row.channel) ?? 0) + row.net_sales
      );
    }
    if (inInclusiveRange(row.date, period.previous)) {
      previousChannel.set(
        row.channel,
        (previousChannel.get(row.channel) ?? 0) + row.net_sales
      );
    }
  }
  const channelKeys = Array.from(
    new Set([...currentChannel.keys(), ...previousChannel.keys()])
  ).sort((a, b) => (currentChannel.get(b) ?? 0) - (currentChannel.get(a) ?? 0));
  const channels: ChannelShare[] = channelKeys.map((channel) => {
    const net = Math.round((currentChannel.get(channel) ?? 0) * 100) / 100;
    const prev = previousChannel.get(channel) ?? 0;
    const share = current.net_sales > 0 ? (net / current.net_sales) * 100 : 0;
    const prevShare =
      previous.net_sales > 0 ? (prev / previous.net_sales) * 100 : null;
    return {
      channel,
      label: salesChannelLabel(channel, options.lang),
      net_sales: net,
      share_pct: Math.round(share * 10) / 10,
      previous_share_pct:
        prevShare === null ? null : Math.round(prevShare * 10) / 10,
      delta_pp:
        prevShare === null ? null : Math.round((share - prevShare) * 10) / 10,
    };
  });

  return {
    period,
    currency,
    timezone,
    current,
    previous,
    daily,
    channels,
    cost: EMPTY_PERIOD_COST,
    previous_cost: EMPTY_PERIOD_COST,
    other_currency_excluded: 0,
  };
}

export async function fetchCockpitPosRollup(
  supabase: SupabaseClient,
  companyId: string,
  options: {
    locationId?: string | null;
    timezone?: string;
    currency?: string | null;
  } = {}
): Promise<{
  rollup: CockpitPosRollup | null;
  missing: boolean;
  error: { message?: string } | null;
  elapsedMs: number;
}> {
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc(COCKPIT_POS_ROLLUP_RPC, {
      p_company_id: companyId,
      p_location_id: options.locationId ?? null,
      p_timezone: normalizeTimezone(options.timezone) ?? "UTC",
      p_currency: options.currency ?? null,
    });
    if (error) {
      const missing = isMissingRpcError(error);
      logCockpitTiming("rpc", {
        ms: Date.now() - started,
        source: missing ? "missing" : "error",
        error: error.message,
        code: error.code,
      });
      if (!missing) {
        console.error("[cockpit-pos-rollup] rpc failed:", error.message);
      }
      return {
        rollup: null,
        missing,
        error,
        elapsedMs: Date.now() - started,
      };
    }
    const rollup = parseCockpitPosRollup(data);
    const elapsedMs = Date.now() - started;
    if (!rollup) {
      logCockpitTiming("rpc", {
        ms: elapsedMs,
        source: "error",
        error: "cockpit_pos_rollup returned an unreadable payload",
      });
      return {
        rollup: null,
        missing: false,
        error: { message: "cockpit_pos_rollup returned an unreadable payload" },
        elapsedMs,
      };
    }
    logCockpitTiming("rpc", {
      ms: elapsedMs,
      source: "rpc",
      rows: rollup.row_count,
    });
    return {
      rollup,
      missing: false,
      error: null,
      elapsedMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = isMissingRpcError({ message });
    logCockpitTiming("rpc", {
      ms: Date.now() - started,
      source: missing ? "missing" : "error",
      error: message,
    });
    if (!missing) {
      console.error("[cockpit-pos-rollup] rpc threw:", err);
    }
    return {
      rollup: null,
      missing,
      error: { message },
      elapsedMs: Date.now() - started,
    };
  }
}
