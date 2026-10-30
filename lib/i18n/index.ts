// lib/i18n/index.ts — server-safe entry (no React). For client components
// use `useT()` from "@/lib/i18n/client".

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { localeFor } from "@/lib/restaurant/language";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import type { Dictionary } from "./types";

export type { Dictionary } from "./types";
export { localeFor };

const DICTIONARIES: Record<PreferredLanguage, Dictionary> = { es, en, de };

export function getDictionary(lang: PreferredLanguage): Dictionary {
  return DICTIONARIES[lang] ?? DICTIONARIES.es;
}

/** Fills `{name}` placeholders. A missing variable is left as written. */
export function fmt(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m
  );
}
