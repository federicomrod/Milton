// lib/restaurant/sales-detail.ts
//
// R1-17b: the arithmetic of Ventas › Detalle. Pure: it takes the cube (one
// dataset, loaded once) and the page state and returns everything the page
// draws — so every filter, comparison and click is computed in the browser, in
// well under 300 ms, with no request.
//
// Rules
//   * Filters are independent. A dimension's own tiles/cards ignore that
//     dimension's own selection (so you can still see and pick the others);
//     everything else (KPIs, chart, heatmap) applies all of them.
//   * Tickets are DISTINCT orders: counted once however many categories or
//     rows an order has. Tips are never sales, units or tickets.
//   * Δ = (actual − anterior) ÷ anterior. Without a comparable period (the
//     data does not reach back, or the base is 0) it is «—», never 0%.
//   * A comparison never sets a full period against a partial one: a window
//     that starts before the data is «—»; the trailing averages are cut to
//     where the data starts and scaled to the days of the period.
//   * Goals (Objetivos) are drawn only when no dimension filter is active (a
//     sales goal is for the whole business, not for a slice) and only when
//     they exist: no goal = no line, no chip, never 0.

import { fmt, getDictionary } from "@/lib/i18n";
import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  addDays,
  daysBetween,
  eachDay,
  pctChange,
  shiftRange,
  subMonths,
  trailingWindow,
  type Range,
} from "@/lib/restaurant/cockpit-math";
import {
  dailySalesTarget,
  levelTarget,
  periodSalesTarget,
  type TargetRow,
  type TargetScope,
} from "@/lib/restaurant/objetivos";
import {
  NO_CATEGORY_LABEL,
  OTHER_SHIFT,
  type DetailCube,
} from "@/lib/restaurant/sales-detail-cube";
import { weekdayIndex } from "@/lib/restaurant/objetivos";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type PeriodKey = "7d" | "30d" | "90d" | "custom";
export type CompareKey =
  | "prev_period"
  | "prev_week"
  | "last_year"
  | "avg_6"
  | "avg_12";
export type DimKey = "categoria" | "canal" | "pago" | "turno";
export type TabKey = "tendencia" | "desglose" | "platos";
export type ViewKey = "tarjetas" | "tabla";
export type HeatMetric = "ventas" | "tickets" | "ticket";
export type CrossKey = "ninguno" | "canal" | "pago" | "categoria";
export type ChartMetric = "ventas" | "tickets";

export const PERIODS: ReadonlyArray<{
  key: PeriodKey;
  label: string;
  days?: number;
}> = [
  { key: "7d", label: "7 d", days: 7 },
  { key: "30d", label: "30 d", days: 30 },
  { key: "90d", label: "90 d", days: 90 },
  { key: "custom", label: "Personalizado" },
];

export const COMPARE_OPTIONS: ReadonlyArray<{
  key: CompareKey;
  label: string;
  short: string;
}> = [
  { key: "prev_period", label: "período anterior", short: "período ant." },
  { key: "prev_week", label: "semana anterior", short: "sem. ant." },
  { key: "last_year", label: "mismo período año pasado", short: "año pasado" },
  { key: "avg_6", label: "promedio últimos 6 meses", short: "prom. 6 meses" },
  {
    key: "avg_12",
    label: "promedio últimos 12 meses",
    short: "prom. 12 meses",
  },
];

/** A Δ chip on a tile is coloured only from this change on (a constant, not shown). */
export const TILE_DELTA_THRESHOLD = 15;
/** The «no value» token of a filter (a line with no channel / payment). */
export const NONE_TOKEN = "__none__";

const CHANNEL_ES: Record<string, string> = {
  in_store: "Comer aquí",
  takeaway: "Para llevar",
  delivery: "Delivery",
  online: "En línea",
};
export function channelLabelEs(
  key: string | null,
  lang: PreferredLanguage = "es"
): string {
  if (lang !== "es") {
    const c = getDictionary(lang).sales.detail.channels;
    if (key === null) return c.none;
    const known: Record<string, string> = {
      in_store: c.inStore,
      takeaway: c.takeaway,
      delivery: c.delivery,
      online: c.online,
    };
    return known[key] ?? key;
  }
  if (key === null) return "Sin canal";
  return CHANNEL_ES[key] ?? key;
}
export function paymentLabelEs(
  key: string | null,
  lang: PreferredLanguage = "es"
): string {
  return key === null ? getDictionary(lang).sales.detail.noPayment : key;
}
/** The display name of a category; the token stays «Sin categoría» in the cube. */
export function categoryLabel(
  category: string,
  lang: PreferredLanguage = "es"
): string {
  return category === NO_CATEGORY_LABEL
    ? getDictionary(lang).sales.labels.uncategorized
    : category;
}

