// lib/restaurant/objetivos.ts
//
// R1-16a: the goals a restaurant sets (Configuración › Objetivos) and how a
// day, a week or a period reads them. Pure: no I/O, so the rules are pinned
// by tests. Nothing here ever turns a missing target into 0: a day without a
// target has NO target (no line, no chip).
//
// Rules
//   * A target applies from its `effective_from` day on; the months before
//     keep the target they had.
//   * A restaurant's own row beats the company-wide one. A company-wide SALES
//     target is not split per restaurant (sales add up); per-restaurant sales
//     targets add up for "Todos" only when EVERY restaurant has one. Levels
//     (food cost %, margin %, ticket) are not additive: a company-wide level
//     applies to each restaurant, and "Todos" never averages restaurant levels.
//   * Daily sales target: flat = monthly ÷ days of THAT month; weighted =
//     monthly × w(weekday) ÷ Σ w over that month's days.
//   * A row written with is_active = false is "no target from this day on".

export type TargetMetric =
  | "revenue"
  | "orders"
  | "units_sold"
  | "avg_ticket"
  | "food_cost_pct"
  | "gross_margin_pct";

export type TargetPeriod = "daily" | "monthly";

export interface TargetRow {
  metric_key: TargetMetric;
  target_period: TargetPeriod;
  target_value: number;
  /** null = the whole company. */
  location_id: string | null;
  /** YYYY-MM-DD: the day it starts to apply. */
  effective_from: string;
  is_active: boolean;
  /** Monday..Sunday, sum 1; null = flat. */
  weekday_weights: number[] | null;
}

/** Sales, orders and units add up across restaurants; ratios and tickets do not. */
const ADDITIVE: ReadonlySet<TargetMetric> = new Set([
  "revenue",
  "orders",
  "units_sold",
]);
export const isAdditiveMetric = (m: TargetMetric) => ADDITIVE.has(m);

