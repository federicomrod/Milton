// lib/restaurant/merma-format.ts
//
// Plain helpers shared by server and client code for the «merma» values
// (kitchen buffer and ingredient yield). Not a "use client" file on purpose:
// server components call these.

import { formatTypedNumber } from "@/lib/restaurant/locale-number";
import type { PreferredLanguage } from "@/lib/restaurant/language";

/** The id of the Costos «Merma de cocina» card (Configuración links to it). */
export const BUFFER_ANCHOR = "merma-cocina";

/** 5 → «5 %» (es, de) or «5%» (en); decimals in the language's format. */
export function pctText(n: number, lang: PreferredLanguage): string {
  const v = formatTypedNumber(n, lang);
  return lang === "en" ? `${v}%` : `${v} %`;
}
