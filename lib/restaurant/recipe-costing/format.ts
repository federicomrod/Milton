import { fmt, getDictionary } from "@/lib/i18n";
import {
  localeFor,
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function shareToPct(share: number): number {
  return round1(share * 100);
}

export function formatMoneyEs(
  amount: number,
  currency = "USD",
  opts?: { decimals?: number },
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
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

export function formatPctLabel(pct: number): string {
  const rounded = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${rounded}%`;
}

export function pendingCostLabel(): "Pendiente";
export function pendingCostLabel(lang: PreferredLanguage): string;
export function pendingCostLabel(
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): string {
  return getDictionary(lang).menu.workspace.format.pending;
}

/** A line that HAS a price, but in a unit the line's unit cannot be read in. */
export const UNIT_MISMATCH_LABEL = "Unidad distinta";
export function unitMismatchLabel(
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): string {
  return getDictionary(lang).menu.workspace.format.unitMismatch;
}
export function unitMismatchHint(
  priceUnit: string,
  lineUnit: string,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): string {
  return fmt(getDictionary(lang).menu.workspace.format.unitMismatchHint, {
    priceUnit,
    lineUnit,
  });
}

export function lineCostDisplay(input: {
  pending?: boolean;
  unit_cost?: number | null;
  currency?: string;
  lang?: PreferredLanguage;
}): { label: string; amount: number | null } {
  // A confirmed $0 (water) is a price; only a missing one is Pendiente.
  if (input.pending || input.unit_cost == null || input.unit_cost < 0) {
    return { label: pendingCostLabel(input.lang ?? "es"), amount: null };
  }
  return {
    label: formatMoneyEs(
      input.unit_cost,
      input.currency,
      undefined,
      input.lang
    ),
    amount: input.unit_cost,
  };
}
