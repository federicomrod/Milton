// lib/restaurant/currency.ts
//
// Company-level currency is the single source of truth for create/upload
// defaults and for cockpit / Ask Milton money formatting.
//
// restaurant_locations has a `country` column but NO `currency` column
// (see supabase/migrations/001_baseline.sql). Do not read a location
// currency field — it is not in the real schema. This module derives
// currency at runtime and needs no migration.
//
// Resolution order:
//   1. Odoo-connected company: majority currency on synced POS rows
//      (those rows carry Odoo order.currency_id), then location country.
//   2. Otherwise: onboarding country via currencyForCountry()
//      (El Salvador → USD; Mexico → MXN only when the country is Mexico).
//   3. USD. MXN is never assumed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { currencyForCountry } from "@/lib/restaurant/onboarding-copy";

export const FALLBACK_CURRENCY = "USD";

export const CURRENCY_OPTIONS = ["USD", "MXN", "EUR"] as const;

const CURRENCY_RE = /^[A-Z]{3}$/;

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return CURRENCY_RE.test(trimmed) ? trimmed : null;
}

/** Valid 3-letter code, or USD. Never MXN unless the value itself is MXN. */
export function currencyOrFallback(value: unknown): string {
  return normalizeCurrency(value) ?? FALLBACK_CURRENCY;
}

export function localeForCurrency(currency: string): string {
  return currency === "MXN" ? "es-MX" : "en-US";
}

export function isSameCurrency(
  value: string | null | undefined,
  companyCurrency: string
): boolean {
  const normalized = normalizeCurrency(value);
  return normalized !== null && normalized === companyCurrency;
}

/**
 * Use an explicit valid code when the caller sent one; otherwise the
 * company currency. Callers that must reject mismatches should follow
 * this with `currencyMismatchReason`.
 */
export function resolveWriteCurrency(
  provided: unknown,
  companyCurrency: string
): string {
  return normalizeCurrency(provided) ?? companyCurrency;
}

export function currencyMismatchReason(
  rowCurrency: string,
  companyCurrency: string
): string | null {
  if (rowCurrency === companyCurrency) return null;
  return `Currency ${rowCurrency} does not match company currency ${companyCurrency}`;
}

export function majorityCurrency(
  values: Array<string | null | undefined>
): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const code = normalizeCurrency(value);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function currencyFromCountries(
  rows: Array<{ country?: string | null } | null> | null | undefined
): string | null {
  if (!rows) return null;
  for (const row of rows) {
    const country = typeof row?.country === "string" ? row.country.trim() : "";
    if (!country) continue;
    return currencyForCountry(country);
  }
  return null;
}

/**
 * Resolve the company's display and default currency.
 * Never assumes MXN — MXN is only returned when the country is Mexico or
 * synced POS rows actually carry MXN.
 */
export async function resolveCompanyCurrency(
  supabase: SupabaseClient,
  companyId: string
): Promise<string> {
  const empty = {
    data: null as unknown,
    error: null as { message?: string } | null,
  };
  const [odooRes, posRes, locRes] = await Promise.all([
    Promise.resolve()
      .then(() =>
        supabase
          .from("restaurant_pos_connections")
          .select("id, pos_source")
          .eq("company_id", companyId)
          .limit(1)
          .maybeSingle()
      )
      .catch((err: unknown) => ({
        ...empty,
        error: { message: err instanceof Error ? err.message : String(err) },
      })),
    Promise.resolve()
      .then(() =>
        supabase
          .from("pos_sales_items")
          .select("currency")
          .eq("company_id", companyId)
          .not("currency", "is", null)
          .limit(50)
      )
      .catch((err: unknown) => ({
        ...empty,
        error: { message: err instanceof Error ? err.message : String(err) },
      })),
    Promise.resolve()
      .then(() =>
        supabase
          .from("restaurant_locations")
          .select("country")
          .eq("company_id", companyId)
      )
      .catch((err: unknown) => ({
        ...empty,
        error: { message: err instanceof Error ? err.message : String(err) },
      })),
  ]);

  if (odooRes.error) {
    console.error(
      "[currency] restaurant_pos_connections lookup:",
      odooRes.error.message
    );
  }
  if (posRes.error) {
    console.error("[currency] pos_sales_items lookup:", posRes.error.message);
  }
  if (locRes.error) {
    console.error(
      "[currency] restaurant_locations lookup:",
      locRes.error.message
    );
  }

  const posCurrency = majorityCurrency(
    ((posRes.data ?? []) as { currency?: string | null }[]).map(
      (r) => r.currency
    )
  );
  const countryCurrency = currencyFromCountries(
    (locRes.data ?? []) as { country?: string | null }[]
  );
  const connection = odooRes.data as {
    id?: string;
    pos_source?: string | null;
  } | null;
  const hasOdoo =
    !!connection &&
    (connection.pos_source === "odoo" || connection.pos_source == null);

  if (hasOdoo) {
    return posCurrency ?? countryCurrency ?? FALLBACK_CURRENCY;
  }
  return countryCurrency ?? posCurrency ?? FALLBACK_CURRENCY;
}
