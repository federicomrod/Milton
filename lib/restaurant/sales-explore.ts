// lib/restaurant/sales-explore.ts
//
// Explore-level switcher for the Sales page. One focused view at a time.
// State is client-side; this module keeps the contract testable.

export const SALES_EXPLORE_TABS = [
  "channels",
  "categories",
  "payments",
] as const;

export type SalesExploreTab = (typeof SALES_EXPLORE_TABS)[number];

export const DEFAULT_SALES_EXPLORE_TAB: SalesExploreTab = "channels";

export const SALES_CATEGORY_TOP_N = 6;

export function parseSalesExploreTab(
  raw: string | null | undefined
): SalesExploreTab {
  return raw === "categories" || raw === "payments" || raw === "channels"
    ? raw
    : DEFAULT_SALES_EXPLORE_TAB;
}

export function isSalesExploreTab(value: unknown): value is SalesExploreTab {
  return value === "channels" || value === "categories" || value === "payments";
}

export function salesExploreHash(tab: SalesExploreTab): string {
  if (tab === "categories") return "categorias";
  if (tab === "payments") return "pagos";
  return "canales";
}

/** Sales / detalle links that keep location + the cockpit period param. */
export function salesHref(
  path: string,
  params: {
    locationId?: string | null;
    period?: string | null;
    hash?: string;
  } = {}
): string {
  const url = new URL(path, "https://milton.local");
  if (params.locationId) url.searchParams.set("location", params.locationId);
  if (params.period && params.period !== "last_7") {
    url.searchParams.set("period", params.period);
  }
  const search = url.searchParams.toString();
  const next = search ? `${url.pathname}?${search}` : url.pathname;
  return params.hash ? `${next}#${params.hash}` : next;
}

/**
 * Bump a nonce so the same Ask Milton chip refills the composer after
 * the user edited the box.
 */
export function bumpAskMiltonPrefill(
  currentNonce: number,
  question?: string
): { draft: string | null; nonce: number } {
  const next = question?.trim() ?? "";
  if (!next) return { draft: null, nonce: currentNonce };
  return { draft: next, nonce: currentNonce + 1 };
}
