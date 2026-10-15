// lib/restaurant/sales-detail-cube.ts
//
// R1-17b: the one dataset Ventas › Detalle works on. Every POS line is folded
// into a row per (business date, hour, restaurant, channel, payment, category,
// shift, ORDER): small enough to ship once, exact enough that every filter,
// comparison and distinct-ticket count is computed in the browser.
//
//   * business date / weekday follow migration 054 (the cutoff of each line is
//     already on the row, see fetchCompanyPosSalesRows); the hour is the real
//     clock hour.
//   * tips are rows with category −1: they carry `tip` only (never sales, never
//     a ticket, never a unit).
//   * the shift of an order is assigned here from its restaurant's shifts at
//     query time (never stored): −1 = this restaurant has no active shifts (or
//     the line has no timestamp); the «Otro horario» entry = it has shifts and
//     the order fits none.
//
// Pure: no I/O.

import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import {
  assignShift,
  businessMoment,
  type BusinessDayConfig,
  type Shift,
} from "@/lib/restaurant/business-day";
import { classifySaleLine } from "@/lib/restaurant/sales-revenue";

export const OTHER_SHIFT = "Otro horario";
export const NO_CATEGORY_LABEL = "Sin categoría";
/** How far back the cube reaches: a 90-day period + a 12-month comparison. */
export const CUBE_WINDOW_DAYS = 460;

/** [date, hour, restaurant, channel, payment, category, shift, order, net, units, gross, discount, tip] */
export type DetailRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface DetailCube {
  /** Business dates present, ascending (a row's first field indexes this). */
  dates: string[];
  /** Stored channel keys (in_store, takeaway…); null = none. */
  channels: Array<string | null>;
  payments: Array<string | null>;
  categories: string[];
  /** Restaurant ids ("" = a line with no restaurant). */
  restaurants: string[];
  /** Shift names (the last entries may be «Otro horario»). */
  shifts: string[];
  /** Σ tickets can not be summed over rows: the order index says which are the same. */
  order_count: number;
  rows: DetailRow[];
  /** First / last business day with sales in the WHOLE history (not only the window). */
  first_day: string | null;
  last_day: string | null;
  /** The cube holds business days from here on. */
  window_from: string | null;
}

