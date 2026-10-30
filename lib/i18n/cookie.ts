// lib/i18n/cookie.ts — the `milton_lang` cookie, browser side.
// The server reads it through lib/restaurant/request-lang.ts.

import type { PreferredLanguage } from "@/lib/restaurant/language";

export const LANGUAGE_COOKIE = "milton_lang";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Browser only: remembers the chosen language for a year. */
export function setLanguageCookie(lang: PreferredLanguage): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; samesite=lax`;
}
