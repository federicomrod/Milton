// components/restaurant/RestaurantSalesExplorer.tsx
//
// Client-side exploration view for uploaded POS sales rows.
//
// Architecture:
//   - The server page (app/(restaurant-cockpit)/dashboard/restaurant/page.tsx)
//     reads pos_sales_items via Supabase RLS, converts each row to a thin
//     ExplorerRow, and hands the array to this component.
//   - All filtering and aggregation happens client-side in useMemo against
//     the in-memory row array. This keeps the BI-style interactions instant
//     (no per-click round-trip) at the cost of holding ≤10k rows in memory —
//     which is fine for the pilot scale.
//   - The component is intentionally schema-honest: filters whose source
//     columns aren't in pos_sales_items yet (payment_type, category) render
//     as disabled placeholders with a "not in schema yet" note rather than
//     fabricating values. See TODO(restaurant-pivot, payment_type/category-
//     schema) in lib/restaurant/pos-import.ts.
//
// Performance:
//   - O(N) over rows on every filter change. N ≤ MAX_ROWS = 10_000 (see
//     supabase-sales.ts), well within instant-interaction budget.
//   - All Sets/Maps for unique-order counts are rebuilt per recompute; we
//     prefer simplicity over incremental aggregation here.

"use client";

import { useMemo, useState } from "react";
import {
  Search,
  X,
  Filter,
  TrendingDown,
  ArrowDownUp,
  Target,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ExplorerRow } from "@/lib/restaurant/supabase-sales";
import type {
  TargetMap,
  TargetMetricKey,
} from "@/lib/restaurant/supabase-targets";

// ---------------------------------------------------------------------------
// Channel taxonomy
// ---------------------------------------------------------------------------

// Stored vocabulary in pos_sales_items.sales_channel (see pos-import.ts).
// We surface them in the UI under friendlier labels but keep the stored
// value as the filter key so filtering is exact-match and unambiguous.
const CHANNEL_LABELS: Record<string, string> = {
  in_store: "Eat In",
  takeaway: "To Go",
  delivery: "Delivery",
  online: "Online",
};

function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "Unknown";
  return CHANNEL_LABELS[channel] ?? channel;
}

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/**
 * Date-range presets. Resolved against the latest `sale_date` in the loaded
 * dataset (NOT today's wall-clock date) so the cockpit makes sense for
 * dummy/historical uploads. See `resolveDateRange()` for the math.
 */
type DatePreset = "all" | "7d" | "14d" | "28d" | "custom";

interface Filters {
  /** Selected sales_channel value, or null for "All". */
  channel: string | null;
  /**
   * Selected payment_type value, or null for "All".
   * Sentinel string `"__null__"` selects rows where payment_type IS NULL
   * (i.e. legacy rows uploaded before migration 002). This lets a user
   * isolate "Unknown payment type" entries explicitly.
   */
  paymentType: string | null;
  category: string | null;
  subCategory: string | null;
  /** Case-insensitive substring match against item_name. */
  search: string;
  /** Minimum revenue an item must accumulate (post-filter) to be shown. */
  minRevenue: number;
  /** Minimum units an item must accumulate (post-filter) to be shown. */
  minUnits: number;
  /** Optional avg-price band, null when not set. */
  minAvgPrice: number | null;
  maxAvgPrice: number | null;
  /** Active date preset; "custom" lets the user pick from/to manually. */
  datePreset: DatePreset;
  /**
   * Custom range bounds (inclusive ISO "YYYY-MM-DD"). Used ONLY when
   * datePreset === "custom". Null means "no bound on that side". When the
   * preset is one of "7d/14d/28d/all" these fields are ignored — the
   * preset is the source of truth.
   */
  customFrom: string | null;
  customTo: string | null;
}

const EMPTY_FILTERS: Filters = {
  channel: null,
  paymentType: null,
  category: null,
  subCategory: null,
  search: "",
  minRevenue: 0,
  minUnits: 0,
  minAvgPrice: null,
  maxAvgPrice: null,
  datePreset: "all",
  customFrom: null,
  customTo: null,
};

// ---------------------------------------------------------------------------
// Date math
//
// ALL date math operates on ISO "YYYY-MM-DD" strings and ignores time-of-day.
// This is deliberate: `pos_sales_items.sale_date` is stored as a DATE so we
// don't need to chase Date objects through timezones (a real risk when the
// dataset spans daylight-saving transitions).
//
// Presets resolve against the LATEST sale_date in the loaded rows, not the
// system clock, so a 28-day dummy dataset from February still has working
// "Last 7 days" semantics.
// ---------------------------------------------------------------------------

/** Returns an ISO date string `n` days BEFORE the given anchor (inclusive of
 *  both endpoints when used to build a range). */
function shiftDays(isoDate: string, deltaDays: number): string {
  // Parse "YYYY-MM-DD" as UTC midnight to avoid local-DST oddness.
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Inclusive day count between two ISO dates, e.g. ("2026-02-22","2026-02-28") = 7. */
function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(diff / 86400000) + 1;
}

interface DateRange {
  from: string | null;
  to: string | null;
}

/**
 * Resolves the active filter's date preset/custom values into a concrete
 * inclusive [from, to] window. `null` on either side means unbounded.
 *
 * The anchor for relative presets is the LATEST sale_date present in `rows`,
 * not the current date — this is what makes the dashboard usable with the
 * dummy dataset whose dates may be months in the past.
 */
function resolveDateRange(rows: ExplorerRow[], f: Filters): DateRange {
  if (f.datePreset === "all") return { from: null, to: null };
  if (f.datePreset === "custom") {
    return { from: f.customFrom, to: f.customTo };
  }
  // Relative presets need an anchor; absent any rows we can't resolve them.
  const latest = latestSaleDate(rows);
  if (!latest) return { from: null, to: null };
  const span = f.datePreset === "7d" ? 7 : f.datePreset === "14d" ? 14 : 28;
  return { from: shiftDays(latest, -(span - 1)), to: latest };
}

/** The previous equal-length window immediately before `range`. Returns
 *  `null` when comparison doesn't make sense (e.g. "All dates"). */
function previousDateRange(range: DateRange): DateRange | null {
  if (!range.from || !range.to) return null;
  const span = daysBetweenInclusive(range.from, range.to);
  if (span <= 0) return null;
  return {
    from: shiftDays(range.from, -span),
    to: shiftDays(range.from, -1),
  };
}

/** Latest sale_date across all rows (no filters applied), or null when
 *  the dataset is empty. */
function latestSaleDate(rows: ExplorerRow[]): string | null {
  let max: string | null = null;
  for (const r of rows) {
    if (!r.sale_date) continue;
    if (max === null || r.sale_date > max) max = r.sale_date;
  }
  return max;
}

function inRange(saleDate: string, range: DateRange): boolean {
  if (range.from && saleDate < range.from) return false;
  if (range.to && saleDate > range.to) return false;
  return true;
}

// Sentinel used as a Map key and as a filter value when the user selects the
// "null bucket" (a.k.a. "Unknown payment type" / "Uncategorized"). Picked to
// be unambiguous against any real text value.
const NULL_BUCKET = "__null__";

/** Map a stored field value to a user-facing label, with a clean
 *  "Unknown / Uncategorized" treatment for nulls. */
function labelFor(
  dim: "payment" | "category" | "sub_category",
  value: string | null
): string {
  if (value !== null && value !== "") return value;
  switch (dim) {
    case "payment":
      return "Unknown payment type";
    case "category":
      return "Uncategorized";
    case "sub_category":
      return "Uncategorized";
  }
}

