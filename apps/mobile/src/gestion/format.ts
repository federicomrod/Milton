// Number, date and delta formatting for the Gestión screens (pure, tested).
// Money is only ever drawn from a number the server computed; a missing value
// (null, not finite) is never turned into 0: callers draw «Sin precio» or «—».

import type { Language } from "../i18n/strings";

const LOCALE: Record<Language, string> = {
  es: "es-MX",
  en: "en-US",
  de: "de-DE",
};

export const localeOf = (lang: Language) => LOCALE[lang] ?? LOCALE.es;

const SAFE_CURRENCY = /^[A-Z]{3}$/;

/**
 * The web's choice (localeForCurrency): German and English use their own
 * locale; Spanish uses es-MX only for MXN, else en-US, so USD reads «$1,235»
 * and not «USD 1,235».
 */
export function moneyLocale(currency: string, lang: Language): string {
  if (lang === "de" || lang === "en") return localeOf(lang);
  return currency === "MXN" ? "es-MX" : "en-US";
}

/** «$1,235» (no decimals, like the web). null or not finite -> «—». */
export function formatMoney(
  value: number | null | undefined,
  currency: string,
  lang: Language,
  decimals = 0
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const code = SAFE_CURRENCY.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(moneyLocale(code, lang), {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(localeOf(lang), {
      maximumFractionDigits: decimals,
    }).format(value);
  }
}

/** A plain count or quantity: 1,234 / 2.5. */
export function formatNumber(
  value: number | null | undefined,
  lang: Language,
  maxDecimals = 1
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(localeOf(lang), {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/** 0–1 -> «10 %» (a whole percent, like the web). */
export function formatFraction(
  value: number | null | undefined,
  lang: Language
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${formatNumber(value * 100, lang, 0)} %`;
}

/** A percent already in 0–100 (a delta, a share). */
export function formatPercent(
  value: number | null | undefined,
  lang: Language,
  maxDecimals = 0
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, lang, maxDecimals)} %`;
}

export interface Delta {
  /** «+12 %» / «-3 %»; null when there is nothing to compare. */
  text: string | null;
  /** Direction for the chip colour (mint up, rosa down, grey flat/unknown). */
  tone: "up" | "down" | "flat";
}

export function deltaOf(
  value: number | null | undefined,
  lang: Language
): Delta {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { text: null, tone: "flat" };
  }
  const rounded = Math.round(value);
  if (rounded === 0) return { text: "0 %", tone: "flat" };
  const sign = rounded > 0 ? "+" : "−";
  return {
    text: `${sign}${formatNumber(Math.abs(rounded), lang, 0)} %`,
    tone: rounded > 0 ? "up" : "down",
  };
}

const parts = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
};

/** «30 oct» / «Oct 30» / «30. Okt.» from YYYY-MM-DD (no timezone drift). */
export function formatDay(iso: string, lang: Language): string {
  const { y, m, d } = parts(iso);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(localeOf(lang), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatWeekday(iso: string, lang: Language): string {
  const { y, m, d } = parts(iso);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(localeOf(lang), {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** «octubre 2026» from YYYY-MM-01 or YYYY-MM. */
export function monthLabel(month: string, lang: Language): string {
  const { y, m } = parts(`${month.slice(0, 7)}-01`);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat(localeOf(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** «oct.» for a month bar (YYYY-MM). */
export function monthShort(month: string, lang: Language): string {
  const { y, m } = parts(`${month.slice(0, 7)}-01`);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat(localeOf(lang), {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The previous / next month start, clamped by the caller. */
export function shiftMonth(month: string, by: number): string {
  const { y, m } = parts(`${month.slice(0, 7)}-01`);
  const date = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Height of a bar (0–1) against the largest value; never negative. */
export function barRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/** First letters of a name or email, for the avatar. */
export function initials(nameOrEmail: string | null | undefined): string {
  const base = (nameOrEmail ?? "").split("@")[0].trim();
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "M";
  const first = words[0][0] ?? "";
  const second = words.length > 1 ? (words[1][0] ?? "") : "";
  return (first + second).toUpperCase();
}
