// R1-17b: small shared helpers of the Ventas › Detalle page. Spanish keeps its
// compact forms; every function takes the language for English and German.

import {
  dayLabel,
  formatMoney,
  rangeLabel,
  weekdayShort,
} from "@/lib/restaurant/cockpit-format";
import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";

export const WEEKDAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // ISO 1..7
export const WEEKDAYS_LONG = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

export const BLUE = "#1b40c8";

/** Short weekdays, Monday first. */
export function weekdaysShort(lang: PreferredLanguage): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayShort(i, lang));
}

/** Long weekdays, Monday first (lower case in Spanish, as before). */
export function weekdaysLong(lang: PreferredLanguage): string[] {
  if (lang === "es") return WEEKDAYS_LONG;
  const loc = localeFor(lang);
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + i))
    )
  );
}

export function moneyFmt(currency: string, lang: PreferredLanguage = "es") {
  return (n: number, decimals = 0) =>
    formatMoney(n, currency, lang, { decimals });
}

/** "jue 30 jul" */
export function dayLabelEs(
  ymd: string,
  lang: PreferredLanguage = "es"
): string {
  return dayLabel(ymd, lang, { lowerWeekday: true });
}

/** "25–31 jul 2026" / "28 jun – 4 jul 2026" */
export function rangeLabelEs(
  from: string,
  to: string,
  lang: PreferredLanguage = "es"
): string {
  return rangeLabel(from, to, lang);
}

/** "+18%" / "−42%" / "—" (no comparable period: never 0%). */
export function pctLabel(
  delta: number | null,
  digits = 0,
  lang: PreferredLanguage = "es"
): string {
  if (delta === null) return "—";
  const v =
    digits === 0
      ? Math.round(delta)
      : Math.round(delta * 10 ** digits) / 10 ** digits;
  if (v === 0) return lang === "de" ? "0 %" : "0%";
  const body = Math.abs(v).toLocaleString(localeFor(lang), {
    maximumFractionDigits: digits,
  });
  return `${v > 0 ? "+" : "−"}${body}${lang === "de" ? " %" : "%"}`;
}

export function hourLabel(h: number): string {
  return `${h}h`;
}

export { getDictionary };
