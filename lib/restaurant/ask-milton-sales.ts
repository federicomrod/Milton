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
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  fetchCompanyPosSalesRows,
  type PosSalesItemRow,
} from "@/lib/restaurant/supabase-sales";
import {
  succeededRows,
  warnIfTruncated,
} from "@/lib/restaurant/paginated-read";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  classifySaleLine,
  emptyRevenueBreakdown,
  finalizeRevenueBreakdown,
  addClassifiedLine,
} from "@/lib/restaurant/sales-revenue";
import {
  localWeekdayAndHour,
  WEEKDAY_KEYS,
  weekdayFromDateKey,
  type WeekdayKey,
} from "@/lib/restaurant/pos-local-time";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { displayName } from "@/lib/restaurant/sentence-case";

export {
  localWeekdayAndHour,
  WEEKDAY_KEYS,
  weekdayFromDateKey,
  resolvePosTimezone,
};
export type { WeekdayKey };

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

/** Item and category names are truncated so the JSON cap stays reachable. */
export const SALES_SNAPSHOT_MAX_NAME_CHARS = 80;

export type SalesPeriodSource =
  | "named_period"
  | "latest_month"
  | "last_week"
  /** «últimos 14 días», «last 2 weeks»: the N days ending on the latest sale. */
  | "last_days"
  | "empty";

export interface SalesSnapshotBucket {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  units: number;
}

/** Weekday totals plus the day count behind them, so averages are honest. */
export interface SalesWeekdayBucket extends SalesSnapshotBucket {
  /** Distinct dates of this weekday in the period that had sales. */
  day_count: number;
  avg_revenue_per_day: number;
  avg_orders_per_day: number;
}

export interface SalesDateBucket {
  date: string;
  weekday: WeekdayKey;
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
  weekdays: SalesWeekdayBucket[];
}

export interface SalesCategoryItems {
  category: string;
  items: SalesSnapshotItem[];
}

export interface AskMiltonSalesPeriod {
  start: string | null;
  end: string | null;
  source: SalesPeriodSource;
  /** Window length for last_week / last_days, so answers can say «7 días». */
  days?: number;
  timezone: string;
  rows_reviewed: number;
  truncated: boolean;
}

export interface AskMiltonSalesSnapshot {
  available: boolean;
  unavailable_reason: string | null;
  period: AskMiltonSalesPeriod;
  totals: {
    /** Net sales — tips excluded. Matches the cockpit. */
    revenue: number;
    orders: number;
    units: number;
    avg_ticket: number;
    currency: string;
    gross_sales: number;
    discounts: number;
    net_sales: number;
    tips: number;
    odoo_like_total: number;
  };
  by_weekday: SalesWeekdayBucket[];
  by_hour: SalesSnapshotBucket[];
  by_category: SalesSnapshotBucket[];
  by_channel: SalesSnapshotBucket[];
  by_payment: SalesSnapshotBucket[];
  top_items_by_units: SalesSnapshotItem[];
  top_items_by_revenue: SalesSnapshotItem[];
  top_items_by_category: SalesCategoryItems[];
  /** Weekday split for the top categories — breakfast-by-day questions. */
  by_category_weekday: SalesCategoryWeekday[];
  /** Compact daily totals for dates that had sales (may be trimmed to fit the JSON cap). */
  by_date: SalesDateBucket[];
  best_date: SalesDateBucket | null;
  worst_date: SalesDateBucket | null;
}

export interface SalesFactRow {
  sale_date: string;
  order_placed_at: string | null;
  item_name: string;
  quantity: number;
  /** Posted line amount (tax-incl, post-discount). Net is derived via is_tip. */
  revenue: number;
  order_key: string | null;
  sales_channel: string | null;
  payment_type: string | null;
  category: string | null;
  currency: string;
  is_tip?: boolean;
  discount_amount?: number;
  /** Source line id (Odoo pos.order.line id). */
  line_id?: string | null;
  /**
   * Set on a combo component line: the line id of the combo it belongs to.
   * Its units are the combo's, already counted once on the parent line.
   */
  combo_parent_line_id?: string | null;
}

interface MetricBucket {
  revenue: number;
  units: number;
  orders: Set<string>;
}

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  enero: 1,
  jan: 1,
  ene: 1,
  february: 2,
  febrero: 2,
  feb: 2,
  march: 3,
  marzo: 3,
  mar: 3,
  april: 4,
  abril: 4,
  apr: 4,
  abr: 4,
  may: 5,
  mayo: 5,
  june: 6,
  junio: 6,
  jun: 6,
  july: 7,
  julio: 7,
  jul: 7,
  august: 8,
  agosto: 8,
  aug: 8,
  ago: 8,
  september: 9,
  septiembre: 9,
  sep: 9,
  sept: 9,
  october: 10,
  octubre: 10,
  oct: 10,
  november: 11,
  noviembre: 11,
  nov: 11,
  december: 12,
  diciembre: 12,
  dec: 12,
  dic: 12,
};

