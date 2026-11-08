// lib/restaurant/push/prefs-input.ts
//
// Validates what the phone sends for its notification choices. Anything not
// valid is refused whole (never half-saved).

import {
  validExpoToken,
  validHour,
  validTimezone,
} from "@/lib/restaurant/push/policy";

export interface PrefsPatch {
  daily_enabled?: boolean;
  critical_enabled?: boolean;
  daily_hour?: number;
  quiet_start?: number;
  quiet_end?: number;
  timezone?: string;
}

export function parsePrefsPatch(
  body: Record<string, unknown>
): PrefsPatch | null {
  const out: PrefsPatch = {};
  if ("dailyEnabled" in body) {
    if (typeof body.dailyEnabled !== "boolean") return null;
    out.daily_enabled = body.dailyEnabled;
  }
  if ("criticalEnabled" in body) {
    if (typeof body.criticalEnabled !== "boolean") return null;
    out.critical_enabled = body.criticalEnabled;
  }
  for (const [key, col] of [
    ["dailyHour", "daily_hour"],
    ["quietStart", "quiet_start"],
    ["quietEnd", "quiet_end"],
  ] as const) {
    if (key in body) {
      if (!validHour(body[key])) return null;
      out[col] = body[key] as number;
    }
  }
  if ("timezone" in body) {
    if (!validTimezone(body.timezone)) return null;
    out.timezone = body.timezone as string;
  }
  return out;
}

export function parseToken(body: Record<string, unknown>): string | null {
  return validExpoToken(body.token) ? body.token : null;
}
