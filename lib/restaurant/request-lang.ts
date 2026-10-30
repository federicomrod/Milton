// lib/restaurant/request-lang.ts
//
// Language for responses that have no company yet (signed-out API errors,
// pre-login pages): the `milton_lang` cookie, else Accept-Language
// (de / en / es), else Spanish. Never throws.

import { cookies, headers } from "next/headers";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export const LANG_COOKIE = "milton_lang";

function asLanguage(
  value: string | null | undefined
): PreferredLanguage | null {
  const v = value?.trim().toLowerCase().slice(0, 2);
  return v === "de" || v === "en" || v === "es" ? v : null;
}

/** First supported language in an Accept-Language header, by listed order. */
export function languageFromAcceptHeader(
  header: string | null | undefined
): PreferredLanguage | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag, weight } of ranked) {
    if (weight <= 0) continue;
    const lang = asLanguage(tag);
    if (lang) return lang;
  }
  return null;
}

export async function requestLanguage(): Promise<PreferredLanguage> {
  try {
    const fromCookie = asLanguage((await cookies()).get(LANG_COOKIE)?.value);
    if (fromCookie) return fromCookie;
    const fromHeader = languageFromAcceptHeader(
      (await headers()).get("accept-language")
    );
    if (fromHeader) return fromHeader;
  } catch {
    // outside a request scope
  }
  return RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
}
