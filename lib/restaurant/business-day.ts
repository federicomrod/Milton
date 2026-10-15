// lib/restaurant/business-day.ts
//
// R1-17a: the business day and the shifts. One TS definition that mirrors the
// SQL of migration 054 (restaurant_business_day_cutoff, the shift assignment
// of sales_period_rollup) so the rollups and the row walk always agree:
//
//   business date = (local timestamp − cutoff)::date
//   cutoff        = end of the restaurant's last active shift that crosses
//                   midnight (never after 09:00), else 04:00
//   shift         = the active shift whose [start, end) contains the LOCAL
//                   clock time and whose weekdays include the BUSINESS weekday
//
// Pure: no I/O. Before migration 054 the app keeps today's behaviour: no
// cutoff (the calendar day) and no shifts.

import { normalizeTimezone } from "@/lib/restaurant/email/preferences";

export const DEFAULT_CUTOFF_MINUTES = 240; // 04:00
export const MAX_CUTOFF_MINUTES = 540; // 09:00: later is "unclear"
export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // 1 = lunes … 7 = domingo

export interface Shift {
  id?: string;
  name: string;
  /** "HH:MM" (end "24:00" = end of the day). */
  start_time: string;
  end_time: string;
  weekdays: number[];
  active: boolean;
  sort_order?: number;
}

/** "HH:MM" / "HH:MM:SS" → minutes since 00:00 (24:00 → 1440), or null. */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (minutes === 1440) return "24:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A shift whose end is not after its start crosses midnight. */
export function crossesMidnight(s: Pick<Shift, "start_time" | "end_time">) {
  const a = timeToMinutes(s.start_time);
  const b = timeToMinutes(s.end_time);
  return a !== null && b !== null && b <= a;
}

/**
 * The end of the last active shift that crosses midnight (never after 09:00:
 * later is "unclear"), or null when there is none.
 */
export function crossingCutoff(shifts: readonly Shift[]): number | null {
  let best: number | null = null;
  for (const s of shifts) {
    if (!s.active || !crossesMidnight(s)) continue;
    const end = timeToMinutes(s.end_time);
    if (end === null || end <= 0 || end > MAX_CUTOFF_MINUTES) continue;
    if (best === null || end > best) best = end;
  }
  return best;
}

/** The cutoff, in minutes after midnight, of a restaurant with these shifts. */
export function cutoffMinutes(shifts: readonly Shift[]): number {
  return crossingCutoff(shifts) ?? DEFAULT_CUTOFF_MINUTES;
}

function interval(s: Shift): [number, number] | null {
  const a = timeToMinutes(s.start_time);
  let b = timeToMinutes(s.end_time);
  if (a === null || b === null || a === b) return null;
  if (b <= a) b += 1440;
  return [a, b];
}

/** Do two shifts share any clock time (modulo 24 h)? */
export function shiftsOverlapInTime(a: Shift, b: Shift): boolean {
  const x = interval(a);
  const y = interval(b);
  if (!x || !y) return false;
  return [-1440, 0, 1440].some((k) => x[0] < y[1] + k && y[0] + k < x[1]);
}

export type ShiftsCheck = { ok: true } | { ok: false; message: string };

/** The same rules (and Spanish messages) as restaurant_shifts_save. */
export function validateShifts(shifts: readonly Shift[]): ShiftsCheck {
  if (shifts.length > 12) {
    return {
      ok: false,
      message: "Los turnos deben ser una lista de 12 como máximo.",
    };
  }
  for (const s of shifts) {
    const name = s.name.trim();
    if (name.length === 0 || name.length > 40) {
      return {
        ok: false,
        message: "Cada turno necesita un nombre (hasta 40 letras).",
      };
    }
    const a = timeToMinutes(s.start_time);
    const b = timeToMinutes(s.end_time);
    if (a === null || b === null) {
      return {
        ok: false,
        message: `El turno «${name}» tiene una hora no válida.`,
      };
    }
    if (a === b) {
      return {
        ok: false,
        message: `El turno «${name}» necesita una hora de inicio y otra de fin distintas.`,
      };
    }
    if (
      s.weekdays.length === 0 ||
      s.weekdays.some((d) => !ALL_WEEKDAYS.includes(d))
    ) {
      return {
        ok: false,
        message: `El turno «${name}» necesita al menos un día de la semana.`,
      };
    }
  }
  const active = shifts.filter((s) => s.active);
  for (let i = 0; i < active.length; i += 1)
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (
        a.weekdays.some((d) => b.weekdays.includes(d)) &&
        shiftsOverlapInTime(a, b)
      ) {
        return {
          ok: false,
          message: `Los turnos «${a.name.trim()}» y «${b.name.trim()}» se solapan el mismo día. Ajusta las horas.`,
        };
      }
    }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The business moment of an order
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface BusinessMoment {
  /** Business date, YYYY-MM-DD. */
  date: string;
  /** Business weekday, 1 = lunes … 7 = domingo. */
  isoWeekday: number;
  /** Business weekday, 0 = domingo … 6 = sábado (the app's usual index). */
  weekday: number;
  /** The REAL local clock hour; null when the order has no timestamp. */
  hour: number | null;
  /** Local clock minutes after midnight; null without a timestamp. */
  clockMinutes: number | null;
}

