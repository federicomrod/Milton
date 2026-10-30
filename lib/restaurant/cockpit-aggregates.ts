// lib/restaurant/cockpit-aggregates.ts
//
// Single-pass cockpit sales rollup. Callers already have the paginated
// `pos_sales_items` rows — this never reads the database. ~20k rows/month
// is one O(N) walk (issue #123 / #92).
//
// Week vs last week uses the latest local sale date as the anchor (same
// as RestaurantSalesExplorer presets), not the wall clock, so historical
// July staging data still has a meaningful comparison.
//
// Heatmap and dayparts use `getLocalMoment` / `localWeekdayAndHour` so a
// UTC Saturday morning can land on Friday evening in America/El_Salvador.

import {
  localWeekdayAndHour,
  WEEKDAY_KEYS,
  type WeekdayKey,
} from "@/lib/restaurant/pos-local-time";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  addClassifiedLine,
  classifySaleLine,
  daypartFromLocalHour,
  DINNER_START_HOUR,
  emptyRevenueBreakdown,
  finalizeRevenueBreakdown,
  type Daypart,
  type RevenueBreakdown,
} from "@/lib/restaurant/sales-revenue";

export { DINNER_START_HOUR, daypartFromLocalHour };
export type { Daypart, RevenueBreakdown };

export const WEEK_LENGTH_DAYS = 7;

export interface CockpitFactRow {
  sale_date: string;
  order_placed_at?: string | null;
  menu_item_id?: string | null;
  raw_item_name?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  gross_revenue?: number | null;
  net_revenue?: number | null;
  revenue?: number | null;
  discount_amount?: number | null;
  discount_estimated?: boolean | null;
  source_metadata?: { discount_estimated?: boolean } | null;
  is_tip?: boolean | null;
  order_id?: string | null;
  check_id?: string | null;
  sales_channel?: string | null;
  payment_type?: string | null;
  category?: string | null;
  currency?: string | null;
  location_id?: string | null;
  /** R1-17a: the business-day cutoff of this line's restaurant (see pos-local-time). */
  business_cutoff_min?: number | null;
}

export interface HeatmapCell {
  weekday: number;
  weekday_key: WeekdayKey;
  hour: number;
  net_sales: number;
  tickets: number;
}

export interface DaypartTotals {
  daypart: Daypart;
  /** Inclusive local hours in this bucket. */
  hours: string;
  net_sales: number;
  tickets: number;
  avg_ticket: number;
}

export interface MixSeriesPoint {
  /** Local week-start date (Monday, YYYY-MM-DD). */
  period: string;
  values: Record<string, number>;
}

export interface CategoryMixRow {
  category: string | null;
  net_sales: number;
  tickets: number;
  units: number;
}

export interface WeekWindow {
  from: string;
  to: string;
  net_sales: number;
  tickets: number;
}

export interface CockpitSalesAggregate {
  currency: string;
  timezone: string;
  /** Inclusive sale_date span of the loaded rows (not the Explorer filter). */
  period_from: string | null;
  period_to: string | null;
  revenue: RevenueBreakdown;
  tickets: number;
  units: number;
  avg_ticket: number;
  this_week: WeekWindow | null;
  last_week: WeekWindow | null;
  week_delta_pct: number | null;
  heatmap: HeatmapCell[];
  dayparts: DaypartTotals[];
  channel_mix_over_time: MixSeriesPoint[];
  payment_mix_over_time: MixSeriesPoint[];
  category_mix: CategoryMixRow[];
  rows_reviewed: number;
}

function orderKey(row: CockpitFactRow): string | null {
  return row.check_id ?? row.order_id ?? null;
}

function quantityOf(row: CockpitFactRow): number {
  return typeof row.quantity === "number" && Number.isFinite(row.quantity)
    ? row.quantity
    : 0;
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Monday of the ISO-ish week containing `dateKey` (Mon=start). */
export function weekStartMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = dt.getUTCDay(); // 0=Sun
  const back = weekday === 0 ? 6 : weekday - 1;
  return shiftDateKey(dateKey, -back);
}

/** Compact inclusive range for KPI labels: "25–31 Jul 2026" or "28 Jul–3 Aug 2026". */
export function formatCompactDateRange(
  from: string,
  to: string,
  locale: string = "en-US"
): string {
  const parse = (iso: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return `${from} – ${to}`;
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    timeZone: "UTC",
  });
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const full = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  if (from === to) return full.format(a);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    return `${day.format(a)}–${full.format(b)}`;
  }
  if (sameYear) {
    return `${dayMonth.format(a)}–${full.format(b)}`;
  }
  return `${full.format(a)}–${full.format(b)}`;
}

