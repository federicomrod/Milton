// lib/restaurant/language.ts
//
// Milton Language Foundation v1 — the single centralized place for
// language-preference types, options, and helpers. Every feature that
// needs to know or express the company's preferred language (onboarding,
// Ask Milton, executive briefings, and — later — Telegram, photo/voice
// workflows, and any UI localization) imports from here rather than
// scattering `"en"` / `"es"` string checks throughout the code.
//
// V1 is a company-level preference only (see restaurant-context-server.ts
// for the unrelated, per-restaurant-location concept introduced by
// Multi-Restaurant UX v1 — preferred_language deliberately does NOT live
// there; it applies to every restaurant under a company).
//
// Nothing in this file does I/O — pure constants, types, and functions,
// safe to import from server and client code alike.

export type PreferredLanguage = "en" | "es";

export const DEFAULT_LANGUAGE: PreferredLanguage = "en";

export interface LanguageOption {
  value: PreferredLanguage;
  label: string;
}

/** English first — matches DEFAULT_LANGUAGE and today's only supported UI language. */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

/**
 * Countries (by lib/restaurant/onboarding-copy.ts's COUNTRY_OPTIONS code)
 * where Spanish is the sensible onboarding default. Every other
 * currently-supported country defaults to English. This is only ever a
 * DEFAULT — onboarding always lets the user override it (see
 * RestaurantOnboardingWizard.tsx).
 */
const SPANISH_DEFAULT_COUNTRY_CODES = new Set([
  "MX", // Mexico
  "SV", // El Salvador
  "GT", // Guatemala
  "AR", // Argentina
  "CL", // Chile
  "CO", // Colombia
  "ES", // Spain
  "PE", // Peru
]);

/**
 * Pure — no I/O, directly unit-testable. Returns the intelligent default
 * for a given country code; always overridable by the user.
 */
export function defaultLanguageForCountry(
  countryCode: string | null | undefined
): PreferredLanguage {
  if (!countryCode) return DEFAULT_LANGUAGE;
  return SPANISH_DEFAULT_COUNTRY_CODES.has(countryCode) ? "es" : "en";
}

/**
 * Pure — no I/O, directly unit-testable. Encapsulates onboarding's "smart
 * default, always overridable" rule for language selection: once the user
 * has explicitly picked a language (`languageTouched`), further country
 * changes must never reset their choice; only while untouched does the
 * country drive the default. See RestaurantOnboardingWizard.tsx.
 */
export function nextLanguageOnCountryChange(
  countryCode: string | null | undefined,
  languageTouched: boolean,
  currentLanguage: PreferredLanguage | null
): PreferredLanguage {
  if (languageTouched && currentLanguage) return currentLanguage;
  return defaultLanguageForCountry(countryCode);
}

/**
 * Server-side validation — the only guard against a malformed payload
 * (the persisted column carries no CHECK constraint, same rationale as
 * lib/restaurant/onboarding-copy.ts's normalize* functions). Accepts
 * `unknown` (raw JSON body input, or a raw DB value) and returns a known-
 * good value or null — never throws.
 */
export function normalizePreferredLanguage(
  value: unknown
): PreferredLanguage | null {
  return value === "en" || value === "es" ? value : null;
}

/**
 * Reads a preferred-language value coming back from the database (or any
 * other untrusted source) and always returns a valid language — falling
 * back to DEFAULT_LANGUAGE for null/invalid input. Use this (rather than
 * normalizePreferredLanguage) wherever a definite language is required to
 * proceed, e.g. building an AI prompt.
 */
export function resolvePreferredLanguage(value: unknown): PreferredLanguage {
  return normalizePreferredLanguage(value) ?? DEFAULT_LANGUAGE;
}

/**
 * Picks between an English and a Spanish string based on `lang`. The
 * small, central primitive every deterministic/fallback text builder uses
 * instead of ad hoc `lang === "es" ? ... : ...` checks scattered around —
 * see briefing-prompt.ts and ask-milton-prompt.ts.
 */
export function t(lang: PreferredLanguage, en: string, es: string): string {
  return lang === "es" ? es : en;
}