export const LEGACY_FROM = "1900-01-01";

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const utc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function daysInMonth(ymd: string): number {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(ymd: string): number {
  return (utc(ymd).getUTCDay() + 6) % 7;
}

export function addDays(ymd: string, n: number): string {
  const d = utc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function monthStartOf(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// Which row applies
// ---------------------------------------------------------------------------

/** The newest row (effective_from ≤ day) among `rows`; a monthly row wins a tie with a legacy daily one. */
function newest(rows: readonly TargetRow[], day: string): TargetRow | null {
  let best: TargetRow | null = null;
  for (const r of rows) {
    if (r.effective_from > day) continue;
    if (
      !best ||
      r.effective_from > best.effective_from ||
      (r.effective_from === best.effective_from &&
        r.target_period === "monthly" &&
        best.target_period !== "monthly")
    ) {
      best = r;
    }
  }
  return best && best.is_active ? best : null;
}

/**
 * The row that applies on `day` for a restaurant (`locationId`) or for the
 * whole company (null). A restaurant's own row beats the company-wide one for
 * levels; for sales the company-wide row is NOT lent to a restaurant.
 */
export function pickTargetRow(
  rows: readonly TargetRow[],
  metric: TargetMetric,
  day: string,
  locationId: string | null
): TargetRow | null {
  const ofMetric = rows.filter((r) => r.metric_key === metric);
  if (locationId) {
    const own = ofMetric.filter((r) => r.location_id === locationId);
    if (own.length > 0) return newest(own, day);
    return isAdditiveMetric(metric)
      ? null
      : newest(
          ofMetric.filter((r) => r.location_id === null),
          day
        );
  }
  return newest(
    ofMetric.filter((r) => r.location_id === null),
    day
  );
}

// ---------------------------------------------------------------------------
// Daily and period sales target
// ---------------------------------------------------------------------------

/** One restaurant's (or the company's) daily sales target for `day` from its row. */
export function deriveDailyTarget(row: TargetRow, day: string): number {
  if (row.target_period === "daily") return row.target_value;
  const dim = daysInMonth(day);
  const w = row.weekday_weights;
  if (!w || w.length !== 7) return row.target_value / dim;
  // Σ of the weights of THIS month's days: a month with five Saturdays
  // spreads the same monthly total over a different mix of days.
  let sum = 0;
  const first = monthStartOf(day);
  for (let i = 0; i < dim; i++) sum += w[weekdayIndex(addDays(first, i))];
  if (!(sum > 0)) return row.target_value / dim;
  return (row.target_value * w[weekdayIndex(day)]) / sum;
}

export interface TargetScope {
  /** The restaurant in view; null = Todos los restaurantes. */
  locationId: string | null;
  /** Every restaurant of the company (needed to add up per-restaurant targets for Todos). */
  restaurantIds: readonly string[];
}

/** The daily sales target of `day`, or null when there is none (never 0). */
export function dailySalesTarget(
  rows: readonly TargetRow[],
  day: string,
  scope: TargetScope
): number | null {
  const own = pickTargetRow(rows, "revenue", day, scope.locationId);
  if (own) return deriveDailyTarget(own, day);
  if (scope.locationId) return null;
  // Todos, no company-wide row: add up the restaurants, only if EVERY one has a target.
  if (scope.restaurantIds.length === 0) return null;
  let total = 0;
  for (const id of scope.restaurantIds) {
    const row = pickTargetRow(rows, "revenue", day, id);
    if (!row) return null;
    total += deriveDailyTarget(row, day);
  }
  return total;
}

/** Σ daily targets of the days of a period; null unless EVERY day has one. */
export function periodSalesTarget(
  rows: readonly TargetRow[],
  from: string,
  to: string,
  scope: TargetScope
): number | null {
  const days = eachDay(from, to);
  if (days.length === 0) return null;
  let total = 0;
  for (const day of days) {
    const t = dailySalesTarget(rows, day, scope);
    if (t === null) return null;
    total += t;
  }
  return total;
}

/** A level target (food cost %, margin %, ticket) on `day`, or null. */
export function levelTarget(
  rows: readonly TargetRow[],
  metric: Exclude<TargetMetric, "revenue" | "orders" | "units_sold">,
  day: string,
  locationId: string | null
): number | null {
  const row = pickTargetRow(rows, metric, day, locationId);
  return row ? row.target_value : null;
}

// ---------------------------------------------------------------------------
// The weekday split
// ---------------------------------------------------------------------------

const AVG_MONTH_DAYS = 365.25 / 12;

/**
 * Milton's suggested weekday split from real sales: the AVERAGE of each
 * weekday's days, as shares that sum to 1. Null when some weekday has no day
 * of data yet (never a made-up share).
 */
export function suggestWeekdayWeights(
  daily: ReadonlyArray<{ date: string; net_sales: number }>
): number[] | null {
  const sum = Array(7).fill(0) as number[];
  const n = Array(7).fill(0) as number[];
  for (const d of daily) {
    if (!Number.isFinite(d.net_sales)) continue;
    const i = weekdayIndex(d.date);
    sum[i] += d.net_sales;
    n[i] += 1;
  }
  if (n.some((c) => c === 0)) return null;
  const avg = sum.map((s, i) => s / n[i]);
  const total = avg.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  return avg.map((a) => a / total);
}

/** What a typical Monday … Sunday would sell with this monthly target and split. */
export function weekdayAmounts(
  monthly: number,
  weights: readonly number[]
): number[] {
  return weights.map((w) => (monthly * w * 7) / AVG_MONTH_DAYS);
}

/** Back from edited amounts to weights (sum 1); null when they are not a usable split. */
export function weightsFromAmounts(
  amounts: readonly number[]
): number[] | null {
  if (amounts.length !== 7 || amounts.some((a) => !Number.isFinite(a) || a < 0))
    return null;
  const total = amounts.reduce((a, b) => a + b, 0);
  return total > 0 ? amounts.map((a) => a / total) : null;
}

/** The weights stored with a monthly row, or null for flat. */
export function parseWeights(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const nums = value.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return Math.abs(nums.reduce((a, b) => a + b, 0) - 1) <= 0.001 ? nums : null;
}

/** Round the weights so they sum to exactly 1 (what the database accepts). */
export function roundWeights(weights: readonly number[]): number[] {
  const r = weights.map((w) => Math.round(w * 1_000_000) / 1_000_000);
  const drift = 1 - r.reduce((a, b) => a + b, 0);
  r[r.indexOf(Math.max(...r))] += Math.round(drift * 1_000_000) / 1_000_000;
  return r;
}

// ---------------------------------------------------------------------------
// Reading rows from the database
// ---------------------------------------------------------------------------

const METRICS: ReadonlySet<string> = new Set([
  "revenue",
  "orders",
  "units_sold",
  "avg_ticket",
  "food_cost_pct",
  "gross_margin_pct",
]);

/** A database row (old or new shape) as a TargetRow; unusable rows are dropped. */
export function toTargetRow(raw: Record<string, unknown>): TargetRow | null {
  if (typeof raw.metric_key !== "string" || !METRICS.has(raw.metric_key))
    return null;
  const value = Number(raw.target_value);
  if (!Number.isFinite(value) || value < 0) return null;
  return {
    metric_key: raw.metric_key as TargetMetric,
    target_period: raw.target_period === "monthly" ? "monthly" : "daily",
    target_value: value,
    location_id: typeof raw.location_id === "string" ? raw.location_id : null,
    // A row from before migration 052 has no start date: valid for all history.
    effective_from:
      typeof raw.effective_from === "string" && raw.effective_from
        ? raw.effective_from.slice(0, 10)
        : LEGACY_FROM,
    is_active: raw.is_active !== false,
    weekday_weights: parseWeights(raw.weekday_weights),
  };
}