/**
 * English "may" is also a modal verb. Whole-word `\bmay\b` would treat
 * "what may be best" as May; only accept month-like context.
 */
const ENGLISH_MAY_AS_MONTH = /\bin may\b|\bmay 20\d{2}\b/;

const MONTH_NAME_PATTERNS: Array<{ name: string; index: number; re: RegExp }> =
  Object.entries(MONTH_INDEX).map(([name, index]) => ({
    name,
    index,
    re: new RegExp(`\\b${name}\\b`),
  }));

function capName(name: string): string {
  return name.slice(0, SALES_SNAPSHOT_MAX_NAME_CHARS);
}

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

function avgPerDay(total: number, dayCount: number): number {
  return dayCount > 0 ? roundInt(total / dayCount) : 0;
}

function toWeekdayBucket(
  key: string,
  label: string,
  b: MetricBucket,
  dayCount: number
): SalesWeekdayBucket {
  const bucket = toSnapshotBucket(key, label, b);
  return {
    ...bucket,
    day_count: dayCount,
    avg_revenue_per_day: avgPerDay(bucket.revenue, dayCount),
    avg_orders_per_day: avgPerDay(bucket.orders, dayCount),
  };
}

function toDateBucket(
  date: string,
  weekday: WeekdayKey,
  b: MetricBucket
): SalesDateBucket {
  return {
    date,
    weekday,
    revenue: roundInt(b.revenue),
    orders: b.orders.size,
    units: roundInt(b.units),
  };
}

