// lib/restaurant/email/scheduler.ts
//
// Automatic Email Briefing Scheduler v1 — pure due-decision logic, no I/O.
// The Vercel Cron route (app/api/cron/briefing-email/route.ts) is a thin
// shell around evaluateDue() below: it fetches candidate companies via the
// service-role client, calls evaluateDue() for each, and only for those
// marked due does it run the exact same pipeline already validated for
// manual test-sends (generateBriefing() -> renderBriefingEmail() ->
// sendBriefingEmail()) — no second briefing/email implementation.
//
// Delivery time is fixed at 07:00 in the company's own configured,
// EXPLICIT IANA timezone (companies.briefing_email_timezone) — never
// server/Vercel time, never guessed, never silently defaulted (an
// invalid/missing timezone simply never becomes due — see
// resolveTimezoneForCadence()'s equivalent rule in preferences.ts for
// where that explicitness was first enforced, at save time). DST is
// handled automatically by Intl's own IANA timezone database, since
// "local hour" is always recomputed fresh from the zone name for the
// exact instant being checked — never a hand-maintained UTC-offset table.

import { timingSafeEqual } from "crypto";
import type { BriefingEmailCadence } from "@/lib/restaurant/email/preferences";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";

export const SEND_HOUR_LOCAL = 7; // 07:00–07:59 local, fixed for V1 (no configurable send time)

export interface LocalMoment {
  /** "YYYY-MM-DD" in the target timezone — the local calendar date. */
  dateKey: string;
  /** 0-23, the local hour. */
  hour: number;
  /** 0 (Sunday) .. 6 (Saturday), local weekday — same convention as
   *  companies.briefing_email_weekday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolves the wall-clock date/hour/weekday for `instant` in `timezone`,
 * using Intl's own IANA tz database. Assumes `timezone` has already been
 * validated (normalizeTimezone()) — callers must not pass an unchecked
 * value, since Intl throws for an unrecognized zone name.
 */
export function getLocalMoment(instant: Date, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Some ICU builds render local midnight as "24" with hour12:false —
  // normalize to 0 so an hour comparison never silently misses it.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const weekdayShort = get("weekday");

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    weekday: WEEKDAY_INDEX[weekdayShort] ?? 0,
  };
}

/**
 * True if `lastSentAtIso` (an absolute instant, or null/malformed) falls
 * on the same LOCAL calendar date as `currentDateKey`. This single check
 * covers both Daily ("already sent today") and Weekly ("already sent for
 * this week's scheduled day") — weekly only ever becomes due on the one
 * matching local weekday in the first place, so "already sent on this
 * local date" is exactly "already sent for this occurrence" either way.
 */
function alreadySentForLocalDate(
  lastSentAtIso: string | null,
  currentDateKey: string,
  timezone: string
): boolean {
  if (!lastSentAtIso) return false;
  const lastSent = new Date(lastSentAtIso);
  if (Number.isNaN(lastSent.getTime())) return false;
  return getLocalMoment(lastSent, timezone).dateKey === currentDateKey;
}

export interface CompanyScheduleInput {
  cadence: BriefingEmailCadence;
  /** Already validated (e.g. via normalizeEmail()) by the caller — null
   *  here means "no usable recipient", full stop. */
  recipient: string | null;
  /** Raw stored value — validated internally via normalizeTimezone() so
   *  an invalid/missing zone fails closed rather than assuming UTC. */
  timezone: string | null;
  /** 0 (Sunday) .. 6 (Saturday) — only consulted when cadence is "weekly". */
  weekday: number;
  lastSentAt: string | null;
}

export type DueReason =
  | "off"
  | "missing_recipient"
  | "invalid_timezone"
  | "wrong_hour"
  | "wrong_weekday"
  | "already_sent";

export type DueResult = { due: true } | { due: false; reason: DueReason };

/**
 * Decides whether ONE company is due for an automatic send at `nowUtc`.
 * Fails closed: cadence "off", a missing recipient, or an invalid/missing
 * timezone all resolve to "not due" — never a generous default.
 */
export function evaluateDue(
  company: CompanyScheduleInput,
  nowUtc: Date
): DueResult {
  if (company.cadence === "off") {
    return { due: false, reason: "off" };
  }
  if (!company.recipient) {
    return { due: false, reason: "missing_recipient" };
  }
  const timezone = normalizeTimezone(company.timezone);
  if (!timezone) {
    return { due: false, reason: "invalid_timezone" };
  }

  const local = getLocalMoment(nowUtc, timezone);
  if (local.hour !== SEND_HOUR_LOCAL) {
    return { due: false, reason: "wrong_hour" };
  }
  if (company.cadence === "weekly" && local.weekday !== company.weekday) {
    return { due: false, reason: "wrong_weekday" };
  }
  if (alreadySentForLocalDate(company.lastSentAt, local.dateKey, timezone)) {
    return { due: false, reason: "already_sent" };
  }
  return { due: true };
}

// ---------------------------------------------------------------------------
// Cron request authentication
// ---------------------------------------------------------------------------

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies Vercel's own cron-authentication convention: when CRON_SECRET
 * is set, Vercel calls the endpoint with `Authorization: Bearer
 * <CRON_SECRET>`. Fails closed — a missing/unset secret or a missing
 * header is always rejected, never treated as "no auth required".
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  cronSecret: string | undefined
): boolean {
  if (!cronSecret || !authorizationHeader) return false;
  return safeEqual(authorizationHeader, `Bearer ${cronSecret}`);
}
