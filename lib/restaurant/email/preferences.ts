// lib/restaurant/email/preferences.ts
//
// Email Briefing Extension v1 — pure validation for company-level email
// delivery preferences (migration 018's companies.briefing_email_* columns).
// No I/O — every function here accepts `unknown` (raw JSON body input, or
// a raw DB value) and returns a known-good value or null, same convention
// as lib/restaurant/language.ts's normalizePreferredLanguage(). These are
// the ONLY guard against a malformed payload, since the columns carry no
// CHECK constraint.

export type BriefingEmailCadence = "off" | "daily" | "weekly";

export const DEFAULT_CADENCE: BriefingEmailCadence = "off";
export const DEFAULT_WEEKDAY = 1; // Monday
export const DEFAULT_TIMEZONE = "UTC";

export function normalizeCadence(value: unknown): BriefingEmailCadence | null {
  return value === "off" || value === "daily" || value === "weekly"
    ? value
    : null;
}

export function resolveCadence(value: unknown): BriefingEmailCadence {
  return normalizeCadence(value) ?? DEFAULT_CADENCE;
}

// Deliberately simple — matches the email-format checks already used
// elsewhere in this codebase's onboarding forms; not a full RFC 5322
// validator (this project doesn't need one, and a stricter check would
// only reject real addresses it can't parse).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical limit

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

export function normalizeWeekday(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 6 ? value : null;
}

export function resolveWeekday(value: unknown): number {
  return normalizeWeekday(value) ?? DEFAULT_WEEKDAY;
}

/**
 * Validates an IANA timezone name by asking Intl to actually resolve it —
 * the only reliable way to check without hand-maintaining a zone list.
 * Throws RangeError for anything Intl doesn't recognize.
 */
export function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

export function resolveTimezone(value: unknown): string {
  return normalizeTimezone(value) ?? DEFAULT_TIMEZONE;
}

export type TimezoneResolution = { ok: true; timezone: string } | { ok: false };

/**
 * Adjustment (approved architecture): never let Daily/Weekly delivery be
 * enabled with an accidentally implicit timezone. If `cadence` is "off",
 * the timezone genuinely doesn't matter — any input (or none) resolves
 * safely via resolveTimezone()'s UTC fallback, which only exists for
 * migration/display safety, never as a scheduling decision. If `cadence`
 * is "daily" or "weekly", the caller MUST have supplied a valid, explicit
 * IANA timezone — resolveTimezone()'s fallback is deliberately NOT used
 * here, so a missing/invalid value fails closed instead of silently
 * becoming UTC.
 */
export function resolveTimezoneForCadence(
  cadence: BriefingEmailCadence,
  value: unknown
): TimezoneResolution {
  if (cadence === "off") {
    return { ok: true, timezone: resolveTimezone(value) };
  }
  const explicit = normalizeTimezone(value);
  return explicit ? { ok: true, timezone: explicit } : { ok: false };
}
