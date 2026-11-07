// lib/restaurant/push/policy.ts
//
// Pure rules of the manager notifications: quiet hours, local day, the daily
// cap, dedupe keys and who may be sent what. No I/O here, so every rule is
// tested without a database or a phone.

export type PushCategory = "daily" | "critical";

export interface PushPrefs {
  timezone: string;
  dailyEnabled: boolean;
  criticalEnabled: boolean;
  /** Local hour 0-23 the daily summary goes out. */
  dailyHour: number;
  quietStart: number;
  quietEnd: number;
}

/** At most this many notifications per person per local day. */
export const DAILY_CAP = 3;

export const DEFAULT_PREFS: PushPrefs = {
  timezone: "UTC",
  dailyEnabled: true,
  criticalEnabled: true,
  dailyHour: 8,
  quietStart: 22,
  quietEnd: 7,
};

/** Local calendar date (YYYY-MM-DD) and hour (0-23) in an IANA timezone. */
export function localParts(
  now: Date,
  timezone: string
): { date: string; hour: number } {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
  };
}

/** Quiet hours may wrap midnight (22 → 7). start === end means no quiet hours. */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

export type Decision =
  | { send: true }
  | {
      send: false;
      why: "disabled" | "quiet" | "not_time" | "cap" | "duplicate";
    };

export function decide(args: {
  category: PushCategory;
  now: Date;
  prefs: PushPrefs;
  /** Notifications already recorded for this person today (local day). */
  sentToday: number;
  /** dedupe_key already in the log. */
  duplicate: boolean;
}): Decision {
  const { category, prefs } = args;
  if (category === "daily" && !prefs.dailyEnabled)
    return { send: false, why: "disabled" };
  if (category === "critical" && !prefs.criticalEnabled)
    return { send: false, why: "disabled" };
  if (args.duplicate) return { send: false, why: "duplicate" };
  const { hour } = localParts(args.now, prefs.timezone);
  if (isQuietHour(hour, prefs.quietStart, prefs.quietEnd)) {
    return { send: false, why: "quiet" };
  }
  // The daily summary goes out in its own hour (the sender runs hourly).
  if (category === "daily" && hour !== prefs.dailyHour) {
    return { send: false, why: "not_time" };
  }
  if (args.sentToday >= DAILY_CAP) return { send: false, why: "cap" };
  return { send: true };
}

/** One daily summary per person per local day. */
export function dailyKey(userId: string, localDate: string): string {
  return `daily:${userId}:${localDate}`;
}

/**
 * Invoices waiting for approval: one alert per set of invoices, however often
 * the check runs (the key changes only when the set changes).
 */
export function pendingInvoicesKey(
  userId: string,
  invoiceIds: string[]
): string {
  return `critical:invoices_pending:${userId}:${[...invoiceIds].sort().join(",")}`;
}

export function validHour(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
}

export function validTimezone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Expo tokens look like ExponentPushToken[xxxx]; anything else is refused. */
export function validExpoToken(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 200 &&
    /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(v)
  );
}

/** Screens a notification may open. Anything else falls back to Inicio. */
export const PUSH_SCREENS = [
  "inicio",
  "costos",
  "ventas",
  "rentabilidad",
] as const;
export type PushScreen = (typeof PUSH_SCREENS)[number];