/** True iff a stored row value matches a filter selection, where the
 *  filter uses NULL_BUCKET to mean "the null bucket".  */
function dimensionMatches(
  filterValue: string | null,
  rowValue: string | null
): boolean {
  if (filterValue === null) return true;
  if (filterValue === NULL_BUCKET) return rowValue === null;
  return rowValue === filterValue;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface ItemAgg {
  item_name: string;
  units: number;
  revenue: number;
  orders: Set<string>;
}

interface ItemRow {
  item_name: string;
  units: number;
  revenue: number;
  order_count: number;
  avg_price: number;
}

interface BreakdownAgg {
  /** Stored field value, or null for the "Unknown" bucket. */
  value: string | null;
  units: number;
  revenue: number;
  orders: Set<string>;
}

interface BreakdownRow {
  value: string | null;
  label: string;
  units: number;
  revenue: number;
  order_count: number;
  pct_of_revenue: number;
}

interface OverviewTotals {
  totalRevenue: number;
  totalUnits: number;
  totalOrders: number;
  avgTicket: number;
  avgItemPrice: number;
  uniqueItemsCount: number;
}

/** One bucket in the daily trend series. `date` is ISO "YYYY-MM-DD". */
export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

interface ExplorerAggregations extends OverviewTotals {
  byItem: ItemRow[];
  byChannel: BreakdownRow[];
  byPaymentType: BreakdownRow[];
  byCategory: BreakdownRow[];
  bySubCategory: BreakdownRow[];
  daily: DailyPoint[];
  /**
   * Overview totals for the immediately preceding equal-length window,
   * computed with the same non-date filters. Null when the active range is
   * unbounded ("All dates") or otherwise has no usable comparison window.
   */
  previousOverview: OverviewTotals | null;
  /** The resolved current range, for display in pills/headers. */
  range: DateRange;
  /** The resolved previous range, or null. */
  previousRange: DateRange | null;
  currency: string;
}

/**
 * Apply channel/search/numeric filters to the raw row stream, then aggregate
 * by item and by channel.
 *
 * Two-stage filter is intentional:
 *  1. Row-level filters (channel, search): applied first so per-channel and
 *     per-item rollups don't double-count.
 *  2. Item-level filters (minRevenue, minUnits, avg-price band): applied
 *     AFTER aggregation, because they describe properties of an item across
 *     orders, not properties of an individual sale row.
 *
 * Channel breakdown ignores the minRevenue/minUnits/avgPrice filters: those
 * are item-level constraints and applying them to the channel table would
 * make the percentages no longer sum to ~100% of filtered revenue.
 */
function aggregate(rows: ExplorerRow[], f: Filters): ExplorerAggregations {
  // Date windows are computed first so we can reuse a "non-date" matcher
  // for both the current period and the previous-period comparison.
  const range = resolveDateRange(rows, f);
  const previousRange = previousDateRange(range);

  // Stage 1: row-level filtering (non-date).
  const search = f.search.trim().toLowerCase();
  const matchesNonDate = (r: ExplorerRow): boolean => {
    if (!dimensionMatches(f.channel, r.sales_channel)) return false;
    if (!dimensionMatches(f.paymentType, r.payment_type)) return false;
    if (!dimensionMatches(f.category, r.category)) return false;
    if (!dimensionMatches(f.subCategory, r.sub_category)) return false;
    if (search && !r.item_name.toLowerCase().includes(search)) return false;
    return true;
  };
  const filtered = rows.filter(
    (r) => matchesNonDate(r) && inRange(r.sale_date, range)
  );

  // Currency: use the first row we saw (input came from one company / upload
  // batch in the pilot). Falls back to USD when nothing is filtered in.
  const currency = filtered[0]?.currency ?? rows[0]?.currency ?? "USD";

  // Order/item aggregation.
  let totalRevenue = 0;
  let totalUnits = 0;
  const orderIds = new Set<string>();
  const itemBuckets = new Map<string, ItemAgg>();

  // One bucket map per breakdown dimension. Each map keys on the stored
  // value (or NULL_BUCKET for nulls) so we can render Click-to-filter cards.
  const channelBuckets = new Map<string, BreakdownAgg>();
  const paymentBuckets = new Map<string, BreakdownAgg>();
  const categoryBuckets = new Map<string, BreakdownAgg>();
  const subCategoryBuckets = new Map<string, BreakdownAgg>();

  const bumpBreakdown = (
    map: Map<string, BreakdownAgg>,
    value: string | null,
    r: ExplorerRow
  ) => {
    const key = value ?? NULL_BUCKET;
    let b = map.get(key);
    if (!b) {
      b = { value, units: 0, revenue: 0, orders: new Set<string>() };
      map.set(key, b);
    }
    b.units += r.quantity;
    b.revenue += r.revenue;
    if (r.order_key) b.orders.add(r.order_key);
  };

  // Daily-trend bucket. We aggregate revenue/units per row and union the
  // distinct order keys per day so the "orders by day" line matches the
  // KPI semantics (= unique check count, not row count).
  interface DailyAgg {
    revenue: number;
    units: number;
    orders: Set<string>;
  }
  const dailyBuckets = new Map<string, DailyAgg>();

  for (const r of filtered) {
    totalRevenue += r.revenue;
    totalUnits += r.quantity;
    if (r.order_key) orderIds.add(r.order_key);

    // By item (case-insensitive bucket key; preserve first-seen casing).
    const itemKey = r.item_name.toLowerCase() || "(unnamed)";
    let ib = itemBuckets.get(itemKey);
    if (!ib) {
      ib = {
        item_name: r.item_name || "(unnamed)",
        units: 0,
        revenue: 0,
        orders: new Set<string>(),
      };
      itemBuckets.set(itemKey, ib);
    }
    ib.units += r.quantity;
    ib.revenue += r.revenue;
    if (r.order_key) ib.orders.add(r.order_key);

    bumpBreakdown(channelBuckets, r.sales_channel, r);
    bumpBreakdown(paymentBuckets, r.payment_type, r);
    bumpBreakdown(categoryBuckets, r.category, r);
    bumpBreakdown(subCategoryBuckets, r.sub_category, r);

    // Daily bucket. Rows with a blank sale_date are skipped so the chart
    // never shows a phantom "" point.
    if (r.sale_date) {
      let db = dailyBuckets.get(r.sale_date);
      if (!db) {
        db = { revenue: 0, units: 0, orders: new Set<string>() };
        dailyBuckets.set(r.sale_date, db);
      }
      db.revenue += r.revenue;
      db.units += r.quantity;
      if (r.order_key) db.orders.add(r.order_key);
    }
  }

  // Stage 2: item-level filters.
  const itemRows: ItemRow[] = [];
  for (const ib of itemBuckets.values()) {
    if (ib.revenue < f.minRevenue) continue;
    if (ib.units < f.minUnits) continue;
    const avgPrice = ib.units > 0 ? ib.revenue / ib.units : 0;
    if (f.minAvgPrice !== null && avgPrice < f.minAvgPrice) continue;
    if (f.maxAvgPrice !== null && avgPrice > f.maxAvgPrice) continue;
    itemRows.push({
      item_name: ib.item_name,
      units: ib.units,
      revenue: ib.revenue,
      order_count: ib.orders.size,
      avg_price: avgPrice,
    });
  }
  // Default sort: revenue desc. Callers re-sort for top-by-units etc.
  itemRows.sort((a, b) => b.revenue - a.revenue);

  // Breakdown rollups use the row-filtered (but not item-filtered) buckets
  // so the percentages stay coherent with the KPI totals above.
  const toBreakdownRows = (
    map: Map<string, BreakdownAgg>,
    labeller: (v: string | null) => string
  ): BreakdownRow[] =>
    Array.from(map.values())
      .map((b) => ({
        value: b.value,
        label: labeller(b.value),
        units: b.units,
        revenue: b.revenue,
        order_count: b.orders.size,
        pct_of_revenue: totalRevenue > 0 ? (b.revenue / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

  const channelRows = toBreakdownRows(channelBuckets, (v) => channelLabel(v));
  const paymentRows = toBreakdownRows(paymentBuckets, (v) =>
    labelFor("payment", v)
  );
  const categoryRows = toBreakdownRows(categoryBuckets, (v) =>
    labelFor("category", v)
  );
  const subCategoryRows = toBreakdownRows(subCategoryBuckets, (v) =>
    labelFor("sub_category", v)
  );

  const totalOrders = orderIds.size;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const avgItemPrice = totalUnits > 0 ? totalRevenue / totalUnits : 0;

  // Dense daily series: when we have a bounded range we backfill missing
  // days with zeros so the chart's x-axis is continuous. For "All dates"
  // we just emit the days that actually had sales (sorted asc) and let
  // Recharts plot them — backfilling all gaps could span months.
  const daily: DailyPoint[] = (() => {
    if (range.from && range.to) {
      const out: DailyPoint[] = [];
      const span = daysBetweenInclusive(range.from, range.to);
      for (let i = 0; i < span; i++) {
        const date = shiftDays(range.from, i);
        const b = dailyBuckets.get(date);
        out.push({
          date,
          revenue: b?.revenue ?? 0,
          units: b?.units ?? 0,
          orders: b?.orders.size ?? 0,
        });
      }
      return out;
    }
    return Array.from(dailyBuckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([date, b]) => ({
        date,
        revenue: b.revenue,
        units: b.units,
        orders: b.orders.size,
      }));
  })();

  // Previous-period overview. Same non-date filters, but date is the
  // previous-equal-length window. We deliberately do NOT compute breakdowns
  // or daily series for the previous period — only headline totals — to
  // keep this loop cheap and the comparison surface focused.
  let previousOverview: OverviewTotals | null = null;
  if (previousRange && previousRange.from && previousRange.to) {
    let pRev = 0;
    let pUnits = 0;
    const pOrders = new Set<string>();
    const pItemKeys = new Set<string>();
    for (const r of rows) {
      if (!matchesNonDate(r)) continue;
      if (!inRange(r.sale_date, previousRange)) continue;
      pRev += r.revenue;
      pUnits += r.quantity;
      if (r.order_key) pOrders.add(r.order_key);
      const k = r.item_name.toLowerCase();
      if (k) pItemKeys.add(k);
    }
    const pOrderCount = pOrders.size;
    previousOverview = {
      totalRevenue: pRev,
      totalUnits: pUnits,
      totalOrders: pOrderCount,
      avgTicket: pOrderCount > 0 ? pRev / pOrderCount : 0,
      avgItemPrice: pUnits > 0 ? pRev / pUnits : 0,
      uniqueItemsCount: pItemKeys.size,
    };
  }

  return {
    totalRevenue,
    totalUnits,
    totalOrders,
    avgTicket,
    avgItemPrice,
    uniqueItemsCount: itemBuckets.size,
    byItem: itemRows,
    byChannel: channelRows,
    byPaymentType: paymentRows,
    byCategory: categoryRows,
    bySubCategory: subCategoryRows,
    daily,
    previousOverview,
    range,
    previousRange,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function makeFmts(currency: string) {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return {
    code: safe,
    locale,
    int: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
    dec2: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    pct: (n: number) => `${n.toFixed(1)}%`,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Three possible delta states:
 *   - "value":  numeric delta + signed percent
 *   - "na":     comparison range exists but previous value was 0
 *   - "none":   no comparison range (e.g. "All dates")
 *
 * Rendered in green for positive, red for negative, neutral gray for "na".
 * The display rule is the same for every KPI in this milestone: higher is
 * positive. (Avg ticket / avg item price get the same treatment by spec.)
 */
type DeltaState =
  | { kind: "none" }
  | { kind: "na" }
  | { kind: "value"; absDelta: number; pctChange: number };

function computeDelta(
  current: number,
  previous: number | undefined
): DeltaState {
  if (previous === undefined) return { kind: "none" };
  if (previous === 0) {
    // current === 0 too is a valid "0 vs 0 = 0%" case; keep that informative.
    if (current === 0) return { kind: "value", absDelta: 0, pctChange: 0 };
    return { kind: "na" };
  }
  const absDelta = current - previous;
  const pctChange = (absDelta / Math.abs(previous)) * 100;
  return { kind: "value", absDelta, pctChange };
}

/**
 * Same shape as `computeDelta` but compares to a target instead of a
 * previous-period value. Identical math — kept as a distinct function so
 * the delta and target paths can diverge later (e.g. asymmetric tolerances).
 */
function computeVariance(
  actual: number,
  target: number | undefined
): DeltaState {
  if (target === undefined) return { kind: "none" };
  return computeDelta(actual, target);
}

function DeltaBadge({
  delta,
  comparisonLabel,
  formatAbs,
}: {
  delta: DeltaState;
  /** Trailing label, e.g. "vs previous 7 days". Shown to ground the % sign. */
  comparisonLabel: string;
  /** Formatter for the absolute delta (currency or plain number). */
  formatAbs: (n: number) => string;
}) {
  if (delta.kind === "none") {
    return null;
  }
  if (delta.kind === "na") {
    return (
      <p className="text-sm text-muted-foreground mt-1">
        n/a · {comparisonLabel}
      </p>
    );
  }
  const positive = delta.pctChange > 0;
  const negative = delta.pctChange < 0;
  const tone = positive
    ? "text-green-700 dark:text-green-300"
    : negative
      ? "text-red-700 dark:text-red-300"
      : "text-muted-foreground";
  const sign = positive ? "+" : negative ? "−" : "";
  return (
    <p className={"text-sm mt-1 tabular-nums " + tone}>
      <span className="font-medium">
        {sign}
        {Math.abs(delta.pctChange).toFixed(1)}%
      </span>{" "}
      <span className="text-muted-foreground">
        ({sign}
        {formatAbs(Math.abs(delta.absDelta))} {comparisonLabel})
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Targets editor
// ---------------------------------------------------------------------------

const TARGET_LABELS: Record<TargetMetricKey, string> = {
  revenue: "Daily revenue target",
  orders: "Daily orders target",
  units_sold: "Daily units sold target",
  avg_ticket: "Daily avg ticket target",
};

/**
 * Collapsible "Edit targets" card. Default collapsed with a tiny status
 * line so the dashboard isn't dominated by config UI; opens to a four-row
 * form that POSTs to /api/restaurant/targets.
 *
 * Server response is the canonical full target set — we replace local
 * state with it on save so partial edits never desynchronize.
 */
function TargetEditorCard({
  currentTargets,
  currency,
  onSaved,
  anyTargetSet,
}: {
  currentTargets: TargetMap;
  currency: string;
  onSaved: (next: TargetMap) => void;
  anyTargetSet: boolean;
}) {
  const [open, setOpen] = useState(!anyTargetSet);
  // Form state shadows currentTargets but holds strings so the user can
  // clear a field without immediately falling back to a default.
  const [draft, setDraft] = useState<Record<TargetMetricKey, string>>({
    revenue: currentTargets.revenue?.toString() ?? "",
    orders: currentTargets.orders?.toString() ?? "",
    units_sold: currentTargets.units_sold?.toString() ?? "",
    avg_ticket: currentTargets.avg_ticket?.toString() ?? "",
  });
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const fmts = useMemo(() => makeFmts(currency), [currency]);

  const handleSave = async () => {
    setStatus({ kind: "saving" });
    // Convert draft into a partial payload: empty strings are skipped so
    // unchanged fields aren't touched, and bad values short-circuit.
    const payload: Partial<Record<TargetMetricKey, number>> = {};
    for (const key of TARGET_METRIC_KEYS_LOCAL) {
      const raw = draft[key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setStatus({
          kind: "error",
          message: `“${TARGET_LABELS[key]}” must be a non-negative number.`,
        });
        return;
      }
      payload[key] = n;
    }
    if (Object.keys(payload).length === 0) {
      setStatus({
        kind: "error",
        message: "Enter at least one target to save.",
      });
      return;
    }
    try {
      const res = await fetch("/api/restaurant/targets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          message:
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`,
        });
        return;
      }
      const next: TargetMap = body?.targets ?? {};
      onSaved(next);
      setDraft({
        revenue: next.revenue?.toString() ?? "",
        orders: next.orders?.toString() ?? "",
        units_sold: next.units_sold?.toString() ?? "",
        avg_ticket: next.avg_ticket?.toString() ?? "",
      });
      setStatus({ kind: "ok", message: "Targets saved." });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  // Summary line shown when collapsed — short factual recap of what's set.
  const summary = (() => {
    if (!anyTargetSet) {
      return "No targets set yet. Add daily targets to compare actuals vs plan.";
    }
    const parts: string[] = [];
    if (typeof currentTargets.revenue === "number")
      parts.push(`Rev ${fmts.int.format(currentTargets.revenue)}/day`);
    if (typeof currentTargets.orders === "number")
      parts.push(`Orders ${Math.round(currentTargets.orders)}/day`);
    if (typeof currentTargets.units_sold === "number")
      parts.push(`Units ${Math.round(currentTargets.units_sold)}/day`);
    if (typeof currentTargets.avg_ticket === "number")
      parts.push(`Ticket ${fmts.dec2.format(currentTargets.avg_ticket)}`);
    return parts.join(" · ");
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-orange-500" />
            Targets
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            className="gap-1"
            aria-expanded={open}
          >
            {open ? (
              <>
                <ChevronUp className="h-4 w-4" /> Hide
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />{" "}
                {anyTargetSet ? "Edit" : "Add targets"}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{summary}</p>
        {open && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {TARGET_METRIC_KEYS_LOCAL.map((key) => (
                <label key={key} className="flex flex-col gap-1 min-w-0">
                  <span className="text-xs text-muted-foreground">
                    {TARGET_LABELS[key]}
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={
                      key === "avg_ticket" || key === "revenue" ? "0.01" : "1"
                    }
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder="—"
                    className="h-9"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={status.kind === "saving"}
              >
                {status.kind === "saving" ? "Saving…" : "Save targets"}
              </Button>
              {status.kind === "ok" && (
                <span className="text-sm text-green-700 dark:text-green-300">
                  {status.message}
                </span>
              )}
              {status.kind === "error" && (
                <span className="text-sm text-red-700 dark:text-red-300">
                  {status.message}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Window totals = daily target × selected days. Avg ticket target
                is not multiplied.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Local copy of the metric keys so the editor doesn't reach into the
 *  helper module's runtime types at render time. */
const TARGET_METRIC_KEYS_LOCAL: ReadonlyArray<TargetMetricKey> = [
  "revenue",
  "orders",
  "units_sold",
  "avg_ticket",
];

function KpiCard({
  label,
  value,
  sub,
  delta,
  comparisonLabel,
  formatAbs,
  target,
  targetVariance,
  formatTarget,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: DeltaState;
  comparisonLabel?: string;
  formatAbs?: (n: number) => string;
  /** Pre-formatted target value (e.g. "MX$140,000" for a 7-day window). */
  target?: string;
  /** Variance state vs the (already-scaled) target value. */
  targetVariance?: DeltaState;
  /** Formatter for the abs variance amount inside the badge. */
  formatTarget?: (n: number) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
        {target && (
          <p className="text-sm text-muted-foreground mt-1 tabular-nums">
            Target:{" "}
            <span className="font-medium text-foreground">{target}</span>
          </p>
        )}
        {targetVariance && formatTarget && (
          <DeltaBadge
            delta={targetVariance}
            comparisonLabel="vs target"
            formatAbs={formatTarget}
          />
        )}
        {delta && comparisonLabel && formatAbs && (
          <DeltaBadge
            delta={delta}
            comparisonLabel={comparisonLabel}
            formatAbs={formatAbs}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Date range controls
// ---------------------------------------------------------------------------

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: "All dates",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "28d": "Last 28 days",
  custom: "Custom",
};

function DateRangeControls({
  filters,
  range,
  previousRange,
  latestDate,
  onPreset,
  onCustomFrom,
  onCustomTo,
}: {
  filters: Filters;
  range: DateRange;
  previousRange: DateRange | null;
  latestDate: string | null;
  onPreset: (p: DatePreset) => void;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  const presets: DatePreset[] = ["all", "7d", "14d", "28d", "custom"];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">
          Date range:
        </span>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            className={
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors " +
              (filters.datePreset === p
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-muted")
            }
          >
            {DATE_PRESET_LABELS[p]}
          </button>
        ))}
        {filters.datePreset === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={filters.customFrom ?? ""}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="h-9 w-auto"
              aria-label="From date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={filters.customTo ?? ""}
              onChange={(e) => onCustomTo(e.target.value)}
              className="h-9 w-auto"
              aria-label="To date"
            />
          </div>
        )}
      </div>

      {/* Resolved-range hint. Tells the user exactly which dates the dashboard
          is showing — important because presets are anchored to the latest
          sale_date in the data, not today's date. */}
      <p className="text-xs text-muted-foreground">
        {describeRangeForHint({ filters, range, previousRange, latestDate })}
      </p>
    </div>
  );
}

/** Build the small "Showing rows from X to Y · vs previous Z to W" hint
 *  shown below the date controls. Centralized so the wording stays
 *  consistent with the KPI delta comparisonLabel. */
function describeRangeForHint(params: {
  filters: Filters;
  range: DateRange;
  previousRange: DateRange | null;
  latestDate: string | null;
}): string {
  const { filters, range, previousRange, latestDate } = params;
  if (filters.datePreset === "all") {
    return latestDate
      ? `Showing all rows · latest sale_date in data: ${latestDate}`
      : "No sales rows loaded.";
  }
  if (!range.from || !range.to) {
    return filters.datePreset === "custom"
      ? "Pick a from/to date to apply a custom range."
      : "Date range not resolvable (no sales loaded).";
  }
  const prev =
    previousRange?.from && previousRange?.to
      ? ` · vs ${previousRange.from} to ${previousRange.to}`
      : "";
  return `Showing ${range.from} to ${range.to}${prev}`;
}

function ChannelChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-foreground border-border hover:bg-muted")
      }
    >
      {label}
      {count !== undefined && (
        <span
          className={
            "ml-2 text-xs " +
            (active ? "text-primary-foreground/80" : "text-muted-foreground")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ActiveFilterPills({
  filters,
  onClear,
  onClearAll,
}: {
  filters: Filters;
  onClear: (key: keyof Filters) => void;
  onClearAll: () => void;
}) {
  const pills: { key: keyof Filters; label: string }[] = [];

  // Single-dimension renderer used for channel/payment/category/sub_category
  // so the "null bucket" filter shows as the friendly "Unknown …" label
  // instead of the NULL_BUCKET sentinel string.
  const pushDimensionPill = (
    key: keyof Filters,
    rawValue: string | null,
    prefix: string,
    nullLabel: string
  ) => {
    if (rawValue === null) return;
    const text =
      rawValue === NULL_BUCKET
        ? nullLabel
        : key === "channel"
          ? channelLabel(rawValue)
          : rawValue;
    pills.push({ key, label: `${prefix}: ${text}` });
  };

  // Date pill: render a single chip per active date selection. Clearing it
  // resets back to the default preset ("all"). For custom mode we also wipe
  // the bounds so the chip can't immediately reapply.
  if (filters.datePreset !== "all") {
    const label =
      filters.datePreset === "custom"
        ? `Date: ${filters.customFrom ?? "—"} to ${filters.customTo ?? "—"}`
        : `Date: ${DATE_PRESET_LABELS[filters.datePreset]}`;
    pills.push({ key: "datePreset", label });
  }

  pushDimensionPill("channel", filters.channel, "Channel", "Unknown channel");
  pushDimensionPill(
    "paymentType",
    filters.paymentType,
    "Payment",
    "Unknown payment type"
  );
  pushDimensionPill("category", filters.category, "Category", "Uncategorized");
  pushDimensionPill(
    "subCategory",
    filters.subCategory,
    "Sub-category",
    "Uncategorized"
  );

  if (filters.search) {
    pills.push({ key: "search", label: `Search: “${filters.search}”` });
  }
  if (filters.minRevenue > 0) {
    pills.push({
      key: "minRevenue",
      label: `Min revenue ≥ ${filters.minRevenue}`,
    });
  }
  if (filters.minUnits > 0) {
    pills.push({ key: "minUnits", label: `Min units ≥ ${filters.minUnits}` });
  }
  if (filters.minAvgPrice !== null) {
    pills.push({
      key: "minAvgPrice",
      label: `Avg price ≥ ${filters.minAvgPrice}`,
    });
  }
  if (filters.maxAvgPrice !== null) {
    pills.push({
      key: "maxAvgPrice",
      label: `Avg price ≤ ${filters.maxAvgPrice}`,
    });
  }

  // Render the bar even when no filters are active, so the user always has
  // an unambiguous status line ("Showing all POS sales") near the top.
  const isEmpty = pills.length === 0;

  return (
    <div
      className={
        "flex items-center gap-2 flex-wrap rounded-lg border px-3 py-2 " +
        (isEmpty
          ? "bg-muted/40 border-border"
          : "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900")
      }
    >
      <Filter
        className={
          "h-4 w-4 " +
          (isEmpty
            ? "text-muted-foreground"
            : "text-blue-700 dark:text-blue-300")
        }
      />
      <span
        className={
          "text-sm font-medium " +
          (isEmpty
            ? "text-muted-foreground"
            : "text-blue-900 dark:text-blue-100")
        }
      >
        {isEmpty ? "Showing all POS sales" : "Filtered by:"}
      </span>
      {pills.map((p) => (
        <span
          key={p.key}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100 border border-blue-200 dark:border-blue-800"
        >
          {p.label}
          <button
            type="button"
            onClick={() => onClear(p.key)}
            className="hover:opacity-70"
            aria-label={`Clear ${p.label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {!isEmpty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-7 text-sm ml-auto"
        >
          Clear all filters
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export interface RestaurantSalesExplorerProps {
  rows: ExplorerRow[];
  /** Daily KPI targets for this company. Empty object when nothing is set
   *  — KPI cards then fall back to previous-period deltas only. */
  initialTargets?: TargetMap;
}

export function RestaurantSalesExplorer({
  rows,
  initialTargets = {},
}: RestaurantSalesExplorerProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Targets live in client state so the editor's POST can update them
  // optimistically. Server is source of truth on next page reload.
  const [targets, setTargets] = useState<TargetMap>(initialTargets);

  // Unfiltered counts used for channel-chip badges so the user sees the full
  // distribution before clicking. These are stable across filter changes.
  const channelCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.sales_channel ?? NULL_BUCKET;
      map.set(k, (map.get(k) ?? 0) + r.quantity);
    }
    return map;
  }, [rows]);

  // Distinct stored channels in the data, sorted by total volume desc.
  const distinctChannels = useMemo(() => {
    return Array.from(channelCounts.entries())
      .filter(([k]) => k !== NULL_BUCKET)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }, [channelCounts]);

  const aggs = useMemo(() => aggregate(rows, filters), [rows, filters]);
  const fmts = useMemo(() => makeFmts(aggs.currency), [aggs.currency]);

  // ---- Targets -------------------------------------------------------
  //
  // Target math:
  //   selectedDays = number of days in the active range; null when "All dates".
  //     - For revenue / orders / units_sold, the window target is
  //       `daily_target × selectedDays`.
  //     - avg_ticket is a ratio, not a flow, so it's NEVER multiplied —
  //       the daily target IS the window target.
  //
  // Visibility rule:
  //   Target variance is hidden whenever any non-date filter is active
  //   (channel/payment/category/sub-category/search/numeric). The brief's
  //   "preferred" option: a slice of revenue cannot be honestly compared
  //   to a company-level daily target. We show a small note instead.
  //
  //   "All dates" is allowed for revenue/orders/units only when the
  //   loaded dataset has at least one sale_date — otherwise `selectedDays`
  //   is unknowable.
  const nonDateFiltersActive =
    filters.channel !== null ||
    filters.paymentType !== null ||
    filters.category !== null ||
    filters.subCategory !== null ||
    filters.search.trim() !== "" ||
    filters.minRevenue > 0 ||
    filters.minUnits > 0 ||
    filters.minAvgPrice !== null ||
    filters.maxAvgPrice !== null;

  const selectedDays = useMemo<number | null>(() => {
    if (aggs.range.from && aggs.range.to) {
      return daysBetweenInclusive(aggs.range.from, aggs.range.to);
    }
    // "All dates": derive span from min..max sale_date in the loaded rows
    // so a multi-day total can still be compared to the daily target.
    let minD: string | null = null;
    let maxD: string | null = null;
    for (const r of rows) {
      if (!r.sale_date) continue;
      if (minD === null || r.sale_date < minD) minD = r.sale_date;
      if (maxD === null || r.sale_date > maxD) maxD = r.sale_date;
    }
    if (!minD || !maxD) return null;
    return daysBetweenInclusive(minD, maxD);
  }, [aggs.range, rows]);

  /** Window-scaled targets aligned with the KPI cards. */
  const scaledTargets = useMemo(() => {
    const out: Partial<Record<TargetMetricKey, number>> = {};
    if (selectedDays === null) return out;
    if (typeof targets.revenue === "number")
      out.revenue = targets.revenue * selectedDays;
    if (typeof targets.orders === "number")
      out.orders = targets.orders * selectedDays;
    if (typeof targets.units_sold === "number")
      out.units_sold = targets.units_sold * selectedDays;
    if (typeof targets.avg_ticket === "number")
      out.avg_ticket = targets.avg_ticket; // ratio — not multiplied
    return out;
  }, [targets, selectedDays]);

  const anyTargetSet =
    typeof targets.revenue === "number" ||
    typeof targets.orders === "number" ||
    typeof targets.units_sold === "number" ||
    typeof targets.avg_ticket === "number";

  /** True when KPI cards should show target variance instead of (or
   *  alongside) the previous-period delta. */
  const showTargetVariance = anyTargetSet && !nonDateFiltersActive;

  // Trailing copy for KPI delta badges, e.g. "vs previous 7 days". Falls
  // back to a generic phrase when the previous range exists but has an
  // unusual length (e.g. custom date pick).
  const comparisonLabel = useMemo(() => {
    if (!aggs.previousRange?.from || !aggs.previousRange?.to) return "";
    const days = daysBetweenInclusive(
      aggs.previousRange.from,
      aggs.previousRange.to
    );
    return `vs previous ${days} day${days === 1 ? "" : "s"}`;
  }, [aggs.previousRange]);

  const topByRevenue = aggs.byItem.slice(0, 5);
  const topByUnits = [...aggs.byItem]
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);
  // Long tail: bottom-quartile by revenue but still with at least one sale.
  // Use a copy so we don't disturb byItem's revenue-desc order.
  const longTail = [...aggs.byItem]
    .filter((i) => i.units > 0)
    .sort((a, b) => a.revenue - b.revenue)
    .slice(0, 10);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearOne = (key: keyof Filters) => {
    // Clearing the date pill should also drop any custom-range bounds so
    // returning to "All dates" is a single click.
    if (key === "datePreset") {
      setFilters((prev) => ({
        ...prev,
        datePreset: EMPTY_FILTERS.datePreset,
        customFrom: null,
        customTo: null,
      }));
      return;
    }
    setFilters((prev) => ({ ...prev, [key]: EMPTY_FILTERS[key] }));
  };

  const clearAll = () => setFilters(EMPTY_FILTERS);

  return (
    <div className="space-y-8">
      {/* Always-visible status line: "Showing all" or active filter chips
          with one-click removal. Placed at the very top so the user can
          always orient themselves before reading the KPIs below. */}
      <ActiveFilterPills
        filters={filters}
        onClear={clearOne}
        onClearAll={clearAll}
      />

      {/* Filter bar — a single panel grouping date / channel / item-level
          filters so the controls have one clear home. */}
      <Card>
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-5 space-y-5">
          {/* Date range — first row so the time-axis selection always
              precedes the dimension filters underneath. */}
          <DateRangeControls
            filters={filters}
            range={aggs.range}
            previousRange={aggs.previousRange}
            latestDate={latestSaleDate(rows)}
            onPreset={(p) => {
              // Switching to a non-custom preset wipes the custom bounds
              // so they don't reappear when the user goes back to "Custom".
              setFilters((prev) => ({
                ...prev,
                datePreset: p,
                customFrom: p === "custom" ? prev.customFrom : null,
                customTo: p === "custom" ? prev.customTo : null,
              }));
            }}
            onCustomFrom={(v) => updateFilter("customFrom", v || null)}
            onCustomTo={(v) => updateFilter("customTo", v || null)}
          />

          {/* Channel chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <ChannelChip
              active={filters.channel === null}
              label="All"
              count={rows.reduce((s, r) => s + r.quantity, 0)}
              onClick={() => updateFilter("channel", null)}
            />
            {distinctChannels.map((ch) => (
              <ChannelChip
                key={ch}
                active={filters.channel === ch}
                label={channelLabel(ch)}
                count={channelCounts.get(ch)}
                onClick={() =>
                  updateFilter("channel", filters.channel === ch ? null : ch)
                }
              />
            ))}
            {channelCounts.has(NULL_BUCKET) && (
              <ChannelChip
                active={filters.channel === NULL_BUCKET}
                label="Unknown channel"
                count={channelCounts.get(NULL_BUCKET)}
                onClick={() =>
                  updateFilter(
                    "channel",
                    filters.channel === NULL_BUCKET ? null : NULL_BUCKET
                  )
                }
              />
            )}
          </div>

          {/* Search + numeric filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search item name…"
                value={filters.search}
                onChange={(e) => updateFilter("search", e.target.value)}
                className="pl-8"
              />
            </div>
            <NumberFilter
              label="Min units"
              value={filters.minUnits}
              onChange={(v) => updateFilter("minUnits", v ?? 0)}
            />
            <NumberFilter
              label="Min revenue"
              value={filters.minRevenue}
              onChange={(v) => updateFilter("minRevenue", v ?? 0)}
            />
            <div className="flex gap-2">
              <NumberFilter
                label="Avg price ≥"
                value={filters.minAvgPrice}
                onChange={(v) => updateFilter("minAvgPrice", v)}
                allowNull
              />
              <NumberFilter
                label="Avg price ≤"
                value={filters.maxAvgPrice}
                onChange={(v) => updateFilter("maxAvgPrice", v)}
                allowNull
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* In-page section nav. Plain anchor links scroll to the section
          IDs below; the dashboard's scroll-margin-top keeps the heading
          visible under the sticky app header. */}
      <SectionTabs />

      {/* Targets editor. Lives between filters and KPI cards so editing
          a target immediately reframes the metrics underneath. */}
      <section id="targets" className="scroll-mt-24">
        <TargetEditorCard
          currentTargets={targets}
          currency={aggs.currency}
          onSaved={(next) => setTargets(next)}
          anyTargetSet={anyTargetSet}
        />
      </section>

      {/* KPI cards. Deltas render when a previous-period overview exists
          (i.e. the active range is bounded). For "All dates" the cards
          stay clean with no comparison footnote. Target variance shows
          on top of the delta when targets are configured AND no non-date
          filter is active. */}
      <section id="overview" className="scroll-mt-24">
        <h2 className="text-lg font-semibold mb-4">Overview</h2>
        {anyTargetSet && nonDateFiltersActive && (
          <p className="text-sm text-muted-foreground mb-3">
            Target comparison hidden for filtered slices. Clear non-date filters
            to see actual vs target.
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            label="Revenue"
            value={fmts.int.format(aggs.totalRevenue)}
            sub={fmts.code}
            delta={computeDelta(
              aggs.totalRevenue,
              aggs.previousOverview?.totalRevenue
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => fmts.int.format(n)}
            target={
              showTargetVariance && scaledTargets.revenue !== undefined
                ? fmts.int.format(scaledTargets.revenue)
                : undefined
            }
            targetVariance={
              showTargetVariance
                ? computeVariance(aggs.totalRevenue, scaledTargets.revenue)
                : undefined
            }
            formatTarget={(n) => fmts.int.format(n)}
          />
          <KpiCard
            label="Orders"
            value={aggs.totalOrders.toLocaleString(fmts.locale)}
            sub="unique checks"
            delta={computeDelta(
              aggs.totalOrders,
              aggs.previousOverview?.totalOrders
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => Math.round(n).toLocaleString(fmts.locale)}
            target={
              showTargetVariance && scaledTargets.orders !== undefined
                ? Math.round(scaledTargets.orders).toLocaleString(fmts.locale)
                : undefined
            }
            targetVariance={
              showTargetVariance
                ? computeVariance(aggs.totalOrders, scaledTargets.orders)
                : undefined
            }
            formatTarget={(n) => Math.round(n).toLocaleString(fmts.locale)}
          />
          <KpiCard
            label="Units Sold"
            value={aggs.totalUnits.toLocaleString(fmts.locale)}
            sub="dishes"
            delta={computeDelta(
              aggs.totalUnits,
              aggs.previousOverview?.totalUnits
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => Math.round(n).toLocaleString(fmts.locale)}
            target={
              showTargetVariance && scaledTargets.units_sold !== undefined
                ? Math.round(scaledTargets.units_sold).toLocaleString(
                    fmts.locale
                  )
                : undefined
            }
            targetVariance={
              showTargetVariance
                ? computeVariance(aggs.totalUnits, scaledTargets.units_sold)
                : undefined
            }
            formatTarget={(n) => Math.round(n).toLocaleString(fmts.locale)}
          />
          <KpiCard
            label="Avg Ticket"
            value={fmts.dec2.format(aggs.avgTicket)}
            sub="per order"
            delta={computeDelta(
              aggs.avgTicket,
              aggs.previousOverview?.avgTicket
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => fmts.dec2.format(n)}
            target={
              showTargetVariance && scaledTargets.avg_ticket !== undefined
                ? fmts.dec2.format(scaledTargets.avg_ticket)
                : undefined
            }
            targetVariance={
              showTargetVariance
                ? computeVariance(aggs.avgTicket, scaledTargets.avg_ticket)
                : undefined
            }
            formatTarget={(n) => fmts.dec2.format(n)}
          />
          <KpiCard
            label="Avg Item Price"
            value={fmts.dec2.format(aggs.avgItemPrice)}
            sub="per unit"
            delta={computeDelta(
              aggs.avgItemPrice,
              aggs.previousOverview?.avgItemPrice
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => fmts.dec2.format(n)}
          />
          <KpiCard
            label="Unique Items"
            value={aggs.uniqueItemsCount.toLocaleString(fmts.locale)}
            sub="distinct dishes"
            delta={computeDelta(
              aggs.uniqueItemsCount,
              aggs.previousOverview?.uniqueItemsCount
            )}
            comparisonLabel={comparisonLabel}
            formatAbs={(n) => Math.round(n).toLocaleString(fmts.locale)}
          />
        </div>
      </section>

      {/* AI insights placeholder. Intentionally shown above the channel
          breakdowns so the missing functionality is obvious without taking
          dominant screen real estate. */}
      <AiInsightsPlaceholder />

      {/* Trend charts. Daily revenue + daily orders. Hidden when the
          date range produced fewer than 2 daily points (a single bar is
          not a trend, and Recharts renders a line oddly with 1 point). */}
      {aggs.daily.length >= 2 && (
        <section id="trends" className="scroll-mt-24">
          <h2 className="text-lg font-semibold mb-4">Daily Trend</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* The reference line uses the DAILY target, not the scaled
                window total: each chart point is one day. We only show
                it when no non-date filters are active so we don't
                mislead a user looking at a single channel/category. */}
            <DailyTrendCard
              title="Revenue by day"
              data={aggs.daily}
              metric="revenue"
              fmts={fmts}
              color="#0ea5e9"
              targetLine={
                !nonDateFiltersActive && typeof targets.revenue === "number"
                  ? targets.revenue
                  : undefined
              }
              targetLabel="Daily revenue target"
            />
            <DailyTrendCard
              title="Orders by day"
              data={aggs.daily}
              metric="orders"
              fmts={fmts}
              color="#10b981"
              targetLine={
                !nonDateFiltersActive && typeof targets.orders === "number"
                  ? targets.orders
                  : undefined
              }
              targetLabel="Daily orders target"
            />
          </div>
        </section>
      )}

      {/* Channels / payment / category breakdowns. Single anchored wrapper
          so the "Channels" tab jumps to the start of the breakdown stack. */}
      <section id="channels" className="scroll-mt-24 space-y-6">
        <BreakdownSection
          title="Sales by Channel"
          rows={aggs.byChannel}
          selected={filters.channel}
          onToggle={(value) =>
            updateFilter(
              "channel",
              filters.channel === (value ?? NULL_BUCKET)
                ? null
                : (value ?? NULL_BUCKET)
            )
          }
          fmts={fmts}
        />

        <BreakdownSection
          title="Sales by Payment Type"
          rows={aggs.byPaymentType}
          selected={filters.paymentType}
          onToggle={(value) =>
            updateFilter(
              "paymentType",
              filters.paymentType === (value ?? NULL_BUCKET)
                ? null
                : (value ?? NULL_BUCKET)
            )
          }
          fmts={fmts}
          emptyHint="Re-upload the POS file after running migration 002 to populate this breakdown."
        />

        <BreakdownSection
          title="Sales by Category"
          rows={aggs.byCategory}
          selected={filters.category}
          onToggle={(value) =>
            updateFilter(
              "category",
              filters.category === (value ?? NULL_BUCKET)
                ? null
                : (value ?? NULL_BUCKET)
            )
          }
          fmts={fmts}
          emptyHint="Re-upload the POS file after running migration 002 to populate this breakdown."
        />

        {aggs.bySubCategory.length > 0 && (
          <BreakdownSection
            title="Sales by Sub-category"
            rows={aggs.bySubCategory}
            selected={filters.subCategory}
            onToggle={(value) =>
              updateFilter(
                "subCategory",
                filters.subCategory === (value ?? NULL_BUCKET)
                  ? null
                  : (value ?? NULL_BUCKET)
              )
            }
            fmts={fmts}
          />
        )}
      </section>

      {/* Items section — top lists, long tail, and the full table. Anchored
          as one block so "Items" tab lands on the top-5 cards. */}
      <section id="items" className="scroll-mt-24 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopItemsCard
            title="Top 5 Items by Revenue"
            rows={topByRevenue}
            metricKey="revenue"
            fmts={fmts}
          />
          <TopItemsCard
            title="Top 5 Items by Units"
            rows={topByUnits}
            metricKey="units"
            fmts={fmts}
          />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            Long-Tail Items
            <span className="text-xs font-normal text-muted-foreground">
              (lowest revenue with at least one sale — candidates for menu
              review)
            </span>
          </h2>
          <Card>
            <CardContent className="p-0">
              <ItemsTable rows={longTail} fmts={fmts} variant="compact" />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
            All Items ({aggs.byItem.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              <ItemsTable rows={aggs.byItem} fmts={fmts} variant="full" />
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground mt-2">
            Cost and margin are intentionally omitted in live POS mode — they
            stay <span className="font-medium">pending recipe match</span> until
            menu items, recipes, and supplier costs are linked for this company.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-page section nav
// ---------------------------------------------------------------------------

/**
 * Simple anchor-link tab strip. Sticky directly under the app header so
 * the user can keep navigating between sections while scrolling. Uses
 * native `<a href="#id">` so the browser handles smooth scrolling via
 * `scroll-margin-top` on the targets.
 */
function SectionTabs() {
  const tabs: { hash: string; label: string }[] = [
    { hash: "overview", label: "Overview" },
    { hash: "trends", label: "Trends" },
    { hash: "channels", label: "Channels" },
    { hash: "items", label: "Items" },
    { hash: "targets", label: "Targets" },
  ];
  return (
    <nav
      aria-label="Dashboard sections"
      className="sticky top-0 z-30 -mx-6 lg:-mx-10 px-6 lg:px-10 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border"
    >
      <ul className="flex items-center gap-1 overflow-x-auto py-2">
        {tabs.map((t) => (
          <li key={t.hash}>
            <a
              href={`#${t.hash}`}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border whitespace-nowrap"
            >
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// AI insights placeholder — explicit "not active yet" status so users don't
// expect recommendations before recipes / supplier costs are linked.
// ---------------------------------------------------------------------------

function AiInsightsPlaceholder() {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-4 pb-4 flex items-start gap-3">
        <div className="rounded-md bg-amber-100 dark:bg-amber-900/30 p-2 shrink-0">
          {/* using a literal span to avoid pulling in another icon */}
          <span
            aria-hidden="true"
            className="text-amber-600 dark:text-amber-300 text-base"
          >
            ★
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            AI recommendations are not active yet
          </p>
          <p className="text-sm text-muted-foreground">
            AI recommendations will activate after menu recipes and supplier
            costs are linked. Until then the cockpit shows live POS metrics
            against your targets only.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Trend chart
// ---------------------------------------------------------------------------

/**
 * Daily revenue or orders line. We use Recharts (already in deps); single line
 * per card, no stacked areas / multiple metrics — the dashboard is clearer
 * when each card has exactly one number on it.
 *
 * X-axis ticks are sparse: we render every Nth date based on the series
 * length so a 28-day window doesn't overlap labels.
 */
function DailyTrendCard({
  title,
  data,
  metric,
  fmts,
  color,
  targetLine,
  targetLabel,
}: {
  title: string;
  data: DailyPoint[];
  metric: "revenue" | "orders" | "units";
  fmts: ReturnType<typeof makeFmts>;
  color: string;
  /** Optional horizontal reference line value (in the chart's units). */
  targetLine?: number;
  /** Label for the reference line, e.g. "Daily target". */
  targetLabel?: string;
}) {
  // Tick interval that leaves ~6–8 labels max on the x-axis. Recharts'
  // `interval` is "skip every N", so we invert to get the cadence we want.
  const tickInterval = Math.max(0, Math.floor(data.length / 7) - 1);

  const formatY = (n: number) =>
    metric === "revenue"
      ? fmts.int.format(n)
      : Math.round(n).toLocaleString(fmts.locale);

  const formatTooltip = (n: number) =>
    metric === "revenue"
      ? fmts.dec2.format(n)
      : Math.round(n).toLocaleString(fmts.locale);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="date"
                interval={tickInterval}
                tickFormatter={(s: string) => s.slice(5) /* MM-DD */}
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={formatY}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(label: string) => label}
                formatter={(value: number) => [formatTooltip(value), title]}
              />
              <Line
                type="monotone"
                dataKey={metric}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              {typeof targetLine === "number" && targetLine > 0 && (
                <ReferenceLine
                  y={targetLine}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: targetLabel ?? `Target ${formatTooltip(targetLine)}`,
                    position: "insideTopRight",
                    fill: "#c2410c",
                    fontSize: 11,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
  allowNull = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  /** When true, an empty input clears the filter (value=null); otherwise empty→0. */
  allowNull?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        value={value === null ? "" : value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(allowNull ? null : 0);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0) return;
          onChange(n);
        }}
        placeholder={allowNull ? "—" : "0"}
        className="h-9"
      />
    </label>
  );
}

/**
 * Renders a labeled grid of clickable breakdown cards (channel / payment /
 * category / sub_category). Cards highlight when their value is the active
 * selection. Clicking a card toggles the filter on/off via `onToggle`.
 *
 * `selected` is the current filter value for this dimension — either:
 *   - a real stored value,
 *   - `NULL_BUCKET` (the "Unknown / Uncategorized" bucket),
 *   - or `null` (no selection).
 *
 * `onToggle` receives the row's underlying value (string | null); the caller
 * decides whether to set the filter to that value, to NULL_BUCKET, or back
 * to null. Centralizing that logic in the caller keeps the section dumb.
 */
function BreakdownSection({
  title,
  rows,
  selected,
  onToggle,
  fmts,
  emptyHint,
}: {
  title: string;
  rows: BreakdownRow[];
  selected: string | null;
  onToggle: (rawValue: string | null) => void;
  fmts: ReturnType<typeof makeFmts>;
  /** Extra hint shown when there are no rows (e.g. "re-upload after migration"). */
  emptyHint?: string;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full">
            No data for this breakdown yet.
            {emptyHint && <span className="block mt-1">{emptyHint}</span>}
          </p>
        )}
        {rows.map((b) => {
          const filterKey = b.value ?? NULL_BUCKET;
          const isActive = selected === filterKey;
          return (
            <Card
              key={filterKey}
              role="button"
              tabIndex={0}
              onClick={() => onToggle(b.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(b.value);
                }
              }}
              className={
                "cursor-pointer transition-colors " +
                (isActive
                  ? "border-primary ring-1 ring-primary"
                  : "hover:border-muted-foreground/40")
              }
            >
              <CardContent className="pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold truncate">
                    {b.label}
                  </span>
                  <span className="text-sm text-muted-foreground shrink-0">
                    {fmts.pct(b.pct_of_revenue)}
                  </span>
                </div>
                <p className="text-2xl font-bold tabular-nums mt-1.5">
                  {fmts.int.format(b.revenue)}
                </p>
                <p className="text-sm text-muted-foreground mt-1 tabular-nums">
                  {b.order_count.toLocaleString(fmts.locale)} orders ·{" "}
                  {b.units.toLocaleString(fmts.locale)} units
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function TopItemsCard({
  title,
  rows,
  metricKey,
  fmts,
}: {
  title: string;
  rows: ItemRow[];
  metricKey: "revenue" | "units";
  fmts: ReturnType<typeof makeFmts>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 pb-4">
            No items match the current filters.
          </p>
        ) : (
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-border text-left text-sm text-muted-foreground">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium text-right">
                  {metricKey === "revenue" ? "Revenue" : "Units"}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {metricKey === "revenue" ? "Units" : "Revenue"}
                </th>
                <th className="px-4 py-3 font-medium text-right">Orders</th>
                <th className="px-4 py-3 font-medium text-right">Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.item_name + i}
                  className={
                    (i % 2 === 0 ? "bg-background" : "bg-muted/20") +
                    " hover:bg-muted/40"
                  }
                >
                  <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.item_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {metricKey === "revenue"
                      ? fmts.dec2.format(r.revenue)
                      : r.units.toLocaleString(fmts.locale)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {metricKey === "revenue"
                      ? r.units.toLocaleString(fmts.locale)
                      : fmts.dec2.format(r.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.order_count.toLocaleString(fmts.locale)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmts.dec2.format(r.avg_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ItemsTable({
  rows,
  fmts,
  variant,
}: {
  rows: ItemRow[];
  fmts: ReturnType<typeof makeFmts>;
  variant: "compact" | "full";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4 text-center">
        No items match the current filters.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium text-right">Units</th>
            <th className="px-4 py-3 font-medium text-right">Revenue</th>
            <th className="px-4 py-3 font-medium text-right">Orders</th>
            <th className="px-4 py-3 font-medium text-right">Avg Price</th>
            {variant === "full" && (
              <>
                <th className="px-4 py-3 font-medium text-right">Est. Cost</th>
                <th className="px-4 py-3 font-medium text-right">Margin</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.item_name + i}
              className={
                (i % 2 === 0 ? "bg-background" : "bg-muted/20") +
                " hover:bg-muted/40"
              }
            >
              <td className="px-4 py-3 font-medium">{r.item_name}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.units.toLocaleString(fmts.locale)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {fmts.dec2.format(r.revenue)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.order_count.toLocaleString(fmts.locale)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {fmts.dec2.format(r.avg_price)}
              </td>
              {variant === "full" && (
                <>
                  <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                    Not matched
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                    Pending recipe match
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
