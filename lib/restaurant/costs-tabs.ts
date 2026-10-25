// lib/restaurant/costs-tabs.ts
//
// Costos (R1-09b, A9/D6): three real tabs on one route —
// Cambios de precio (default), Compras (?tab=compras), Proveedores
// (?tab=proveedores). Pure helpers so tabs, redirects and the KPI math are
// unit-testable without React or Supabase.

import { COSTS_HREF } from "@/lib/restaurant/navigation";
import type { IngredientPriceTrendRow } from "@/lib/restaurant/profitability-server";

export type CostsTab = "precios" | "compras" | "proveedores";

export const COSTS_TABS: readonly CostsTab[] = [
  "precios",
  "compras",
  "proveedores",
] as const;

/** Anchor on the invoice entry cards inside Compras. */
export const INVOICE_UPLOAD_ANCHOR = "subir-factura";

export function parseCostsTab(raw: string | string[] | undefined): CostsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "compras" || value === "proveedores") return value;
  return "precios";
}

type Params = Record<string, string | string[] | undefined>;

/**
 * Costos href for a tab. `params` are carried along (location, period,
 * anything an old link had) except `tab`, which the tab itself sets.
 */
export function costsTabHref(
  tab: CostsTab,
  params: Params = {},
  hash?: string
): string {
  const next = new URLSearchParams();
  if (tab !== "precios") next.set("tab", tab);
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) next.append(key, v);
  }
  const query = next.toString();
  const path = query ? `${COSTS_HREF}?${query}` : COSTS_HREF;
  return hash ? `${path}#${hash}` : path;
}

/** "Subir factura" → Compras, at the invoice entry cards. */
export function invoiceUploadHref(params: Params = {}): string {
  return costsTabHref("compras", params, INVOICE_UPLOAD_ANCHOR);
}

/** Query param that opens one invoice's review in Compras (consumed once). */
export const INVOICE_REVIEW_PARAM = "factura";

/** Compras with the review panel of one invoice open. */
export function invoiceReviewHref(
  invoiceId: string,
  params: Params = {}
): string {
  const base = costsTabHref("compras", params);
  return `${base}${base.includes("?") ? "&" : "?"}${INVOICE_REVIEW_PARAM}=${encodeURIComponent(invoiceId)}`;
}

/** Only the shell params (restaurant + period) survive a tab switch. */
export function shellParamsOf(params: Params): Params {
  const out: Params = {};
  for (const key of ["location", "from", "to"]) {
    if (params[key] !== undefined) out[key] = params[key];
  }
  return out;
}

export function priceIncreaseCount(
  trends: readonly Pick<IngredientPriceTrendRow, "pct_change">[]
): number {
  return trends.filter((t) => t.pct_change > 0).length;
}

export interface PurchaseEntry {
  cost_date: string;
  total_cost: number | null;
  currency: string | null;
}

export interface PurchaseWindows {
  /** Sum of the last 30 days (today included); null with no entries. */
  last30: number | null;
  /** The 30 days before that; null with no entries. */
  previous30: number | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Supplier purchases (ingredient cost entries) in the last 30 days vs the
 * 30 before. Entries in another currency are skipped (never mixed).
 */
export function summarizePurchaseWindows(
  entries: readonly PurchaseEntry[],
  today: Date,
  companyCurrency: string
): PurchaseWindows {
  const start30 = new Date(today);
  start30.setUTCDate(start30.getUTCDate() - 29);
  const start60 = new Date(today);
  start60.setUTCDate(start60.getUTCDate() - 59);
  const end = isoDay(today);
  const s30 = isoDay(start30);
  const s60 = isoDay(start60);

  let last30: number | null = null;
  let previous30: number | null = null;
  for (const e of entries) {
    if (e.currency && e.currency.toUpperCase() !== companyCurrency) continue;
    const day = e.cost_date.slice(0, 10);
    const amount = Number(e.total_cost ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (day >= s30 && day <= end) last30 = (last30 ?? 0) + amount;
    else if (day >= s60 && day < s30) previous30 = (previous30 ?? 0) + amount;
  }
  return { last30, previous30 };
}

/** First day of the 60-day read window (for the Supabase filter). */
export function purchaseWindowStart(today: Date): string {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 59);
  return isoDay(start);
}

/** Percent change, or null when there is nothing to compare against. */
export function pctChange(
  current: number | null,
  previous: number | null
): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