function dateParts(ms: number) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  const dow = d.getUTCDay();
  return {
    date: `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`,
    weekday: dow,
    isoWeekday: dow === 0 ? 7 : dow,
  };
}

/**
 * The business date / weekday / clock of a POS line. With a timestamp:
 * local time − cutoff. Without one the line keeps its sale_date (already
 * local), exactly as the SQL does.
 */
export function businessMoment(
  row: { sale_date: string; order_placed_at?: string | null },
  timezone: string,
  cutoffMin: number
): BusinessMoment {
  const tz = normalizeTimezone(timezone) ?? "UTC";
  if (row.order_placed_at) {
    const instant = new Date(row.order_placed_at);
    if (!Number.isNaN(instant.getTime())) {
      const get = (type: string) =>
        formatterFor(tz)
          .formatToParts(instant)
          .find((p) => p.type === type)?.value ?? "0";
      let hour = Number(get("hour"));
      if (hour === 24) hour = 0;
      const minute = Number(get("minute"));
      const localMs = Date.UTC(
        Number(get("year")),
        Number(get("month")) - 1,
        Number(get("day")),
        hour,
        minute
      );
      const p = dateParts(localMs - cutoffMin * 60_000);
      return { ...p, hour, clockMinutes: hour * 60 + minute };
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.sale_date);
  if (!m) {
    return {
      date: row.sale_date,
      isoWeekday: 1,
      weekday: 1,
      hour: null,
      clockMinutes: null,
    };
  }
  const p = dateParts(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  );
  return {
    ...p,
    date: row.sale_date.slice(0, 10),
    hour: null,
    clockMinutes: null,
  };
}

/** The active shift of an order (by LOCAL clock time and BUSINESS weekday), or null. */
export function assignShift<T extends Shift>(
  shifts: readonly T[],
  clockMinutes: number | null,
  isoWeekday: number
): T | null {
  if (clockMinutes === null) return null;
  const ordered = [...shifts].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  for (const s of ordered) {
    if (!s.active || !s.weekdays.includes(isoWeekday)) continue;
    const a = timeToMinutes(s.start_time);
    const b = timeToMinutes(s.end_time);
    if (a === null || b === null || a === b) continue;
    const inside =
      a < b
        ? clockMinutes >= a && clockMinutes < b
        : clockMinutes >= a || clockMinutes < b;
    if (inside) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the app carries around
// ---------------------------------------------------------------------------

export interface BusinessDayConfig {
  /** Migration 054 applied (restaurant_shifts readable). */
  available: boolean;
  shiftsByLocation: ReadonlyMap<string, readonly Shift[]>;
  cutoffByLocation: ReadonlyMap<string, number>;
  /** Cutoff of a line with no (known) restaurant. */
  defaultCutoff: number;
}

/** Before 054: today's behaviour. */
export const NO_BUSINESS_DAY: BusinessDayConfig = {
  available: false,
  shiftsByLocation: new Map(),
  cutoffByLocation: new Map(),
  defaultCutoff: 0,
};

export function cutoffFor(
  config: BusinessDayConfig,
  locationId: string | null | undefined
): number {
  if (!config.available) return 0;
  return (
    (locationId ? config.cutoffByLocation.get(locationId) : undefined) ??
    config.defaultCutoff
  );
}

export function buildBusinessDayConfig(
  shiftRows: ReadonlyArray<Shift & { restaurant_id: string }>,
  restaurantIds: readonly string[]
): BusinessDayConfig {
  const shifts = new Map<string, Shift[]>();
  for (const s of shiftRows) {
    const list = shifts.get(s.restaurant_id) ?? [];
    list.push(s);
    shifts.set(s.restaurant_id, list);
  }
  const cutoffs = new Map<string, number>();
  for (const id of restaurantIds)
    cutoffs.set(id, cutoffMinutes(shifts.get(id) ?? []));
  return {
    available: true,
    shiftsByLocation: shifts,
    cutoffByLocation: cutoffs,
    defaultCutoff: DEFAULT_CUTOFF_MINUTES,
  };
}

/** The shifts of a restaurant, or — for a view over several — none (ambiguous). */
export function activeShiftCount(shifts: readonly Shift[]): number {
  return shifts.filter((s) => s.active).length;
}
