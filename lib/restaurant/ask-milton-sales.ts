// lib/restaurant/ask-milton-sales.ts
//
// Compact POS sales snapshot for Ask Milton. Pure aggregation + a thin
// fetch that reuses the cockpit's paginated `pos_sales_items` reader
// (`fetchCompanyPosSalesRows` / `fetchAllRows`). No raw rows are returned.
//
// Weekday and hour are resolved in the restaurant's IANA timezone via
// `getLocalMoment` (same helper as the briefing-email scheduler) when
// `order_placed_at` is present. `sale_date` is already a local calendar
// date from Odoo sync — it is never interpreted as UTC midnight.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalMoment } from "@/lib/restaurant/email/scheduler";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  fetchCompanyPosSalesRows,
  type PosSalesItemRow,
} from "@/lib/restaurant/supabase-sales";
import {
  succeededRows,
  warnIfTruncated,
} from "@/lib/restaurant/paginated-read";

export const SALES_SNAPSHOT_CAPS = {
  categories: 12,
  channels: 8,
  payments: 8,
  topItems: 10,
  topCategories: 5,
  itemsPerCategory: 5,
} as const;

/** Hard cap on the JSON we hand the model — no raw POS rows. */
export const SALES_SNAPSHOT_MAX_JSON_CHARS = 12_000;

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

export type SalesPeriodSource =
  | "named_period"
  | "latest_month"
  | "last_week"
  | "empty";

export interface SalesSnapshotBucket {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface SalesSnapshotItem {
  name: string;
  category: string | null;
  revenue: number;
  units: number;
  orders: number;
}

export interface SalesCategoryWeekday {
  category: string;
  weekdays: SalesSnapshotBucket[];
}

export interface SalesCategoryItems {
  category: string;
  items: SalesSnapshotItem[];
}

export interface AskMiltonSalesPeriod {
  start: string | null;
  end: string | null;
  source: SalesPeriodSource;
  timezone: string;
  rows_reviewed: number;
  truncated: boolean;
}

export interface AskMiltonSalesSnapshot {
  available: boolean;
  unavailable_reason: string | null;
  period: AskMiltonSalesPeriod;
  totals: {
    revenue: number;
    orders: number;
    units: number;
    avg_ticket: number;
    currency: string;
  };
  by_weekday: SalesSnapshotBucket[];
  by_hour: SalesSnapshotBucket[];
  by_category: SalesSnapshotBucket[];
  by_channel: SalesSnapshotBucket[];
  by_payment: SalesSnapshotBucket[];
  top_items_by_units: SalesSnapshotItem[];
  top_items_by_revenue: SalesSnapshotItem[];
  top_items_by_category: SalesCategoryItems[];
  /** Weekday split for the top categories — breakfast-by-day questions. */
  by_category_weekday: SalesCategoryWeekday[];
}

export interface SalesFactRow {
  sale_date: string;
  order_placed_at: string | null;
  item_name: string;
  quantity: number;
  revenue: number;
  order_key: string | null;
  sales_channel: string | null;
  payment_type: string | null;
  category: string | null;
  currency: string;
}

interface MetricBucket {
  revenue: number;
  units: number;
  orders: Set<string>;
}

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  febrero: 2,
  february: 2,
  march: 3,
  marzo: 3,
  april: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  june: 6,
  junio: 6,
  july: 7,
  julio: 7,
  august: 8,
  agosto: 8,
  september: 9,
  septiembre: 9,
  october: 10,
  octubre: 10,
  november: 11,
  noviembre: 11,
  december: 12,
  diciembre: 12,
};

function roundInt(n: number): number {
  return Math.round(n);
}

function emptyBucket(): MetricBucket {
  return { revenue: 0, units: 0, orders: new Set() };
}

function bump(b: MetricBucket, row: SalesFactRow): void {
  b.revenue += row.revenue;
  b.units += row.quantity;
  if (row.order_key) b.orders.add(row.order_key);
}

