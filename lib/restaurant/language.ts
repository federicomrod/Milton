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

export type PreferredLanguage = "en" | "es" | "de";

export const DEFAULT_LANGUAGE: PreferredLanguage = "en";

/**
 * Restaurant cockpit chrome (sidebar, header, Sync, empty states) defaults
 * to Spanish when `companies.preferred_language` is unset. Emails, Telegram
 * and briefings still use DEFAULT_LANGUAGE — this is not a migration and
 * does not overwrite a stored company preference.
 */
export const RESTAURANT_COCKPIT_DEFAULT_LANGUAGE: PreferredLanguage = "es";

export interface LanguageOption {
  value: PreferredLanguage;
  label: string;
}

/** English first — matches DEFAULT_LANGUAGE. The restaurant cockpit UI defaults to Spanish separately. */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
];

/** Intl locale for every date and number format of a language. */
export function localeFor(lang: PreferredLanguage): string {
  if (lang === "de") return "de-DE";
  if (lang === "en") return "en-US";
  return "es-MX";
}

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
  return value === "en" || value === "es" || value === "de" ? value : null;
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
 * Language for R1 restaurant cockpit surfaces (shell, tabs, insights,
 * Ask Milton, briefing generation used by those surfaces).
 *
 * Honours a stored "en" | "es" | "de"; falls back to Spanish
 * (RESTAURANT_COCKPIT_DEFAULT_LANGUAGE) only when the value is unset or
 * invalid. Emails and Telegram go through resolvePreferredLanguage.
 */
export function resolveRestaurantCockpitLanguage(
  value?: unknown
): PreferredLanguage {
  return (
    normalizePreferredLanguage(value) ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
  );
}

/**
 * Temporary wrapper for call sites not yet moved to the lib/i18n
 * dictionaries. All three languages are required; new code must use
 * `getDictionary` / `useT` instead.
 */
export function t(
  lang: PreferredLanguage,
  en: string,
  es: string,
  de: string
): string {
  return lang === "de" ? de : lang === "es" ? es : en;
}
