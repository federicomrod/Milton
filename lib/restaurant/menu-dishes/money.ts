// lib/restaurant/menu-dishes/money.ts
//
// Currency text for the Menú screens in the person's language. Spanish is
// exactly formatMoneyEs (es-MX); English and German use their own locale.
// Same digits and symbol rules, only the locale changes.

import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";

export function formatMoneyLocale(
  amount: number,
  currency = "USD",
  lang: PreferredLanguage = "es",
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
 * Locale for the Menú money in a language. Spanish keeps the screen's
 * long-standing rule (MXN reads as es-MX, any other currency as en-US);
 * English and German always use their own locale.
 */
export function moneyLocaleFor(
  lang: PreferredLanguage,
  currency: string
): string {
  if (lang === "es") return currency === "MXN" ? "es-MX" : "en-US";
  return localeFor(lang);
}