function toSnapshotBucket(
  key: string,
  label: string,
  b: MetricBucket
): SalesSnapshotBucket {
  return {
    key,
    label,
    revenue: roundInt(b.revenue),
    orders: b.orders.size,
    units: roundInt(b.units),
  };
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function rowQuantity(row: PosSalesItemRow): number {
  return typeof row.quantity === "number" && Number.isFinite(row.quantity)
    ? row.quantity
    : 0;
}

function rowRevenue(row: PosSalesItemRow): number {
  if (
    typeof row.gross_revenue === "number" &&
    Number.isFinite(row.gross_revenue)
  ) {
    return row.gross_revenue;
  }
  if (typeof row.net_revenue === "number" && Number.isFinite(row.net_revenue)) {
    return row.net_revenue;
  }
  return 0;
}

/** Cockpit explorer semantics: trim, empty → null. */
export function toSalesFactRow(row: PosSalesItemRow): SalesFactRow {
  return {
    sale_date: row.sale_date,
    order_placed_at: row.order_placed_at ?? null,
    item_name: (row.raw_item_name ?? "").trim(),
    quantity: rowQuantity(row),
    revenue: rowRevenue(row),
    order_key: row.check_id ?? row.order_id ?? null,
    sales_channel: trimOrNull(row.sales_channel),
    payment_type: trimOrNull(row.payment_type),
    category: trimOrNull(row.category),
    currency: row.currency ?? "USD",
  };
}

export function emptySalesSnapshot(
  timezone = "UTC",
  reason: string | null = null
): AskMiltonSalesSnapshot {
  return {
    available: false,
    unavailable_reason: reason,
    period: {
      start: null,
      end: null,
      source: "empty",
      timezone,
      rows_reviewed: 0,
      truncated: false,
    },
    totals: {
      revenue: 0,
      orders: 0,
      units: 0,
      avg_ticket: 0,
      currency: "USD",
    },
    by_weekday: [],
    by_hour: [],
    by_category: [],
    by_channel: [],
    by_payment: [],
    top_items_by_units: [],
    top_items_by_revenue: [],
    top_items_by_category: [],
    by_category_weekday: [],
  };
}

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
  row: Pick<SalesFactRow, "sale_date" | "order_placed_at">,
  timezone: string
): { weekday: number; hour: number | null; dateKey: string } {
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

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

interface NamedMonth {
  month: number;
  year: number | null;
}

function namedMonthFromQuestion(question: string): NamedMonth | null {
  const folded = foldText(question);
  let month: number | null = null;
  for (const [name, index] of Object.entries(MONTH_INDEX)) {
    if (folded.includes(name)) {
      month = index;
      break;
    }
  }
  if (month === null) {
    const iso = folded.match(/\b(20\d{2})-(\d{2})\b/);
    if (iso) {
      return { year: Number(iso[1]), month: Number(iso[2]) };
    }
    return null;
  }
  const yearMatch = folded.match(/\b(20\d{2})\b/);
  return { month, year: yearMatch ? Number(yearMatch[1]) : null };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveSalesPeriod(
  question: string | undefined,
  saleDates: string[]
): { start: string; end: string; source: SalesPeriodSource } | null {
  const dates = saleDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (dates.length === 0) return null;
  const maxDate = dates[dates.length - 1];
  const [maxYear, maxMonth] = maxDate.split("-").map(Number);

  const q = question ?? "";
  const folded = foldText(q);
  if (
    folded.includes("last week") ||
    folded.includes("semana pasada") ||
    folded.includes("la semana pasada")
  ) {
    return {
      start: shiftDateKey(maxDate, -6),
      end: maxDate,
      source: "last_week",
    };
  }

  const named = namedMonthFromQuestion(q);
  if (named) {
    const year = named.year ?? maxYear;
    const start = `${year}-${String(named.month).padStart(2, "0")}-01`;
    const end = `${year}-${String(named.month).padStart(2, "0")}-${String(lastDayOfMonth(year, named.month)).padStart(2, "0")}`;
    return { start, end, source: "named_period" };
  }

  const start = `${maxYear}-${String(maxMonth).padStart(2, "0")}-01`;
  const end = `${maxYear}-${String(maxMonth).padStart(2, "0")}-${String(lastDayOfMonth(maxYear, maxMonth)).padStart(2, "0")}`;
  return { start, end, source: "latest_month" };
}

function inRange(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey <= end;
}

function breakdownFromMap(
  map: Map<string, MetricBucket>,
  cap: number,
  unknownLabel: string
): SalesSnapshotBucket[] {
  return Array.from(map.entries())
    .map(([key, b]) =>
      toSnapshotBucket(key, key === "" ? unknownLabel : key, b)
    )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, cap);
}

function itemFromBucket(
  name: string,
  category: string | null,
  b: MetricBucket
): SalesSnapshotItem {
  return {
    name,
    category,
    revenue: roundInt(b.revenue),
    units: roundInt(b.units),
    orders: b.orders.size,
  };
}

/**
 * Pure — no I/O. Aggregates already-scoped POS facts into the compact
 * snapshot the model (and the deterministic fallback) may quote.
 */
export function buildSalesSnapshot(
  rows: SalesFactRow[],
  timezone: string,
  options: {
    question?: string;
    truncated?: boolean;
  } = {}
): AskMiltonSalesSnapshot {
  const tz = normalizeTimezone(timezone) ?? "UTC";
  const period = resolveSalesPeriod(
    options.question,
    rows.map((r) => r.sale_date)
  );
  if (!period) {
    return emptySalesSnapshot(tz, "no_sales");
  }

  const windowed = rows.filter((r) =>
    inRange(r.sale_date, period.start, period.end)
  );
  if (windowed.length === 0) {
    return {
      ...emptySalesSnapshot(tz, "no_sales_in_period"),
      period: {
        start: period.start,
        end: period.end,
        source: period.source,
        timezone: tz,
        rows_reviewed: 0,
        truncated: options.truncated === true,
      },
    };
  }

  const weekdayBuckets = WEEKDAY_KEYS.map(() => emptyBucket());
  const hourBuckets = Array.from({ length: 24 }, () => emptyBucket());
  const hourSeen = new Array<boolean>(24).fill(false);
  const categoryBuckets = new Map<string, MetricBucket>();
  const channelBuckets = new Map<string, MetricBucket>();
  const paymentBuckets = new Map<string, MetricBucket>();
  const itemBuckets = new Map<
    string,
    { name: string; category: string | null; bucket: MetricBucket }
  >();
  const categoryWeekday = new Map<string, MetricBucket[]>();

  let totalRevenue = 0;
  let totalUnits = 0;
  const orderIds = new Set<string>();
  const currency = windowed[0]?.currency || "USD";

  for (const row of windowed) {
    totalRevenue += row.revenue;
    totalUnits += row.quantity;
    if (row.order_key) orderIds.add(row.order_key);

    const local = localWeekdayAndHour(row, tz);
    bump(weekdayBuckets[local.weekday] ?? weekdayBuckets[0], row);
    if (local.hour !== null) {
      hourSeen[local.hour] = true;
      bump(hourBuckets[local.hour], row);
    }

    const catKey = row.category ?? "";
    let cat = categoryBuckets.get(catKey);
    if (!cat) {
      cat = emptyBucket();
      categoryBuckets.set(catKey, cat);
    }
    bump(cat, row);

    let catDays = categoryWeekday.get(catKey);
    if (!catDays) {
      catDays = WEEKDAY_KEYS.map(() => emptyBucket());
      categoryWeekday.set(catKey, catDays);
    }
    bump(catDays[local.weekday] ?? catDays[0], row);

    const chKey = row.sales_channel ?? "";
    let ch = channelBuckets.get(chKey);
    if (!ch) {
      ch = emptyBucket();
      channelBuckets.set(chKey, ch);
    }
    bump(ch, row);

    const payKey = row.payment_type ?? "";
    let pay = paymentBuckets.get(payKey);
    if (!pay) {
      pay = emptyBucket();
      paymentBuckets.set(payKey, pay);
    }
    bump(pay, row);

    const itemKey = row.item_name.toLowerCase() || "(unnamed)";
    let item = itemBuckets.get(itemKey);
    if (!item) {
      item = {
        name: row.item_name || "(unnamed)",
        category: row.category,
        bucket: emptyBucket(),
      };
      itemBuckets.set(itemKey, item);
    }
    bump(item.bucket, row);
  }

  const orders = orderIds.size;
  const byCategory = breakdownFromMap(
    categoryBuckets,
    SALES_SNAPSHOT_CAPS.categories,
    "Uncategorized"
  );
  const topCategoryKeys = byCategory
    .filter((c) => c.key !== "")
    .slice(0, SALES_SNAPSHOT_CAPS.topCategories)
    .map((c) => c.key);

  const items = Array.from(itemBuckets.values()).map((i) =>
    itemFromBucket(i.name, i.category, i.bucket)
  );
  const topByRevenue = [...items]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, SALES_SNAPSHOT_CAPS.topItems);
  const topByUnits = [...items]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, SALES_SNAPSHOT_CAPS.topItems);

  const topItemsByCategory: SalesCategoryItems[] = topCategoryKeys.map(
    (category) => ({
      category,
      items: items
        .filter((i) => i.category === category)
        .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
        .slice(0, SALES_SNAPSHOT_CAPS.itemsPerCategory),
    })
  );

  const byCategoryWeekday: SalesCategoryWeekday[] = topCategoryKeys.map(
    (category) => ({
      category,
      weekdays: WEEKDAY_KEYS.map((label, idx) =>
        toSnapshotBucket(
          label,
          label,
          categoryWeekday.get(category)?.[idx] ?? emptyBucket()
        )
      ),
    })
  );

  const snapshot: AskMiltonSalesSnapshot = {
    available: true,
    unavailable_reason: null,
    period: {
      start: period.start,
      end: period.end,
      source: period.source,
      timezone: tz,
      rows_reviewed: windowed.length,
      truncated: options.truncated === true,
    },
    totals: {
      revenue: roundInt(totalRevenue),
      orders,
      units: roundInt(totalUnits),
      avg_ticket: orders > 0 ? roundInt(totalRevenue / orders) : 0,
      currency,
    },
    by_weekday: WEEKDAY_KEYS.map((label, idx) =>
      toSnapshotBucket(label, label, weekdayBuckets[idx])
    ),
    by_hour: hourBuckets
      .map((b, hour) =>
        hourSeen[hour]
          ? toSnapshotBucket(
              String(hour).padStart(2, "0"),
              `${String(hour).padStart(2, "0")}:00`,
              b
            )
          : null
      )
      .filter((b): b is SalesSnapshotBucket => b !== null),
    by_category: byCategory,
    by_channel: breakdownFromMap(
      channelBuckets,
      SALES_SNAPSHOT_CAPS.channels,
      "Unknown channel"
    ),
    by_payment: breakdownFromMap(
      paymentBuckets,
      SALES_SNAPSHOT_CAPS.payments,
      "Unknown payment"
    ),
    top_items_by_units: topByUnits,
    top_items_by_revenue: topByRevenue,
    top_items_by_category: topItemsByCategory,
    by_category_weekday: byCategoryWeekday,
  };

  return clampSalesSnapshot(snapshot);
}