export function weekWindowsFromAnchor(latestDate: string): {
  thisWeek: { from: string; to: string };
  lastWeek: { from: string; to: string };
} {
  const thisTo = latestDate;
  const thisFrom = shiftDateKey(latestDate, -(WEEK_LENGTH_DAYS - 1));
  const lastTo = shiftDateKey(latestDate, -WEEK_LENGTH_DAYS);
  const lastFrom = shiftDateKey(latestDate, -(WEEK_LENGTH_DAYS * 2 - 1));
  return {
    thisWeek: { from: thisFrom, to: thisTo },
    lastWeek: { from: lastFrom, to: lastTo },
  };
}

function inRange(dateKey: string, from: string, to: string): boolean {
  return dateKey >= from && dateKey <= to;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function emptyDaypart(daypart: Daypart): {
  net: number;
  orders: Set<string>;
} {
  return { net: 0, orders: new Set() };
}

function toMixSeries(map: Map<string, Map<string, number>>): MixSeriesPoint[] {
  return Array.from(map.entries())
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

export function emptyCockpitSalesAggregate(
  timezone = "UTC",
  currency = "USD"
): CockpitSalesAggregate {
  return {
    currency,
    timezone,
    period_from: null,
    period_to: null,
    revenue: emptyRevenueBreakdown(),
    tickets: 0,
    units: 0,
    avg_ticket: 0,
    this_week: null,
    last_week: null,
    week_delta_pct: null,
    heatmap: [],
    dayparts: [],
    channel_mix_over_time: [],
    payment_mix_over_time: [],
    category_mix: [],
    rows_reviewed: 0,
  };
}

/**
 * One walk over already-loaded POS rows. Mixed-currency rows are skipped
 * when `currency` is set — same rule as computeOverviewFromRows.
 */
export function buildCockpitSalesAggregate(
  rows: CockpitFactRow[],
  options: { timezone?: string; currency?: string } = {}
): CockpitSalesAggregate {
  const timezone = normalizeTimezone(options.timezone) ?? "UTC";
  const currency = options.currency;
  const revenue = emptyRevenueBreakdown();
  const orderIds = new Set<string>();
  let units = 0;
  let latestDate: string | null = null;
  let earliestDate: string | null = null;
  let rowsReviewed = 0;

  const weekNet = { thisWeek: 0, lastWeek: 0 };
  const weekTickets = {
    thisWeek: new Set<string>(),
    lastWeek: new Set<string>(),
  };
  let windows: ReturnType<typeof weekWindowsFromAnchor> | null = null;

  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    if (!latestDate || row.sale_date > latestDate) latestDate = row.sale_date;
    if (!earliestDate || row.sale_date < earliestDate) {
      earliestDate = row.sale_date;
    }
  }
  if (latestDate) windows = weekWindowsFromAnchor(latestDate);

  const heatNet = new Map<string, number>();
  const heatOrders = new Map<string, Set<string>>();
  const hoursSeen = new Set<number>();
  const lunch = emptyDaypart("lunch");
  const dinner = emptyDaypart("dinner");
  const channelWeeks = new Map<string, Map<string, number>>();
  const paymentWeeks = new Map<string, Map<string, number>>();
  const categoryBuckets = new Map<
    string,
    { category: string | null; net: number; units: number; orders: Set<string> }
  >();

  const bumpMix = (
    store: Map<string, Map<string, number>>,
    period: string,
    key: string,
    amount: number
  ) => {
    let week = store.get(period);
    if (!week) {
      week = new Map();
      store.set(period, week);
    }
    week.set(key, (week.get(key) ?? 0) + amount);
  };

  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    rowsReviewed += 1;
    const line = classifySaleLine(row);
    addClassifiedLine(revenue, line);
    const key = orderKey(row);
    if (key) orderIds.add(key);
    if (!line.isTip) units += quantityOf(row);

    const local = localWeekdayAndHour(
      {
        sale_date: row.sale_date,
        order_placed_at: row.order_placed_at ?? null,
        business_cutoff_min: row.business_cutoff_min ?? null,
      },
      timezone
    );

    if (windows && key) {
      if (inRange(local.dateKey, windows.thisWeek.from, windows.thisWeek.to)) {
        weekNet.thisWeek += line.net;
        weekTickets.thisWeek.add(key);
      } else if (
        inRange(local.dateKey, windows.lastWeek.from, windows.lastWeek.to)
      ) {
        weekNet.lastWeek += line.net;
        weekTickets.lastWeek.add(key);
      }
    } else if (windows) {
      if (inRange(local.dateKey, windows.thisWeek.from, windows.thisWeek.to)) {
        weekNet.thisWeek += line.net;
      } else if (
        inRange(local.dateKey, windows.lastWeek.from, windows.lastWeek.to)
      ) {
        weekNet.lastWeek += line.net;
      }
    }

    if (local.hour !== null) {
      hoursSeen.add(local.hour);
      const cellKey = `${local.weekday}-${local.hour}`;
      heatNet.set(cellKey, (heatNet.get(cellKey) ?? 0) + line.net);
      let cellOrders = heatOrders.get(cellKey);
      if (!cellOrders) {
        cellOrders = new Set();
        heatOrders.set(cellKey, cellOrders);
      }
      if (key) cellOrders.add(key);

      const part = daypartFromLocalHour(local.hour);
      const bucket = part === "dinner" ? dinner : lunch;
      bucket.net += line.net;
      if (key) bucket.orders.add(key);
    }

    const week = weekStartMonday(local.dateKey);
    bumpMix(
      channelWeeks,
      week,
      trimOrNull(row.sales_channel) ?? "unknown",
      line.net
    );
    bumpMix(
      paymentWeeks,
      week,
      trimOrNull(row.payment_type) ?? "unknown",
      line.net
    );

    if (!line.isTip) {
      const cat = trimOrNull(row.category);
      const catKey = cat ?? "";
      let catBucket = categoryBuckets.get(catKey);
      if (!catBucket) {
        catBucket = {
          category: cat,
          net: 0,
          units: 0,
          orders: new Set(),
        };
        categoryBuckets.set(catKey, catBucket);
      }
      catBucket.net += line.net;
      catBucket.units += quantityOf(row);
      if (key) catBucket.orders.add(key);
    }
  }

  const tickets = orderIds.size;
  const finalized = finalizeRevenueBreakdown(revenue);
  const heatmap: HeatmapCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const cellKey = `${weekday}-${hour}`;
      const net = heatNet.get(cellKey) ?? 0;
      if (net === 0 && !hoursSeen.has(hour)) continue;
      heatmap.push({
        weekday,
        weekday_key: WEEKDAY_KEYS[weekday],
        hour,
        net_sales: Math.round(net * 100) / 100,
        tickets: heatOrders.get(cellKey)?.size ?? 0,
      });
    }
  }

  const toDaypart = (
    daypart: Daypart,
    bucket: { net: number; orders: Set<string> }
  ): DaypartTotals => {
    const ticketsForPart = bucket.orders.size;
    return {
      daypart,
      hours:
        daypart === "lunch"
          ? `00:00–${String(DINNER_START_HOUR).padStart(2, "0")}:00`
          : `${String(DINNER_START_HOUR).padStart(2, "0")}:00–24:00`,
      net_sales: Math.round(bucket.net * 100) / 100,
      tickets: ticketsForPart,
      avg_ticket: ticketsForPart > 0 ? bucket.net / ticketsForPart : 0,
    };
  };

  const thisWeek = windows
    ? {
        from: windows.thisWeek.from,
        to: windows.thisWeek.to,
        net_sales: Math.round(weekNet.thisWeek * 100) / 100,
        tickets: weekTickets.thisWeek.size,
      }
    : null;
  const lastWeek = windows
    ? {
        from: windows.lastWeek.from,
        to: windows.lastWeek.to,
        net_sales: Math.round(weekNet.lastWeek * 100) / 100,
        tickets: weekTickets.lastWeek.size,
      }
    : null;

  return {
    currency: currency ?? "USD",
    timezone,
    period_from: earliestDate,
    period_to: latestDate,
    revenue: finalized,
    tickets,
    units: Math.round(units * 1000) / 1000,
    avg_ticket: tickets > 0 ? finalized.net_sales / tickets : 0,
    this_week: thisWeek,
    last_week: lastWeek,
    week_delta_pct:
      thisWeek && lastWeek
        ? pctChange(thisWeek.net_sales, lastWeek.net_sales)
        : null,
    heatmap,
    dayparts: [toDaypart("lunch", lunch), toDaypart("dinner", dinner)],
    channel_mix_over_time: toMixSeries(channelWeeks),
    payment_mix_over_time: toMixSeries(paymentWeeks),
    category_mix: Array.from(categoryBuckets.values())
      .map((b) => ({
        category: b.category,
        net_sales: Math.round(b.net * 100) / 100,
        tickets: b.orders.size,
        units: Math.round(b.units * 1000) / 1000,
      }))
      .sort((a, b) => b.net_sales - a.net_sales),
    rows_reviewed: rowsReviewed,
  };
}
