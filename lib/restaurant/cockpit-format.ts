// lib/restaurant/cockpit-format.ts
//
// Language-aware date and money labels shared by the Cockpit and Ventas
// screens. Spanish keeps the compact hand-written forms («jue 30 jul»); English
// and German go through Intl with localeFor(lang), so German reads «30. Juli»
// / «29. Okt.» and 1.234,50.

import { formatCompactDateRange } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";
import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";

const WEEKDAYS_SHORT_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function utcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
  );
}

/** «jue» / «Do.»: the short weekday of a day, first weekday = Monday in `weekdayIndex`. */
export function weekdayShort(
  weekdayMon0: number,
  lang: PreferredLanguage
): string {
  if (lang === "es") return WEEKDAYS_SHORT_ES[weekdayMon0];
  // 2024-01-01 is a Monday.
  const d = new Date(Date.UTC(2024, 0, 1 + weekdayMon0));
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: "short",
    timeZone: "UTC",
  }).format(d);
}

/** «30 jul» (es) / «Jul 30» (en) / «30. Juli» (de). */
export function dayMonthLabel(ymd: string, lang: PreferredLanguage): string {
  const d = utcDate(ymd);
  if (!d) return ymd;
  if (lang === "es")
    return `${+ymd.slice(8)} ${MONTHS_SHORT_ES[+ymd.slice(5, 7) - 1]}`;
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/** «Jue 30 jul» with the weekday first. `lowerWeekday` gives «jue 30 jul» (Spanish only). */
export function dayLabel(
  ymd: string,
  lang: PreferredLanguage,
  opts?: { lowerWeekday?: boolean }
): string {
  const d = utcDate(ymd);
  if (!d) return ymd;
  const wd = weekdayShort((d.getUTCDay() + 6) % 7, lang);
  const weekday = opts?.lowerWeekday && lang === "es" ? wd.toLowerCase() : wd;
  return `${weekday} ${dayMonthLabel(ymd, lang)}`;
}

/** «25–31 jul 2026» / «28 jun – 4 jul 2026». */
export function rangeLabel(
  from: string,
  to: string,
  lang: PreferredLanguage
): string {
  if (lang !== "es") return formatCompactDateRange(from, to, localeFor(lang));
  const f = { d: +from.slice(8), m: +from.slice(5, 7), y: from.slice(0, 4) };
  const t = { d: +to.slice(8), m: +to.slice(5, 7), y: to.slice(0, 4) };
  const M = MONTHS_SHORT_ES;
  if (from === to) return `${t.d} ${M[t.m - 1]} ${t.y}`;
  if (f.m === t.m && f.y === t.y) return `${f.d}–${t.d} ${M[t.m - 1]} ${t.y}`;
  return `${f.d} ${M[f.m - 1]}${f.y === t.y ? "" : ` ${f.y}`} – ${t.d} ${M[t.m - 1]} ${t.y}`;
}

/** Currency with the narrow symbol in the language's locale (1.234,50 in German). */
export function formatMoney(
  amount: number,
  currency: string,
  lang: PreferredLanguage,
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 2;
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(localeFor(lang), {
      style: "currency",
      currency: safe,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${safe} ${amount.toFixed(decimals)}`;
  }
}

/**
 * Locale of a money amount. German always reads 1.234,50; Spanish and English
 * keep the currency-driven locale (USD as «$», MXN as «$»), as before.
 */
export function moneyLocale(currency: string, lang: PreferredLanguage): string {
  return lang === "de" ? localeFor("de") : localeForCurrency(currency);
}