function clampSalesSnapshot(
  snapshot: AskMiltonSalesSnapshot
): AskMiltonSalesSnapshot {
  if (JSON.stringify(snapshot).length <= SALES_SNAPSHOT_MAX_JSON_CHARS) {
    return snapshot;
  }
  return {
    ...snapshot,
    by_hour: [...snapshot.by_hour]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .sort((a, b) => a.key.localeCompare(b.key)),
    by_category: snapshot.by_category.slice(0, 8),
    top_items_by_units: snapshot.top_items_by_units.slice(0, 8),
    top_items_by_revenue: snapshot.top_items_by_revenue.slice(0, 8),
    top_items_by_category: snapshot.top_items_by_category.slice(0, 3),
    by_category_weekday: snapshot.by_category_weekday.slice(0, 3),
  };
}

export function salesSnapshotJsonSize(
  snapshot: AskMiltonSalesSnapshot
): number {
  return JSON.stringify(snapshot).length;
}

export async function resolvePosTimezone(
  supabase: SupabaseClient,
  companyId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("restaurant_pos_connections")
      .select("timezone")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const fromConn = normalizeTimezone(data?.timezone);
    if (fromConn) return fromConn;
  } catch (err) {
    console.error("[ask-milton-sales] timezone lookup:", err);
  }
  try {
    const { data } = await supabase
      .from("companies")
      .select("briefing_email_timezone")
      .eq("id", companyId)
      .maybeSingle();
    const fromCompany = normalizeTimezone(data?.briefing_email_timezone);
    if (fromCompany) return fromCompany;
  } catch (err) {
    console.error("[ask-milton-sales] company timezone lookup:", err);
  }
  return "UTC";
}

export async function fetchAskMiltonSalesSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  selectedLocationId?: string | null,
  question?: string
): Promise<{ snapshot: AskMiltonSalesSnapshot; readError: boolean }> {
  const timezone = await resolvePosTimezone(supabase, companyId);
  const result = await fetchCompanyPosSalesRows(
    supabase,
    companyId,
    selectedLocationId
  );
  if (result.error) {
    console.error(
      "[ask-milton-sales] pos_sales_items read failed:",
      result.error.message
    );
    return {
      snapshot: emptySalesSnapshot(timezone, "read_error"),
      readError: true,
    };
  }
  warnIfTruncated("ask-milton-sales pos_sales_items", result);
  const rows = succeededRows(result).map(toSalesFactRow);
  const snapshot = buildSalesSnapshot(rows, timezone, {
    question,
    truncated: result.truncated,
  });
  return { snapshot, readError: false };
}

/** Match a question fragment to a POS category label (accents ignored). */
export function matchCategoryFromQuestion(
  question: string,
  categories: string[]
): string | null {
  const folded = foldText(question);
  let best: string | null = null;
  let bestLen = 0;
  for (const category of categories) {
    const key = foldText(category);
    if (!key) continue;
    const stem = key.endsWith("s") ? key.slice(0, -1) : key;
    if (folded.includes(key) || folded.includes(stem)) {
      if (key.length > bestLen) {
        best = category;
        bestLen = key.length;
      }
    }
  }
  // English/Spanish aliases for common meal periods when the POS label
  // is local (Desayunos) but the operator asked in English (breakfast).
  if (!best) {
    const aliases: Record<string, string[]> = {
      breakfast: ["desayuno"],
      desayuno: ["breakfast"],
      lunch: ["almuerzo", "comida"],
      dinner: ["cena"],
      drink: ["bebida"],
    };
    for (const category of categories) {
      const key = foldText(category);
      for (const [en, es] of Object.entries(aliases)) {
        const needles = [en, ...es];
        if (
          needles.some((n) => folded.includes(n)) &&
          needles.some((n) => key.includes(n))
        ) {
          return category;
        }
      }
    }
  }
  return best;
}
