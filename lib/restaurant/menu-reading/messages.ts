// lib/restaurant/menu-reading/messages.ts
//
// The texts «Leer tu menú» shows (errors, reasons, summaries) in the person's
// language. Spanish stays the default; callers that know the language pass it.

import { fmt, getDictionary, type Dictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export type MenuMsgKey = keyof Dictionary["menu"]["groups"]["menuReading"];

export function menuMsg(
  lang: PreferredLanguage,
  key: MenuMsgKey,
  vars: Record<string, string | number> = {}
): string {
  return fmt(getDictionary(lang).menu.groups.menuReading[key], vars);
}