// ---------------------------------------------------------------------------
// State (and the URL it lives in)
// ---------------------------------------------------------------------------

export interface DetailState {
  tab: TabKey;
  dim: DimKey;
  view: ViewKey;
  period: PeriodKey;
  /** Custom range (YYYY-MM-DD), used when period === "custom". */
  from: string | null;
  to: string | null;
  compare: CompareKey;
  channels: string[];
  payments: string[];
  categories: string[];
  shifts: string[];
  /** ISO weekdays 1 = lunes … 7 = domingo. */
  weekdays: number[];
  hours: number[];
  chart: ChartMetric;
  heat: HeatMetric;
  cross: CrossKey;
}

export const DEFAULT_STATE: DetailState = {
  tab: "tendencia",
  dim: "categoria",
  view: "tarjetas",
  period: "7d",
  from: null,
  to: null,
  compare: "prev_week",
  channels: [],
  payments: [],
  categories: [],
  shifts: [],
  weekdays: [],
  hours: [],
  chart: "ventas",
  heat: "ventas",
  cross: "ninguno",
};

const oneOf = <T extends string>(
  v: string | null,
  all: readonly T[],
  d: T
): T => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : d);
const list = (v: string | null) =>
  v ? v.split("|").filter((x) => x.length > 0) : [];
const ymd = (v: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const ints = (v: string | null, lo: number, hi: number) =>
  list(v)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= lo && n <= hi);

export function parseDetailState(
  params: URLSearchParams | Record<string, string | undefined>
): DetailState {
  const get = (k: string) =>
    params instanceof URLSearchParams ? params.get(k) : (params[k] ?? null);
  return {
    tab: oneOf(get("tab"), ["tendencia", "desglose", "platos"], "tendencia"),
    dim: oneOf(
      get("dim"),
      ["categoria", "canal", "pago", "turno"],
      "categoria"
    ),
    view: oneOf(get("vista"), ["tarjetas", "tabla"], "tarjetas"),
    period: oneOf(get("p"), ["7d", "30d", "90d", "custom"], "7d"),
    from: ymd(get("desde")),
    to: ymd(get("hasta")),
    compare: oneOf(
      get("cmp"),
      COMPARE_OPTIONS.map((c) => c.key),
      "prev_week"
    ),
    channels: list(get("canal")),
    payments: list(get("pago")),
    categories: list(get("cat")),
    shifts: list(get("turno")),
    weekdays: ints(get("dia"), 1, 7),
    hours: ints(get("hora"), 0, 23),
    chart: oneOf(get("graf"), ["ventas", "tickets"], "ventas"),
    heat: oneOf(get("mapa"), ["ventas", "tickets", "ticket"], "ventas"),
    cross: oneOf(
      get("cruzar"),
      ["ninguno", "canal", "pago", "categoria"],
      "ninguno"
    ),
  };
}

/** The non-default part of the state as URL params (the page's own keys only). */
export function serializeDetailState(s: DetailState): URLSearchParams {
  const q = new URLSearchParams();
  const D = DEFAULT_STATE;
  if (s.tab !== D.tab) q.set("tab", s.tab);
  if (s.dim !== D.dim) q.set("dim", s.dim);
  if (s.view !== D.view) q.set("vista", s.view);
  if (s.period !== D.period) q.set("p", s.period);
  if (s.period === "custom") {
    if (s.from) q.set("desde", s.from);
    if (s.to) q.set("hasta", s.to);
  }
  if (s.compare !== D.compare) q.set("cmp", s.compare);
  if (s.channels.length) q.set("canal", s.channels.join("|"));
  if (s.payments.length) q.set("pago", s.payments.join("|"));
  if (s.categories.length) q.set("cat", s.categories.join("|"));
  if (s.shifts.length) q.set("turno", s.shifts.join("|"));
  if (s.weekdays.length) q.set("dia", s.weekdays.join("|"));
  if (s.hours.length) q.set("hora", s.hours.join("|"));
  if (s.chart !== D.chart) q.set("graf", s.chart);
  if (s.heat !== D.heat) q.set("mapa", s.heat);
  if (s.cross !== D.cross) q.set("cruzar", s.cross);
  return q;
}

