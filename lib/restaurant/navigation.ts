// lib/restaurant/navigation.ts
//
// Cockpit UX PR 1 (#128) — restaurant information architecture.
// Pure config + helpers so navigation can be unit-tested without React.
// Telegram is an implementation detail of Kitchen and must never appear
// in primary navigation labels.

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";

export const COCKPIT_HREF = "/dashboard/restaurant";
export const SALES_HREF = "/dashboard/restaurant/sales";
// There is ONE Ventas page (the old Detalle): the export stays so callers compile.
export const SALES_DETAIL_HREF = SALES_HREF;
export const MENU_HREF = "/dashboard/restaurant/menu";
export const COSTS_HREF = "/dashboard/restaurant/costs";
export const RENTABILIDAD_HREF = "/dashboard/restaurant/rentabilidad";
export const KITCHEN_HREF = "/dashboard/restaurant/kitchen";
export const DATA_SETTINGS_HREF = "/dashboard/restaurant/data";
export const OBJECTIVES_HREF = "/dashboard/restaurant/data/objetivos";
/** R1-17a: Configuración › Turnos (shifts and the business-day cutoff). */
export const RESTAURANT_SETTINGS_HREF =
  "/dashboard/restaurant/data/restaurante";
export const SHIFTS_HREF = "/dashboard/restaurant/data/turnos";
export const ASK_MILTON_HREF = "/dashboard/restaurant/briefing";

/** "main": the five daily areas. "data_settings": ⚙ Configuración,
 *  pinned at the bottom of the sidebar next to the user (no headers). */
export type NavGroupId = "main" | "data_settings";

export type PrimaryNavId =
  | "cockpit"
  | "sales"
  | "menu"
  | "costs"
  | "rentabilidad"
  | "kitchen"
  | "data_settings";

export interface NavItemConfig {
  id: PrimaryNavId;
  href: string;
  group: NavGroupId;
  /** Exact match for cockpit; prefix match for everything else. */
  match: "exact" | "prefix";
}

export const PRIMARY_NAV_ITEMS: readonly NavItemConfig[] = [
  {
    id: "cockpit",
    href: COCKPIT_HREF,
    group: "main",
    match: "exact",
  },
  {
    id: "sales",
    href: SALES_HREF,
    group: "main",
    match: "prefix",
  },
  {
    id: "menu",
    href: MENU_HREF,
    group: "main",
    match: "prefix",
  },
  {
    id: "costs",
    href: COSTS_HREF,
    group: "main",
    match: "prefix",
  },
  {
    id: "rentabilidad",
    href: RENTABILIDAD_HREF,
    group: "main",
    match: "prefix",
  },
  {
    id: "kitchen",
    href: KITCHEN_HREF,
    group: "main",
    match: "prefix",
  },
  {
    id: "data_settings",
    href: DATA_SETTINGS_HREF,
    group: "data_settings",
    match: "prefix",
  },
] as const;

export function primaryNavLabel(
  id: PrimaryNavId,
  lang: PreferredLanguage
): string {
  const nav = getDictionary(lang).shell.nav;
  switch (id) {
    case "cockpit":
      return nav.cockpit;
    case "sales":
      return nav.sales;
    case "menu":
      return nav.menu;
    case "costs":
      return nav.costs;
    case "rentabilidad":
      return nav.rentabilidad;
    case "kitchen":
      return nav.kitchen;
    case "data_settings":
      return nav.settings;
  }
}

/** @deprecated The sidebar has no group headers (R1-09b, A1). */
export function navGroupLabel(
  group: NavGroupId,
  lang: PreferredLanguage
): string {
  const nav = getDictionary(lang).shell.nav;
  return group === "main" ? nav.main : nav.dataAndSettings;
}

