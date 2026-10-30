// lib/restaurant/costs-format.ts
//
// Pure money / percent formatting for Costos. Deliberately NOT a "use client"
// module and free of React: server components (the Costos page) call these
// functions, and a server file cannot call a function exported from a client
// module. Null / NaN is «—», an invalid currency is USD, MXN is never assumed.

import { localeForCurrency } from "@/lib/restaurant/currency";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function safeCurrency(currency: string | null | undefined): string {
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

export function formatMoney(
  n: number | null,
  currency: string | null | undefined,
  lang?: PreferredLanguage
): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const safe = safeCurrency(currency);
  return new Intl.NumberFormat(localeForCurrency(safe, lang), {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatUnitPrice(
  n: number,
  unit: string,
  currency: string,
  lang?: PreferredLanguage
): string {
  if (!Number.isFinite(n) || n <= 0)
    return t(lang ?? "es", "No price", "Sin precio", "Kein Preis");
  const safe = safeCurrency(currency);
  return (
    new Intl.NumberFormat(localeForCurrency(safe, lang), {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(n) + ` / ${unit}`
  );
}

export function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Invoice total text: a missing (or empty) total is «Sin precio», never $0. */
export function invoiceTotalText(
  total: number | null | undefined,
  currency: string,
  lang?: PreferredLanguage
): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0)
    return t(lang ?? "es", "No price", "Sin precio", "Kein Preis");
  return formatMoney(total, currency, lang);
}