export const hasDimensionFilters = (s: DetailState) =>
  s.channels.length +
    s.payments.length +
    s.categories.length +
    s.shifts.length +
    s.weekdays.length +
    s.hours.length >
  0;

// ---------------------------------------------------------------------------
// The prepared cube (typed arrays, row slice per day)
// ---------------------------------------------------------------------------

export interface PreparedCube {
  cube: DetailCube;
  n: number;
  date: Int32Array;
  hour: Int8Array;
  ch: Int32Array;
  pay: Int32Array;
  cat: Int32Array;
  shift: Int32Array;
  order: Int32Array;
  net: Float64Array;
  units: Float64Array;
  gross: Float64Array;
  disc: Float64Array;
  tip: Float64Array;
  /** ISO weekday of each date index. */
  isoWeekday: Uint8Array;
  /** First row of each date index (+ one past the last): rows are sorted by date. */
  dayStart: Int32Array;
  dateIndex: Map<string, number>;
  stamp: Int32Array;
  stampNow: { v: number };
}

export function prepareCube(cube: DetailCube): PreparedCube {
  const n = cube.rows.length;
  const p: PreparedCube = {
    cube,
    n,
    date: new Int32Array(n),
    hour: new Int8Array(n),
    ch: new Int32Array(n),
    pay: new Int32Array(n),
    cat: new Int32Array(n),
    shift: new Int32Array(n),
    order: new Int32Array(n),
    net: new Float64Array(n),
    units: new Float64Array(n),
    gross: new Float64Array(n),
    disc: new Float64Array(n),
    tip: new Float64Array(n),
    isoWeekday: new Uint8Array(cube.dates.length),
    dayStart: new Int32Array(cube.dates.length + 1),
    dateIndex: new Map(cube.dates.map((d, i) => [d, i])),
    stamp: new Int32Array(Math.max(cube.order_count, 1)),
    stampNow: { v: 0 },
  };
  for (let i = 0; i < n; i += 1) {
    const r = cube.rows[i];
    p.date[i] = r[0];
    p.hour[i] = r[1];
    // r[2] is the restaurant: the page is already scoped to one or all of them
    p.ch[i] = r[3];
    p.pay[i] = r[4];
    p.cat[i] = r[5];
    p.shift[i] = r[6];
    p.order[i] = r[7];
    p.net[i] = r[8];
    p.units[i] = r[9];
    p.gross[i] = r[10];
    p.disc[i] = r[11];
    p.tip[i] = r[12];
  }
  cube.dates.forEach((d, i) => {
    p.isoWeekday[i] = weekdayIndex(d) + 1; // weekdayIndex: lunes = 0 → ISO 1
  });
  let row = 0;
  for (let d = 0; d <= cube.dates.length; d += 1) {
    while (row < n && p.date[row] < d) row += 1;
    p.dayStart[d] = row;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

interface Mask {
  ch: Uint8Array | null;
  pay: Uint8Array | null;
  cat: Uint8Array | null;
  shift: Uint8Array | null;
  wd: Uint8Array | null; // index 1..7
  hour: Uint8Array | null;
}

function maskOf(
  tokens: readonly string[],
  values: ReadonlyArray<string | null>
): Uint8Array | null {
  if (tokens.length === 0) return null;
  const m = new Uint8Array(values.length);
  const want = new Set(tokens);
  values.forEach((v, i) => {
    if (want.has(v === null ? NONE_TOKEN : v)) m[i] = 1;
  });
  return m;
}

export function buildMask(
  p: PreparedCube,
  s: DetailState,
  omit?: DimKey | "heat"
): Mask {
  const c = p.cube;
  const wd = s.weekdays.length && omit !== "heat" ? new Uint8Array(8) : null;
  if (wd) for (const d of s.weekdays) wd[d] = 1;
  const hour = s.hours.length && omit !== "heat" ? new Uint8Array(24) : null;
  if (hour) for (const h of s.hours) hour[h] = 1;
  return {
    ch: omit === "canal" ? null : maskOf(s.channels, c.channels),
    pay: omit === "pago" ? null : maskOf(s.payments, c.payments),
    cat: omit === "categoria" ? null : maskOf(s.categories, c.categories),
    shift: omit === "turno" ? null : maskOf(s.shifts, c.shifts),
    wd,
    hour,
  };
}

function passes(p: PreparedCube, i: number, m: Mask): boolean {
  if (m.ch && !m.ch[p.ch[i]]) return false;
  if (m.pay && !m.pay[p.pay[i]]) return false;
  if (m.cat) {
    const c = p.cat[i];
    if (c < 0 || !m.cat[c]) return false;
  }
  if (m.shift) {
    const s = p.shift[i];
    if (s < 0 || !m.shift[s]) return false;
  }
  if (m.wd && !m.wd[p.isoWeekday[p.date[i]]]) return false;
  if (m.hour) {
    const h = p.hour[i];
    if (h < 0 || !m.hour[h]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Totals {
  net: number;
  gross: number;
  discounts: number;
  tips: number;
  units: number;
  tickets: number;
}

export interface DayTotals {
  date: string;
  net: number;
  tickets: number;
}

const emptyTotals = (): Totals => ({
  net: 0,
  gross: 0,
  discounts: 0,
  tips: 0,
  units: 0,
  tickets: 0,
});

/** Row slice [from, to) of the date range [from, to] (inclusive, YYYY-MM-DD). */
function slice(
  p: PreparedCube,
  from: string,
  to: string
): [number, number, number] {
  const dates = p.cube.dates;
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  const firstDate = lo;
  hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= to) lo = mid + 1;
    else hi = mid;
  }
  return [firstDate, lo, 0];
}

export function aggregate(
  p: PreparedCube,
  range: Range,
  mask: Mask,
  withDays = false
): { totals: Totals; days: DayTotals[] } {
  const [d0, d1] = slice(p, range.from, range.to);
  const t = emptyTotals();
  const days: DayTotals[] = [];
  const stamp = ++p.stampNow.v;
  for (let d = d0; d < d1; d += 1) {
    let net = 0;
    let tickets = 0;
    for (let i = p.dayStart[d]; i < p.dayStart[d + 1]; i += 1) {
      if (!passes(p, i, mask)) continue;
      net += p.net[i];
      t.gross += p.gross[i];
      t.discounts += p.disc[i];
      t.tips += p.tip[i];
      t.units += p.units[i];
      const o = p.order[i];
      if (p.cat[i] >= 0 && o >= 0 && p.stamp[o] !== stamp) {
        p.stamp[o] = stamp;
        tickets += 1;
      }
    }
    t.net += net;
    t.tickets += tickets;
    if (withDays) days.push({ date: p.cube.dates[d], net, tickets });
  }
  return { totals: t, days };
}

export interface GroupTotals {
  net: number;
  units: number;
  tickets: number;
  gross: number;
}

/** Totals per value of a dimension (tips out), under `mask`. Key = the dictionary id. */
export function groupBy(
  p: PreparedCube,
  range: Range,
  mask: Mask,
  dim: DimKey
): Map<number, GroupTotals> {
  const [d0, d1] = slice(p, range.from, range.to);
  const out = new Map<number, GroupTotals>();
  // Orders belong to ONE channel / payment / shift; to several categories.
  const distinct = dim !== "categoria";
  const stamp = ++p.stampNow.v;
  for (let d = d0; d < d1; d += 1) {
    for (let i = p.dayStart[d]; i < p.dayStart[d + 1]; i += 1) {
      if (p.cat[i] < 0) continue; // tips are not a slice of sales
      if (!passes(p, i, mask)) continue;
      const key =
        dim === "categoria"
          ? p.cat[i]
          : dim === "canal"
            ? p.ch[i]
            : dim === "pago"
              ? p.pay[i]
              : p.shift[i];
      if (dim === "turno" && key < 0) continue;
      let g = out.get(key);
      if (!g) {
        g = { net: 0, units: 0, tickets: 0, gross: 0 };
        out.set(key, g);
      }
      g.net += p.net[i];
      g.units += p.units[i];
      g.gross += p.gross[i];
      const o = p.order[i];
      if (o >= 0) {
        if (distinct) {
          if (p.stamp[o] !== stamp) {
            p.stamp[o] = stamp;
            g.tickets += 1;
          }
        } else g.tickets += 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heatmap (weekday × hour)
// ---------------------------------------------------------------------------

export interface HeatCell {
  net: number;
  tickets: number;
}
/** cells[weekdayIso 1..7][hour 0..23] */
export type HeatGrid = HeatCell[][];

const emptyGrid = (): HeatGrid =>
  Array.from({ length: 8 }, () =>
    Array.from({ length: 24 }, () => ({ net: 0, tickets: 0 }))
  );

export function heatGrid(p: PreparedCube, range: Range, mask: Mask): HeatGrid {
  const [d0, d1] = slice(p, range.from, range.to);
  const g = emptyGrid();
  const stamp = ++p.stampNow.v;
  for (let d = d0; d < d1; d += 1) {
    const wd = p.isoWeekday[d];
    for (let i = p.dayStart[d]; i < p.dayStart[d + 1]; i += 1) {
      const h = p.hour[i];
      if (h < 0 || p.cat[i] < 0) continue;
      if (!passes(p, i, mask)) continue;
      const cell = g[wd][h];
      cell.net += p.net[i];
      const o = p.order[i];
      if (o >= 0 && p.stamp[o] !== stamp) {
        p.stamp[o] = stamp;
        cell.tickets += 1;
      }
    }
  }
  return g;
}

export function heatValue(c: HeatCell, metric: HeatMetric): number | null {
  if (metric === "ventas") return c.net;
  if (metric === "tickets") return c.tickets;
  return c.tickets > 0 ? c.net / c.tickets : null;
}

// ---------------------------------------------------------------------------
// Comparison windows
// ---------------------------------------------------------------------------

export interface Baseline {
  range: Range;
  /** Multiply the baseline by this to line it up with the period (trailing averages). */
  scale: number;
  /** Cut because the data starts later, e.g. «solo 3 meses de datos». */
  note: string | null;
}

/** The comparison window of `range`, or null when there is no comparable one. */
export function baselineFor(
  key: CompareKey,
  range: Range,
  firstDay: string | null,
  lang: PreferredLanguage = "es"
): Baseline | null {
  if (!firstDay) return null;
  const n = daysBetween(range.from, range.to);
  let b: Range;
  if (key === "prev_period") b = shiftRange(range, n);
  else if (key === "prev_week") b = shiftRange(range, 7);
  else if (key === "last_year")
    b = { from: subMonths(range.from, 12), to: subMonths(range.to, 12) };
  else {
    const months = key === "avg_6" ? 6 : 12;
    const w = trailingWindow(addDays(range.from, -1), months, firstDay);
    if (w.days <= 0 || w.to < w.from) return null;
    return {
      range: { from: w.from, to: w.to },
      scale: n / w.days,
      note: w.cut
        ? fmt(
            w.days === 1
              ? getDictionary(lang).cockpit.dataSpan.daysOne
              : getDictionary(lang).cockpit.dataSpan.daysOther,
            { n: w.days }
          )
        : null,
    };
  }
  // A window that starts before the data is never lined up against a full period.
  if (b.from < firstDay) return null;
  return { range: b, scale: 1, note: null };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface Kpi {
  value: number | null;
  /** The goal for the period (only without dimension filters, only if it exists). */
  target: number | null;
  /** Percent vs the goal. */
  vsTarget: number | null;
  /** Percent vs the comparison; null = «—». */
  delta: number | null;
}

export interface DayBar {
  date: string;
  net: number;
  tickets: number;
  target: number | null;
}

export interface DimRow {
  /** The filter token (stored key, category name, shift name or NONE_TOKEN). */
  token: string;
  label: string;
  net: number;
  share: number; // 0–100
  tickets: number;
  units: number;
  perUnit: number | null;
  delta: number | null;
  selected: boolean;
}

export interface ShiftCard {
  name: string;
  other: boolean;
  net: number;
  share: number;
  tickets: number;
  ticket: number | null;
}

export interface CrossGrid {
  token: string;
  label: string;
  grid: HeatGrid;
}

export interface DetailView {
  range: Range;
  days: number;
  empty: boolean;
  compare: {
    key: CompareKey;
    label: string;
    short: string;
    baseline: Baseline | null;
  };
  filtersActive: boolean;
  kpis: {
    net: Kpi;
    tickets: Kpi;
    ticket: Kpi;
    units: Kpi;
    gross: number;
    discounts: number;
    tips: number;
    best: { date: string; net: number; tickets: number } | null;
  };
  daily: DayBar[];
  /** The daily target line exists (any day has a goal) and no dimension filter hides it. */
  dailyTarget: boolean;
  heat: HeatGrid;
  cross: CrossGrid[];
  /** Rows of the active dimension (all values, sorted by sales). */
  dimRows: DimRow[];
  dimTotal: number;
  /** Selected tiles of the active dimension: names + their sum and share. */
  selection: { labels: string[]; net: number; share: number } | null;
  shiftCards: ShiftCard[] | null;
  /** The period as asked was clipped to what the cube holds. */
  clipped: boolean;
}

export interface DetailInput {
  prepared: PreparedCube;
  state: DetailState;
  targets: readonly TargetRow[];
  scope: TargetScope;
  /** ≥ 2 active shifts in view: shift cards, filter and dimension exist. */
  shiftsVisible: boolean;
  /** Language of the labels the view carries (default Spanish). */
  lang?: PreferredLanguage;
}

export function resolveRange(
  state: DetailState,
  cube: Pick<DetailCube, "last_day" | "window_from">
): { range: Range; clipped: boolean } | null {
  const last = cube.last_day;
  if (!last) return null;
  let range: Range;
  if (state.period === "custom" && state.from && state.to) {
    const from = state.from <= state.to ? state.from : state.to;
    const to = state.from <= state.to ? state.to : state.from;
    range = { from, to: to > last ? last : to };
    if (range.from > range.to) range = { from: range.to, to: range.to };
  } else {
    const days = state.period === "30d" ? 30 : state.period === "90d" ? 90 : 7;
    range = { from: addDays(last, -(days - 1)), to: last };
  }
  let clipped = false;
  if (cube.window_from && range.from < cube.window_from) {
    range = { from: cube.window_from, to: range.to };
    clipped = true;
  }
  return { range, clipped };
}

const orderedRows = (
  groups: Map<number, GroupTotals>,
  base: Map<number, GroupTotals> | null,
  scale: number,
  label: (id: number) => string,
  token: (id: number) => string,
  selected: ReadonlySet<string>,
  lang: PreferredLanguage = "es"
): DimRow[] => {
  let total = 0;
  for (const g of groups.values()) total += g.net;
  const rows: DimRow[] = [];
  for (const [id, g] of groups) {
    const b = base?.get(id);
    rows.push({
      token: token(id),
      label: label(id),
      net: Math.round(g.net * 100) / 100,
      share: total > 0 ? (g.net / total) * 100 : 0,
      tickets: g.tickets,
      units: Math.round(g.units * 1000) / 1000,
      perUnit: g.units > 0 ? g.net / g.units : null,
      delta: base ? pctChange(g.net, b ? b.net * scale : 0) : null,
      selected: selected.has(token(id)),
    });
  }
  return rows.sort(
    (a, b) => b.net - a.net || a.label.localeCompare(b.label, localeFor(lang))
  );
};

export function computeDetail(input: DetailInput): DetailView | null {
  const { prepared: p, state, targets, scope } = input;
  const lang = input.lang ?? "es";
  const cube = p.cube;
  const resolved = resolveRange(state, cube);
  if (!resolved) return null;
  const { range, clipped } = resolved;
  const days = daysBetween(range.from, range.to);
  const option =
    COMPARE_OPTIONS.find((c) => c.key === state.compare) ?? COMPARE_OPTIONS[1];
  // The first day with data — never earlier than what the cube holds.
  const firstDay =
    cube.first_day && cube.window_from && cube.window_from > cube.first_day
      ? cube.window_from
      : cube.first_day;
  const baseline = baselineFor(option.key, range, firstDay, lang);
  const filtersActive = hasDimensionFilters(state);

  const all = buildMask(p, state);
  const cur = aggregate(p, range, all, true);
  const base = baseline ? aggregate(p, baseline.range, all, false) : null;
  const scale = baseline?.scale ?? 1;

  // Goals: only for the whole business.
  const salesTarget = filtersActive
    ? null
    : periodSalesTarget(targets, range.from, range.to, scope);
  const ticketTarget = filtersActive
    ? null
    : levelTarget(targets, "avg_ticket", range.to, scope.locationId);
  const ticketOf = (t: Totals) => (t.tickets > 0 ? t.net / t.tickets : null);
  const kpi = (
    value: number | null,
    baseValue: number | null,
    target: number | null
  ): Kpi => ({
    value,
    target,
    vsTarget:
      target !== null && value !== null ? pctChange(value, target) : null,
    delta:
      base !== null && value !== null && baseValue !== null
        ? pctChange(value, baseValue)
        : null,
  });
  const baseTickets = base ? base.totals.tickets * scale : null;
  const baseTicket = base ? ticketOf(base.totals) : null;

  const daily: DayBar[] = eachDay(range.from, range.to).map((date) => {
    const d = cur.days.find((x) => x.date === date);
    return {
      date,
      net: d ? Math.round(d.net * 100) / 100 : 0,
      tickets: d?.tickets ?? 0,
      target: filtersActive ? null : dailySalesTarget(targets, date, scope),
    };
  });
  let best: DetailView["kpis"]["best"] = null;
  for (const d of cur.days) {
    if (d.net > 0 && (best === null || d.net > best.net))
      best = {
        date: d.date,
        net: Math.round(d.net * 100) / 100,
        tickets: d.tickets,
      };
  }

  // Heatmap: every cell visible (the selected day/hour is outlined, not applied to itself).
  const heatMask = buildMask(p, state, "heat");
  const heat = heatGrid(p, range, heatMask);
  const cross: CrossGrid[] = [];
  if (state.cross !== "ninguno") {
    // Small multiples: the top values of the crossed dimension (under every OTHER
    // filter), each with its own grid.
    const dimKey: DimKey =
      state.cross === "canal"
        ? "canal"
        : state.cross === "pago"
          ? "pago"
          : "categoria";
    const own = buildMask(p, state, "heat");
    if (dimKey === "canal") own.ch = null;
    else if (dimKey === "pago") own.pay = null;
    else own.cat = null;
    const groups = groupBy(p, range, own, dimKey);
    const top = [...groups.entries()]
      .sort((a, b) => b[1].net - a[1].net)
      .slice(0, 4);
    for (const [id] of top) {
      const only = new Uint8Array(
        dimKey === "canal"
          ? cube.channels.length
          : dimKey === "pago"
            ? cube.payments.length
            : cube.categories.length
      );
      only[id] = 1;
      const m: Mask = { ...own };
      if (dimKey === "canal") m.ch = only;
      else if (dimKey === "pago") m.pay = only;
      else m.cat = only;
      cross.push({
        token: tokenOf(cube, dimKey, id),
        label: labelOf(cube, dimKey, id, lang),
        grid: heatGrid(p, range, m),
      });
    }
  }

  // The active dimension's rows: all its values, under every OTHER filter.
  const dimMask = buildMask(p, state, state.dim);
  const groups = groupBy(p, range, dimMask, state.dim);
  const baseGroups = baseline
    ? groupBy(p, baseline.range, dimMask, state.dim)
    : null;
  const selectedTokens = new Set(
    state.dim === "categoria"
      ? state.categories
      : state.dim === "canal"
        ? state.channels
        : state.dim === "pago"
          ? state.payments
          : state.shifts
  );
  const dimRows = orderedRows(
    groups,
    baseGroups,
    scale,
    (id) => labelOf(cube, state.dim, id, lang),
    (id) => tokenOf(cube, state.dim, id),
    selectedTokens,
    lang
  );
  const dimTotal = dimRows.reduce((a, r) => a + r.net, 0);
  const picked = dimRows.filter((r) => r.selected);
  const selection =
    picked.length > 0
      ? {
          labels: picked.map((r) => r.label),
          net: Math.round(picked.reduce((a, r) => a + r.net, 0) * 100) / 100,
          share:
            dimTotal > 0
              ? (picked.reduce((a, r) => a + r.net, 0) / dimTotal) * 100
              : 0,
        }
      : null;

  // Shift cards: one per shift, under every other filter.
  let shiftCards: ShiftCard[] | null = null;
  if (input.shiftsVisible) {
    const sg = groupBy(p, range, buildMask(p, state, "turno"), "turno");
    let total = 0;
    for (const g of sg.values()) total += g.net;
    // Every configured shift has a card (a quiet one shows $0 instead of vanishing);
    // «Otro horario» only when it has something in it.
    shiftCards = cube.shifts
      .map((name, id) => {
        const g = sg.get(id);
        const net = g?.net ?? 0;
        const tickets = g?.tickets ?? 0;
        return {
          name,
          other: name === OTHER_SHIFT,
          net: Math.round(net * 100) / 100,
          share: total > 0 ? (net / total) * 100 : 0,
          tickets,
          ticket: tickets > 0 ? net / tickets : null,
        };
      })
      .filter((c) => !c.other || c.net > 0);
  }

  return {
    range,
    days,
    empty: cur.totals.net === 0 && cur.totals.tickets === 0,
    compare: {
      key: option.key,
      label: compareText(option.key, lang).label,
      short: compareText(option.key, lang).short,
      baseline,
    },
    filtersActive,
    kpis: {
      net: kpi(
        cur.totals.net,
        base ? base.totals.net * scale : null,
        salesTarget
      ),
      tickets: kpi(cur.totals.tickets, baseTickets, null),
      ticket: kpi(ticketOf(cur.totals), baseTicket, ticketTarget),
      units: kpi(
        cur.totals.units,
        base ? base.totals.units * scale : null,
        null
      ),
      gross: cur.totals.gross,
      discounts: cur.totals.discounts,
      tips: cur.totals.tips,
      best,
    },
    daily,
    dailyTarget: daily.some((d) => d.target !== null),
    heat,
    cross,
    dimRows,
    dimTotal,
    selection,
    shiftCards,
    clipped,
  };
}

/** The «Comparar» option's long and short text in `lang` (Spanish = the constants above). */
export function compareText(
  key: CompareKey,
  lang: PreferredLanguage = "es"
): { label: string; short: string } {
  const option =
    COMPARE_OPTIONS.find((c) => c.key === key) ?? COMPARE_OPTIONS[1];
  if (lang === "es") return { label: option.label, short: option.short };
  const c = getDictionary(lang).sales.detail.compare;
  const map: Record<CompareKey, { label: string; short: string }> = {
    prev_period: { label: c.prevPeriod, short: c.prevPeriodShort },
    prev_week: { label: c.prevWeek, short: c.prevWeekShort },
    last_year: { label: c.lastYear, short: c.lastYearShort },
    avg_6: { label: c.avg6, short: c.avg6Short },
    avg_12: { label: c.avg12, short: c.avg12Short },
  };
  return map[key];
}

function labelOf(
  cube: DetailCube,
  dim: DimKey,
  id: number,
  lang: PreferredLanguage
): string {
  if (dim === "categoria")
    return categoryLabel(cube.categories[id] ?? NO_CATEGORY_LABEL, lang);
  if (dim === "canal") return channelLabelEs(cube.channels[id] ?? null, lang);
  if (dim === "pago") return paymentLabelEs(cube.payments[id] ?? null, lang);
  return cube.shifts[id] ?? "";
}
function tokenOf(cube: DetailCube, dim: DimKey, id: number): string {
  if (dim === "categoria") return cube.categories[id] ?? NO_CATEGORY_LABEL;
  if (dim === "canal") return cube.channels[id] ?? NONE_TOKEN;
  if (dim === "pago") return cube.payments[id] ?? NONE_TOKEN;
  return cube.shifts[id] ?? "";
}

/** Toggle one value of a filter; `multi` (⌘/Ctrl/Shift click) adds to the selection. */
export function toggleToken(
  current: readonly string[],
  token: string,
  multi: boolean
): string[] {
  const has = current.includes(token);
  if (multi)
    return has ? current.filter((t) => t !== token) : [...current, token];
  return has && current.length === 1 ? [] : [token];
}