export const EMPTY_CUBE: DetailCube = {
  dates: [],
  channels: [],
  payments: [],
  categories: [],
  restaurants: [],
  shifts: [],
  order_count: 0,
  rows: [],
  first_day: null,
  last_day: null,
  window_from: null,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

type CubeSourceRow = CockpitFactRow & { location_id?: string | null };

class Dict<T> {
  readonly values: T[] = [];
  private readonly index = new Map<T, number>();
  id(v: T): number {
    let i = this.index.get(v);
    if (i === undefined) {
      i = this.values.length;
      this.values.push(v);
      this.index.set(v, i);
    }
    return i;
  }
}

/**
 * Fold POS lines into the cube. `windowDays` limits the cube to the last N
 * business days before the latest one (the first/last day stay those of the
 * whole history).
 */
export function buildDetailCube(
  rows: readonly CubeSourceRow[],
  options: {
    timezone: string;
    currency?: string;
    config: BusinessDayConfig;
    windowDays?: number;
  }
): DetailCube {
  const { timezone, currency, config } = options;
  const windowDays = options.windowDays ?? CUBE_WINDOW_DAYS;

  type Line = {
    date: string;
    hour: number;
    loc: string;
    ch: string | null;
    pay: string | null;
    cat: string | null; // null = «Sin categoría»; tip handled apart
    isTip: boolean;
    shift: string | null;
    order: string | null;
    net: number;
    units: number;
    gross: number;
    disc: number;
    tip: number;
  };
  const lines: Line[] = [];
  let first: string | null = null;
  let last: string | null = null;
  const moments = new Map<string, ReturnType<typeof businessMoment>>();

  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    const loc = row.location_id ?? "";
    const cutoff = row.business_cutoff_min ?? 0;
    const mk = `${row.order_placed_at ?? ""}|${row.sale_date}|${cutoff}`;
    let m = moments.get(mk);
    if (!m) {
      m = businessMoment(row, timezone, cutoff);
      moments.set(mk, m);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) continue;
    if (first === null || m.date < first) first = m.date;
    if (last === null || m.date > last) last = m.date;

    const c = classifySaleLine(row);
    const shifts: readonly Shift[] = config.shiftsByLocation.get(loc) ?? [];
    let shift: string | null = null;
    if (shifts.some((s) => s.active) && m.clockMinutes !== null) {
      shift =
        assignShift(shifts, m.clockMinutes, m.isoWeekday)?.name ?? OTHER_SHIFT;
    }
    const orderRaw = row.check_id ?? row.order_id ?? null;
    lines.push({
      date: m.date,
      hour: m.hour ?? -1,
      loc,
      ch: row.sales_channel?.trim() || null,
      pay: row.payment_type?.trim() || null,
      cat: row.category?.trim() || null,
      isTip: c.isTip,
      shift,
      order: orderRaw ? `${loc}|${orderRaw}` : null,
      net: c.isTip ? 0 : c.net,
      units: c.isTip
        ? 0
        : typeof row.quantity === "number" && Number.isFinite(row.quantity)
          ? row.quantity
          : 0,
      gross: c.isTip ? 0 : c.gross,
      disc: c.isTip ? 0 : c.discount,
      tip: c.isTip ? c.tip : 0,
    });
  }

  let kept = lines;
  let windowFrom: string | null = null;
  if (last !== null) {
    const [y, mo, d] = last.split("-").map(Number);
    const cut = new Date(Date.UTC(y, mo - 1, d - (windowDays - 1)));
    windowFrom = cut.toISOString().slice(0, 10);
    const wf = windowFrom;
    kept = lines.filter((l) => l.date >= wf);
  }
  if (first !== null && windowFrom !== null && first > windowFrom)
    windowFrom = first;

  const dates = [...new Set(kept.map((l) => l.date))].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const channels = new Dict<string | null>();
  const payments = new Dict<string | null>();
  const categories = new Dict<string>();
  const restaurants = new Dict<string>();
  const shiftDict = new Dict<string>();
  const orders = new Dict<string>();
  // Shifts in the order people set them (not in the order the data happens to
  // show them); «Otro horario» always last.
  {
    const configured = [...config.shiftsByLocation.values()]
      .flat()
      .filter((x) => x.active)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const x of configured) shiftDict.id(x.name);
    if (kept.some((l) => l.shift === OTHER_SHIFT)) shiftDict.id(OTHER_SHIFT);
  }

  const folded = new Map<string, DetailRow>();
  for (const l of kept) {
    const catId = l.isTip ? -1 : categories.id(l.cat ?? NO_CATEGORY_LABEL);
    const orderId = l.order ? orders.id(l.order) : -1;
    const key = [
      dateIdx.get(l.date),
      l.hour,
      l.loc,
      l.ch,
      l.pay,
      catId,
      l.shift,
      orderId,
    ].join("\u0001");
    let r = folded.get(key);
    if (!r) {
      r = [
        dateIdx.get(l.date) as number,
        l.hour,
        restaurants.id(l.loc),
        channels.id(l.ch),
        payments.id(l.pay),
        catId,
        l.shift === null ? -1 : shiftDict.id(l.shift),
        orderId,
        0,
        0,
        0,
        0,
        0,
      ];
      folded.set(key, r);
    }
    r[8] += l.net;
    r[9] += l.units;
    r[10] += l.gross;
    r[11] += l.disc;
    r[12] += l.tip;
  }
  const out = [...folded.values()].map(
    (r) =>
      [
        r[0],
        r[1],
        r[2],
        r[3],
        r[4],
        r[5],
        r[6],
        r[7],
        r2(r[8]),
        Math.round(r[9] * 1000) / 1000,
        r2(r[10]),
        r2(r[11]),
        r2(r[12]),
      ] as DetailRow
  );
  out.sort((a, b) => a[0] - b[0] || a[7] - b[7]);

  return {
    dates,
    channels: channels.values,
    payments: payments.values,
    categories: categories.values,
    restaurants: restaurants.values,
    shifts: shiftDict.values,
    order_count: orders.values.length,
    rows: out,
    first_day: first,
    last_day: last,
    window_from: windowFrom,
  };
}

/** A payload from the API (or anything else) as a cube, or null when it is not one. */
export function parseDetailCube(raw: unknown): DetailCube | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<DetailCube>;
  if (
    !Array.isArray(c.dates) ||
    !Array.isArray(c.rows) ||
    !Array.isArray(c.channels) ||
    !Array.isArray(c.payments) ||
    !Array.isArray(c.categories) ||
    !Array.isArray(c.restaurants) ||
    !Array.isArray(c.shifts)
  )
    return null;
  return {
    dates: c.dates as string[],
    channels: c.channels as Array<string | null>,
    payments: c.payments as Array<string | null>,
    categories: c.categories as string[],
    restaurants: c.restaurants as string[],
    shifts: c.shifts as string[],
    order_count: typeof c.order_count === "number" ? c.order_count : 0,
    rows: c.rows as DetailRow[],
    first_day: typeof c.first_day === "string" ? c.first_day : null,
    last_day: typeof c.last_day === "string" ? c.last_day : null,
    window_from: typeof c.window_from === "string" ? c.window_from : null,
  };
}
