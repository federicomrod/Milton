// lib/restaurant/kitchen-explore.ts
//
// Explore switcher for the Kitchen page. One analysis at a time.
// State is client-side; this module keeps the contract testable.

export const KITCHEN_EXPLORE_TABS = [
  "running_out",
  "waste",
  "drafts",
  "staff",
  "history",
] as const;

export type KitchenExploreTab = (typeof KITCHEN_EXPLORE_TABS)[number];

export const DEFAULT_KITCHEN_EXPLORE_TAB: KitchenExploreTab = "waste";

export const KITCHEN_FEED_FILTERS = [
  "all",
  "running_out",
  "waste",
  "drafts",
] as const;

export type KitchenFeedFilter = (typeof KITCHEN_FEED_FILTERS)[number];

export const DEFAULT_KITCHEN_FEED_FILTER: KitchenFeedFilter = "all";

export const KITCHEN_FEED_PREVIEW = 4;
export const KITCHEN_EXPLORE_TOP_N = 3;

export function parseKitchenExploreTab(
  raw: string | null | undefined
): KitchenExploreTab {
  return KITCHEN_EXPLORE_TABS.includes(raw as KitchenExploreTab)
    ? (raw as KitchenExploreTab)
    : DEFAULT_KITCHEN_EXPLORE_TAB;
}

export function parseKitchenFeedFilter(
  raw: string | null | undefined
): KitchenFeedFilter {
  return KITCHEN_FEED_FILTERS.includes(raw as KitchenFeedFilter)
    ? (raw as KitchenFeedFilter)
    : DEFAULT_KITCHEN_FEED_FILTER;
}

export function kitchenExploreHash(tab: KitchenExploreTab): string {
  if (tab === "running_out") return "se-agota";
  if (tab === "waste") return "merma";
  if (tab === "drafts") return "recetas";
  if (tab === "staff") return "equipo";
  return "historial";
}

export function kitchenHref(
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