function compareDateBuckets(a: SalesDateBucket, b: SalesDateBucket): number {
  return b.revenue - a.revenue || b.orders - a.orders || b.units - a.units;
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

/** Cockpit explorer semantics: trim, empty → null. */
export function toSalesFactRow(row: PosSalesItemRow): SalesFactRow {
  const line = classifySaleLine(row);
  return {
    sale_date: row.sale_date,
    order_placed_at: row.order_placed_at ?? null,
    item_name: (row.raw_item_name ?? "").trim(),
    quantity: rowQuantity(row),
    revenue: line.posted,
    order_key: row.check_id ?? row.order_id ?? null,
    sales_channel: trimOrNull(row.sales_channel),
    payment_type: trimOrNull(row.payment_type),
    category: trimOrNull(row.category),
    currency: row.currency ?? "USD",
    is_tip: line.isTip,
    discount_amount: line.discount,
    line_id: row.external_line_id ?? null,
    combo_parent_line_id: comboParentLineId(row),
  };
}

/** The combo line a component belongs to; null on normal and parent lines. */
function comboParentLineId(row: PosSalesItemRow): string | null {
  const parent = trimOrNull(row.combo_parent_external_line_id);
  if (!parent) return null;
  if (row.external_line_id && parent === String(row.external_line_id)) {
    return null;
  }
  return parent;
}

/**
 * The dish name an owner recognises, from the POS line name: Odoo appends
 * the chosen options in brackets («Típico Nicaragüense (Huevo, Queso)»), and
 * some menus are typed in capitals. Display only — never used to match.
 */
/** A combo component line: points at a parent line other than itself. */
function isComboComponent(row: SalesFactRow): boolean {
  const parent = row.combo_parent_line_id;
  return Boolean(parent) && parent !== row.line_id;
}

export function cleanPosItemName(raw: string | null | undefined): string {
  let name = (raw ?? "").replace(/\s+/g, " ").trim();
  name = name.replace(/^["'«“]+|["'»”]+$/g, "").trim();
  const withoutOptions = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  if (withoutOptions) name = withoutOptions;
  name = name.replace(/^["'«“]+|["'»”]+$/g, "").trim();
  return displayName(name);
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
      gross_sales: 0,
      discounts: 0,
      net_sales: 0,
      tips: 0,
      odoo_like_total: 0,
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
    by_date: [],
    best_date: null,
    worst_date: null,
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

function monthNameInQuestion(
  folded: string,
  name: string,
  re: RegExp
): boolean {
  if (!re.test(folded)) return false;
  if (name === "may") return ENGLISH_MAY_AS_MONTH.test(folded);
  return true;
}

function namedMonthFromQuestion(question: string): NamedMonth | null {
  const folded = foldText(question);
  let month: number | null = null;
  for (const { name, index, re } of MONTH_NAME_PATTERNS) {
    if (monthNameInQuestion(folded, name, re)) {
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

const COUNT_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  catorce: 14,
  quince: 15,
  treinta: 30,
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fourteen: 14,
  fifteen: 15,
  thirty: 30,
};
const COUNT_TOKEN = `(\\d{1,3}|${Object.keys(COUNT_WORDS).join("|")})`;
const LAST_N_RE = new RegExp(
  `\\b(?:ultim[oa]s?|pasad[oa]s?|last|past|previous)\\s+${COUNT_TOKEN}\\s+(dias?|semanas?|days?|weeks?)\\b`
);
const N_LAST_RE = new RegExp(
  `\\b${COUNT_TOKEN}\\s+(dias?|semanas?|days?|weeks?)\\s+(?:pasad[oa]s?|atras)\\b`
);
// «última semana», «la ultima semanas», «semana pasada», «esta semana»,
// «last week», «past week», «this week», «últimos días» (no number).
const ONE_WEEK_RE =
  /\b(?:(?:ultim[oa]s?|pasad[oa]s?|esta|this|last|past|previous)\s+semanas?|semanas?\s+pasad[oa]s?|(?:this|last|past|previous)\s+week)\b/;

function toCount(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return COUNT_WORDS[token] ?? null;
}

/**
 * Days in a relative window named by the question, or null. Every window
 * ends on the latest sale date, so a stale sync shows its real dates
 * instead of an empty week.
 */
export function relativeWindowDays(folded: string): number | null {
  const m = folded.match(LAST_N_RE) ?? folded.match(N_LAST_RE);
  if (m) {
    const n = toCount(m[1]);
    if (n !== null && n >= 1) {
      const unitDays = m[2].startsWith("sem") || m[2].startsWith("week") ? 7 : 1;
      return Math.min(n * unitDays, 366);
    }
  }
  if (ONE_WEEK_RE.test(folded)) return 7;
  return null;
}

export function resolveSalesPeriod(
  question: string | undefined,
  saleDates: string[]
): {
  start: string;
  end: string;
  source: SalesPeriodSource;
  days?: number;
} | null {
  const dates = saleDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (dates.length === 0) return null;
  const maxDate = dates[dates.length - 1];
  const [maxYear, maxMonth] = maxDate.split("-").map(Number);

  const q = question ?? "";
  const folded = foldText(q);
  const days = relativeWindowDays(folded);
  if (days !== null) {
    return {
      start: shiftDateKey(maxDate, -(days - 1)),
      end: maxDate,
      source: days === 7 ? "last_week" : "last_days",
      days,
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
    name: capName(name),
    category: category == null ? null : capName(category),
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
    currency?: string;
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
        ...(period.days ? { days: period.days } : {}),
        timezone: tz,
        rows_reviewed: 0,
        truncated: options.truncated === true,
      },
    };
  }

  const weekdayBuckets = WEEKDAY_KEYS.map(() => emptyBucket());
  const weekdayDates = WEEKDAY_KEYS.map(() => new Set<string>());
  const dateBuckets = new Map<string, MetricBucket>();
  const dateWeekday = new Map<string, WeekdayKey>();
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
  const categoryWeekdayDates = new Map<string, Set<string>[]>();

  let totalUnits = 0;
  const orderIds = new Set<string>();
  const revenueAcc = emptyRevenueBreakdown();
  const currency = options.currency || windowed[0]?.currency || "USD";

  // Combo components: Odoo writes one line per component with the combo's
  // quantity, so counting them would sell one combo two or three times.
  // Like Menú, the units stay on the combo line and a component's money
  // is credited to the combo.
  const comboNameByLineId = new Map<string, string>();
  for (const row of windowed) {
    if (row.line_id && !isComboComponent(row)) {
      comboNameByLineId.set(row.line_id, row.item_name);
    }
  }

  for (const row of windowed) {
    if (options.currency && row.currency && row.currency !== options.currency) {
      continue;
    }
    const line = classifySaleLine({
      item_name: row.item_name,
      is_tip: row.is_tip,
      revenue: row.revenue,
      discount_amount: row.discount_amount,
    });
    addClassifiedLine(revenueAcc, line);
    if (row.order_key) orderIds.add(row.order_key);
    if (line.isTip) continue;
    const isComboPart = isComboComponent(row);
    if (!isComboPart) totalUnits += row.quantity;
    const netRow = {
      ...row,
      revenue: line.net,
      quantity: isComboPart ? 0 : row.quantity,
    };

    const local = localWeekdayAndHour(row, tz);
    const weekdayIdx = weekdayBuckets[local.weekday] ? local.weekday : 0;
    bump(weekdayBuckets[weekdayIdx], netRow);
    weekdayDates[weekdayIdx].add(local.dateKey);
    let dayBucket = dateBuckets.get(local.dateKey);
    if (!dayBucket) {
      dayBucket = emptyBucket();
      dateBuckets.set(local.dateKey, dayBucket);
    }
    bump(dayBucket, netRow);
    dateWeekday.set(local.dateKey, WEEKDAY_KEYS[weekdayIdx]);
    if (local.hour !== null) {
      hourSeen[local.hour] = true;
      bump(hourBuckets[local.hour], netRow);
    }

    const category = row.category == null ? null : capName(row.category);
    const comboName = isComboPart
      ? comboNameByLineId.get(row.combo_parent_line_id ?? "")
      : undefined;
    const itemName = capName(
      cleanPosItemName(comboName ?? row.item_name) || "(unnamed)"
    );
    const catKey = category ?? "";
    let cat = categoryBuckets.get(catKey);
    if (!cat) {
      cat = emptyBucket();
      categoryBuckets.set(catKey, cat);
    }
    bump(cat, netRow);

    let catDays = categoryWeekday.get(catKey);
    if (!catDays) {
      catDays = WEEKDAY_KEYS.map(() => emptyBucket());
      categoryWeekday.set(catKey, catDays);
      categoryWeekdayDates.set(
        catKey,
        WEEKDAY_KEYS.map(() => new Set<string>())
      );
    }
    const catDayIdx = catDays[local.weekday] ? local.weekday : 0;
    bump(catDays[catDayIdx], netRow);
    categoryWeekdayDates.get(catKey)?.[catDayIdx]?.add(local.dateKey);

    const chKey = row.sales_channel ?? "";
    let ch = channelBuckets.get(chKey);
    if (!ch) {
      ch = emptyBucket();
      channelBuckets.set(chKey, ch);
    }
    bump(ch, netRow);

    const payKey = row.payment_type ?? "";
    let pay = paymentBuckets.get(payKey);
    if (!pay) {
      pay = emptyBucket();
      paymentBuckets.set(payKey, pay);
    }
    bump(pay, netRow);

    // A component whose combo line is outside the read adds money to the
    // totals above but is not an item of its own.
    if (isComboPart && comboName === undefined) continue;
    const itemKey = foldText(itemName) || "(unnamed)";
    let item = itemBuckets.get(itemKey);
    if (!item) {
      item = {
        name: itemName,
        category,
        bucket: emptyBucket(),
      };
      itemBuckets.set(itemKey, item);
    }
    bump(item.bucket, netRow);
  }

  const orders = orderIds.size;
  const finalizedRevenue = finalizeRevenueBreakdown(revenueAcc);
  const totalRevenue = finalizedRevenue.net_sales;
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
      category: capName(category),
      items: items
        .filter((i) => i.category === category)
        .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
        .slice(0, SALES_SNAPSHOT_CAPS.itemsPerCategory),
    })
  );

  const byCategoryWeekday: SalesCategoryWeekday[] = topCategoryKeys.map(
    (category) => ({
      category: capName(category),
      weekdays: WEEKDAY_KEYS.map((label, idx) =>
        toWeekdayBucket(
          label,
          label,
          categoryWeekday.get(category)?.[idx] ?? emptyBucket(),
          categoryWeekdayDates.get(category)?.[idx]?.size ?? 0
        )
      ),
    })
  );

  const byDate = Array.from(dateBuckets.entries())
    .map(([date, b]) =>
      toDateBucket(
        date,
        dateWeekday.get(date) ?? WEEKDAY_KEYS[weekdayFromDateKey(date)],
        b
      )
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const datesByRevenue = [...byDate].sort(compareDateBuckets);

  const snapshot: AskMiltonSalesSnapshot = {
    available: true,
    unavailable_reason: null,
    period: {
      start: period.start,
      end: period.end,
      source: period.source,
      ...(period.days ? { days: period.days } : {}),
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
      gross_sales: roundInt(finalizedRevenue.gross_sales),
      discounts: roundInt(finalizedRevenue.discounts),
      net_sales: roundInt(finalizedRevenue.net_sales),
      tips: roundInt(finalizedRevenue.tips),
      odoo_like_total: roundInt(finalizedRevenue.odoo_like_total),
    },
    by_weekday: WEEKDAY_KEYS.map((label, idx) =>
      toWeekdayBucket(label, label, weekdayBuckets[idx], weekdayDates[idx].size)
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
    by_date: byDate,
    best_date: datesByRevenue[0] ?? null,
    worst_date: datesByRevenue[datesByRevenue.length - 1] ?? null,
  };

  return clampSalesSnapshot(snapshot);
}

const SNAPSHOT_LIST_KEYS = [
  "by_date",
  "by_hour",
  "by_category",
  "by_channel",
  "by_payment",
  "top_items_by_units",
  "top_items_by_revenue",
  "top_items_by_category",
  "by_category_weekday",
] as const;

/** Keep the strongest and weakest dates when the full daily list is too large. */
function compactDateList(dates: SalesDateBucket[]): SalesDateBucket[] {
  if (dates.length <= 8) return dates;
  const byRev = [...dates].sort(compareDateBuckets);
  const keep = new Set<string>();
  for (const d of byRev.slice(0, 5)) keep.add(d.date);
  for (const d of byRev.slice(-3)) keep.add(d.date);
  return dates.filter((d) => keep.has(d.date));
}

function capSalesSnapshotNames(
  snapshot: AskMiltonSalesSnapshot
): AskMiltonSalesSnapshot {
  const capBucket = (b: SalesSnapshotBucket): SalesSnapshotBucket => ({
    ...b,
    key: capName(b.key),
    label: capName(b.label),
  });
  const capItem = (item: SalesSnapshotItem): SalesSnapshotItem => ({
    ...item,
    name: capName(item.name),
    category: item.category == null ? null : capName(item.category),
  });
  return {
    ...snapshot,
    by_category: snapshot.by_category.map(capBucket),
    top_items_by_units: snapshot.top_items_by_units.map(capItem),
    top_items_by_revenue: snapshot.top_items_by_revenue.map(capItem),
    top_items_by_category: snapshot.top_items_by_category.map((group) => ({
      category: capName(group.category),
      items: group.items.map(capItem),
    })),
    by_category_weekday: snapshot.by_category_weekday.map((group) => ({
      ...group,
      category: capName(group.category),
    })),
  };
}

function clampSalesSnapshot(
  snapshot: AskMiltonSalesSnapshot
): AskMiltonSalesSnapshot {
  let next = capSalesSnapshotNames(snapshot);
  if (salesSnapshotJsonSize(next) <= SALES_SNAPSHOT_MAX_JSON_CHARS) {
    return next;
  }
  next = {
    ...next,
    by_date: compactDateList(next.by_date),
  };
  if (salesSnapshotJsonSize(next) <= SALES_SNAPSHOT_MAX_JSON_CHARS) {
    return next;
  }
  const extrema = [next.best_date, next.worst_date].filter(
    (d): d is SalesDateBucket => d !== null
  );
  const extremaDates = new Set<string>();
  next = {
    ...next,
    by_date: extrema.filter((d) => {
      if (extremaDates.has(d.date)) return false;
      extremaDates.add(d.date);
      return true;
    }),
    by_hour: [...next.by_hour]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .sort((a, b) => a.key.localeCompare(b.key)),
    by_category: next.by_category.slice(0, 8),
    top_items_by_units: next.top_items_by_units.slice(0, 8),
    top_items_by_revenue: next.top_items_by_revenue.slice(0, 8),
    top_items_by_category: next.top_items_by_category.slice(0, 3),
    by_category_weekday: next.by_category_weekday.slice(0, 3),
  };
  while (salesSnapshotJsonSize(next) > SALES_SNAPSHOT_MAX_JSON_CHARS) {
    let dropped = false;
    for (const key of SNAPSHOT_LIST_KEYS) {
      const list = next[key];
      if (list.length === 0) continue;
      next = { ...next, [key]: list.slice(0, list.length - 1) };
      dropped = true;
      if (salesSnapshotJsonSize(next) <= SALES_SNAPSHOT_MAX_JSON_CHARS) {
        return next;
      }
    }
    if (!dropped) break;
  }
  return next;
}

export function salesSnapshotJsonSize(
  snapshot: AskMiltonSalesSnapshot
): number {
  return JSON.stringify(snapshot).length;
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
    selectedLocationId,
    { withComboLines: true }
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
  const companyCurrency = await resolveCompanyCurrency(supabase, companyId);
  const rows = succeededRows(result).map(toSalesFactRow);
  const snapshot = buildSalesSnapshot(rows, timezone, {
    question,
    truncated: result.truncated,
    currency: companyCurrency,
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