export function isPrimaryNavActive(
  item: NavItemConfig,
  pathname: string
): boolean {
  if (item.match === "exact") return pathname === item.href;
  // Account and settings are reached from Configuración and live in the shell.
  if (
    item.id === "data_settings" &&
    (pathname.startsWith("/dashboard/account") ||
      pathname.startsWith("/dashboard/settings"))
  ) {
    return true;
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function primaryNavHasTelegramLabel(lang: PreferredLanguage): boolean {
  return PRIMARY_NAV_ITEMS.some((item) =>
    /telegram/i.test(primaryNavLabel(item.id, lang))
  );
}

export function primaryNavLabels(lang: PreferredLanguage): string[] {
  return PRIMARY_NAV_ITEMS.map((item) => primaryNavLabel(item.id, lang));
}

// ---------------------------------------------------------------------------
// Legacy routes — every previous sidebar destination stays reachable.
// Primary nav never lists these. Some are still screens; the rest are
// redirects to where the feature lives now (`resolvesTo`). Configuración
// only lists the ones with a `section` (R1-09b, A10/A11).
// ---------------------------------------------------------------------------

/** Configuración has four sections (R1-09b, A10; Objetivos added in R1-16a). */
export type DataSettingsSectionId =
  | "restaurant"
  | "connections"
  | "objectives"
  | "shifts"
  | "team"
  | "account";

export const DATA_SETTINGS_SECTIONS: readonly DataSettingsSectionId[] = [
  "restaurant",
  "connections",
  "objectives",
  "shifts",
  "team",
  "account",
] as const;

/** Anchor / `?seccion=` value per Configuración section. */
export const DATA_SETTINGS_SECTION_ANCHORS: Record<
  DataSettingsSectionId,
  string
> = {
  restaurant: "restaurante",
  connections: "conexiones",
  objectives: "objetivos",
  shifts: "turnos",
  team: "equipo",
  account: "cuenta",
};

/** Configuración › Conexiones with "Subir ventas (archivo)" open. */
export function posUploadHref(
  params: Record<string, string | string[] | undefined> = {}
): string {
  return hrefKeepingParams(DATA_SETTINGS_HREF, {
    ...params,
    tab: DATA_SETTINGS_SECTION_ANCHORS.connections,
  });
}

export interface MappedLegacyRoute {
  /** Stable id for tests and Configuración lists. */
  id: string;
  /** The old URL. It still answers: as a screen, or as a redirect. */
  href: string;
  /** Where a redirecting `href` lands now (path, no params). */
  resolvesTo?: string;
  /** Previous primary-nav label (English), for the route-map test. */
  legacyLabel: string;
  area: PrimaryNavId;
  /** Listed in Configuración under this section; none = lives elsewhere. */
  section?: DataSettingsSectionId;
  /** Only admins see it in Configuración. */
  adminOnly?: boolean;
}

/**
 * Old primary destinations plus invitations. Used to prove nothing was
 * deleted from reachability when the sidebar was collapsed.
 */
export const LEGACY_ROUTE_MAP: readonly MappedLegacyRoute[] = [
  {
    id: "cockpit",
    href: COCKPIT_HREF,
    legacyLabel: "Cockpit",
    area: "cockpit",
  },
  {
    // The one "Preguntar a Milton" is in every page header now.
    id: "ask-milton",
    href: ASK_MILTON_HREF,
    legacyLabel: "Ask Milton",
    area: "cockpit",
  },
  {
    id: "connect-data",
    href: "/dashboard/restaurant/connect-data",
    legacyLabel: "Connect data",
    area: "data_settings",
    section: "connections",
  },
  {
    // The uploader is a panel in Conexiones; the old page redirects there.
    id: "pos-sales",
    href: "/dashboard/restaurant/upload",
    resolvesTo: DATA_SETTINGS_HREF,
    legacyLabel: "POS Sales",
    area: "data_settings",
    section: "connections",
  },
  {
    // R1-16a: the goals live here; Cockpit and Ventas draw them as lines.
    id: "objectives",
    href: OBJECTIVES_HREF,
    legacyLabel: "Targets",
    area: "data_settings",
    section: "objectives",
  },
  {
    // R1 prod bugs 1: rename (and archive) the restaurants.
    id: "restaurant",
    href: RESTAURANT_SETTINGS_HREF,
    legacyLabel: "Restaurant",
    area: "data_settings",
    section: "restaurant",
  },
  {
    // R1-17a: the restaurant's shifts and business-day cutoff.
    id: "shifts",
    href: SHIFTS_HREF,
    legacyLabel: "Shifts",
    area: "data_settings",
    section: "shifts",
  },
  {
    id: "odoo-admin",
    href: "/management/odoo",
    legacyLabel: "Odoo",
    area: "data_settings",
    section: "connections",
    adminOnly: true,
  },
  {
    id: "targets",
    href: `${COCKPIT_HREF}#targets`,
    legacyLabel: "Targets",
    area: "cockpit",
  },
  {
    id: "menu-recipes",
    href: MENU_HREF,
    legacyLabel: "Menu & Recipes",
    area: "menu",
  },
  {
    id: "ingredients",
    href: "/dashboard/restaurant/ingredients",
    legacyLabel: "Ingredients",
    area: "menu",
  },
  {
    // The cost-file upload is in Menú; the old page redirects to Resumen.
    id: "import-costs",
    href: "/dashboard/restaurant/costs/upload",
    resolvesTo: MENU_HREF,
    legacyLabel: "Import Costs",
    area: "menu",
  },
  {
    id: "suppliers",
    href: "/dashboard/restaurant/suppliers",
    resolvesTo: COSTS_HREF,
    legacyLabel: "Suppliers",
    area: "costs",
  },
  {
    id: "supplier-invoices",
    href: "/dashboard/restaurant/invoices",
    resolvesTo: COSTS_HREF,
    legacyLabel: "Supplier Invoices",
    area: "costs",
  },
  {
    id: "kitchen",
    href: KITCHEN_HREF,
    legacyLabel: "Kitchen (Telegram)",
    area: "kitchen",
  },
  {
    // #379: the English agents page is retired; old links land on Resumen.
    id: "agents",
    href: "/dashboard/restaurant/agents",
    resolvesTo: COCKPIT_HREF,
    legacyLabel: "Agents",
    area: "data_settings",
  },
  {
    id: "invitations",
    href: "/management/invites",
    legacyLabel: "Invitations",
    area: "data_settings",
    section: "team",
    adminOnly: true,
  },
  {
    id: "account",
    href: "/dashboard/account",
    legacyLabel: "Account",
    area: "data_settings",
    section: "account",
  },
  {
    id: "settings",
    href: "/dashboard/settings",
    legacyLabel: "Settings",
    area: "data_settings",
    section: "account",
  },
] as const;

export const REQUIRED_LEGACY_HREFS: readonly string[] = [
  "/dashboard/restaurant",
  "/dashboard/restaurant/briefing",
  "/dashboard/restaurant/upload",
  "/dashboard/restaurant#targets",
  "/dashboard/restaurant/menu",
  "/dashboard/restaurant/ingredients",
  "/dashboard/restaurant/costs/upload",
  "/dashboard/restaurant/suppliers",
  "/dashboard/restaurant/invoices",
  "/dashboard/restaurant/kitchen",
  "/dashboard/restaurant/agents",
  "/dashboard/settings",
  "/dashboard/account",
  "/management/invites",
];

export function dataSettingsSectionLabel(
  section: DataSettingsSectionId,
  lang: PreferredLanguage
): string {
  return getDictionary(lang).shell.section[section];
}

type LinkKey = keyof ReturnType<typeof getDictionary>["shell"]["link"];

const LINK_KEYS = {
  "connect-data": "connectData",
  "pos-sales": "posSales",
  "odoo-admin": "odooAdmin",
  objectives: "objectives",
  shifts: "shifts",
  restaurant: "restaurant",
  invitations: "invitations",
  account: "account",
  settings: "settings",
  "ask-milton": "askMilton",
  targets: "targets",
  "menu-recipes": "menuRecipes",
  ingredients: "ingredients",
  "import-costs": "importCosts",
  suppliers: "suppliers",
  "supplier-invoices": "supplierInvoices",
  agents: "agents",
} as const;

export function dataSettingsLinkLabel(
  id: MappedLegacyRoute["id"],
  lang: PreferredLanguage
): string {
  const key = (LINK_KEYS as Record<string, LinkKey>)[id];
  return key ? getDictionary(lang).shell.link[key] : id;
}

export function isDataSettingsLinkListed(
  id: MappedLegacyRoute["id"],
  opts: { isAdmin: boolean }
): boolean {
  const route = LEGACY_ROUTE_MAP.find((r) => r.id === id);
  if (!route?.section) return false;
  if (route.adminOnly) return opts.isAdmin;
  return true;
}

export function routesForSection(
  section: DataSettingsSectionId,
  opts?: { isAdmin?: boolean }
): MappedLegacyRoute[] {
  const isAdmin = opts?.isAdmin ?? true;
  return LEGACY_ROUTE_MAP.filter(
    (route) =>
      route.section === section &&
      isDataSettingsLinkListed(route.id, { isAdmin })
  );
}

export function everyRequiredLegacyRouteIsMapped(): boolean {
  const hrefs = new Set(LEGACY_ROUTE_MAP.map((route) => route.href));
  return REQUIRED_LEGACY_HREFS.every((href) => hrefs.has(href));
}

/**
 * Carries restaurant + date-range selection onto another href, inserted
 * before any hash fragment.
 */
export function withShellParams(
  href: string,
  params: {
    locationId?: string | null;
    from?: string | null;
    to?: string | null;
  }
): string {
  const [pathAndQuery, hash] = href.split("#");
  const url = new URL(pathAndQuery, "https://milton.local");
  if (params.locationId) {
    url.searchParams.set("location", params.locationId);
  }
  if (params.from) url.searchParams.set("from", params.from);
  if (params.to) url.searchParams.set("to", params.to);
  const search = url.searchParams.toString();
  const next = search ? `${url.pathname}?${search}` : url.pathname;
  return hash ? `${next}#${hash}` : next;
}

/**
 * `path` with every query param of an old URL carried over (redirects keep
 * restaurant, period and anything else the old link had).
 */
export function hrefKeepingParams(
  path: string,
  params: Record<string, string | string[] | undefined>,
  hash?: string
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) next.append(key, v);
  }
  const query = next.toString();
  const base = query ? `${path}?${query}` : path;
  return hash ? `${base}#${hash}` : base;
}

/** @deprecated Use withShellParams — kept so existing imports keep working. */
export function withLocationParam(
  href: string,
  locationId: string | null
): string {
  return withShellParams(href, { locationId });
}
