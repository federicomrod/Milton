// lib/restaurant/navigation.ts
//
// Cockpit UX PR 1 (#128) — restaurant information architecture.
// Pure config + helpers so navigation can be unit-tested without React.
// Telegram is an implementation detail of Kitchen and must never appear
// in primary navigation labels.

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { t } from "@/lib/restaurant/language";

export const COCKPIT_HREF = "/dashboard/restaurant";
export const SALES_HREF = "/dashboard/restaurant/sales";
export const SALES_DETAIL_HREF = "/dashboard/restaurant/sales/detalle";
export const MENU_HREF = "/dashboard/restaurant/menu";
export const COSTS_HREF = "/dashboard/restaurant/costs";
export const KITCHEN_HREF = "/dashboard/restaurant/kitchen";
export const DATA_SETTINGS_HREF = "/dashboard/restaurant/data";
export const ASK_MILTON_HREF = "/dashboard/restaurant/briefing";

export type NavGroupId = "main" | "data_settings";

export type PrimaryNavId =
  | "cockpit"
  | "sales"
  | "menu"
  | "costs"
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
  switch (id) {
    case "cockpit":
      return t(lang, "Cockpit", "Cockpit");
    case "sales":
      return t(lang, "Sales", "Ventas");
    case "menu":
      return t(lang, "Menu", "Menú");
    case "costs":
      return t(lang, "Costs", "Costos");
    case "kitchen":
      return t(lang, "Kitchen", "Cocina");
    case "data_settings":
      return t(lang, "Data & Settings", "Datos y configuración");
  }
}

export function navGroupLabel(
  group: NavGroupId,
  lang: PreferredLanguage
): string {
  return group === "main"
    ? t(lang, "Main", "Principal")
    : t(lang, "Data & Settings", "Datos y configuración");
}

export function isPrimaryNavActive(
  item: NavItemConfig,
  pathname: string
): boolean {
  if (item.match === "exact") return pathname === item.href;
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
// Primary nav never lists these; they live under the five areas or
// Data & Settings sections.
// ---------------------------------------------------------------------------

export type DataSettingsSectionId =
  | "data_sources"
  | "data_health"
  | "setup"
  | "team"
  | "account";

export interface MappedLegacyRoute {
  /** Stable id for tests and Data & Settings lists. */
  id: string;
  href: string;
  /** Previous primary-nav label (English), for the route-map test. */
  legacyLabel: string;
  area: PrimaryNavId;
  section?: DataSettingsSectionId;
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
    id: "ask-milton",
    href: ASK_MILTON_HREF,
    legacyLabel: "Ask Milton",
    area: "data_settings",
    section: "setup",
  },
  {
    id: "pos-sales",
    href: "/dashboard/restaurant/upload",
    legacyLabel: "POS Sales",
    area: "data_settings",
    section: "data_sources",
  },
  {
    id: "targets",
    href: `${COCKPIT_HREF}#targets`,
    legacyLabel: "Targets",
    area: "data_settings",
    section: "setup",
  },
  {
    id: "menu-recipes",
    href: "/dashboard/restaurant/menu",
    legacyLabel: "Menu & Recipes",
    area: "data_settings",
    section: "setup",
  },
  {
    id: "ingredients",
    href: "/dashboard/restaurant/ingredients",
    legacyLabel: "Ingredients",
    area: "data_settings",
    section: "data_sources",
  },
  {
    id: "import-costs",
    href: "/dashboard/restaurant/costs/upload",
    legacyLabel: "Import Costs",
    area: "data_settings",
    section: "data_sources",
  },
  {
    id: "suppliers",
    href: "/dashboard/restaurant/suppliers",
    legacyLabel: "Suppliers",
    area: "data_settings",
    section: "data_sources",
  },
  {
    id: "supplier-invoices",
    href: "/dashboard/restaurant/invoices",
    legacyLabel: "Supplier Invoices",
    area: "data_settings",
    section: "data_sources",
  },
  {
    id: "kitchen",
    href: KITCHEN_HREF,
    legacyLabel: "Kitchen (Telegram)",
    area: "kitchen",
  },
  {
    id: "agents",
    href: "/dashboard/restaurant/agents",
    legacyLabel: "Agents",
    area: "data_settings",
    section: "setup",
  },
  {
    id: "settings",
    href: "/dashboard/settings",
    legacyLabel: "Settings",
    area: "data_settings",
    section: "account",
  },
  {
    id: "account",
    href: "/dashboard/account",
    legacyLabel: "Account",
    area: "data_settings",
    section: "account",
  },
  {
    id: "invitations",
    href: "/management/invites",
    legacyLabel: "Invitations",
    area: "data_settings",
    section: "team",
  },
  {
    id: "connect-data",
    href: "/dashboard/restaurant/connect-data",
    legacyLabel: "Connect data",
    area: "data_settings",
    section: "data_sources",
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
  switch (section) {
    case "data_sources":
      return t(lang, "Data sources", "Fuentes de datos");
    case "data_health":
      return t(lang, "Data health", "Salud de los datos");
    case "setup":
      return t(lang, "Setup", "Configuración");
    case "team":
      return t(lang, "Team", "Equipo");
    case "account":
      return t(lang, "Account", "Cuenta");
  }
}

export function dataSettingsLinkLabel(
  id: MappedLegacyRoute["id"],
  lang: PreferredLanguage
): string {
  switch (id) {
    case "ask-milton":
      return t(lang, "Ask Milton", "Preguntar a Milton");
    case "pos-sales":
      return t(lang, "POS Sales", "Ventas del POS");
    case "targets":
      return t(lang, "Targets", "Metas");
    case "menu-recipes":
      return t(lang, "Menu & Recipes", "Menú y recetas");
    case "ingredients":
      return t(lang, "Ingredients", "Ingredientes");
    case "import-costs":
      return t(lang, "Import Costs", "Importar costos");
    case "suppliers":
      return t(lang, "Suppliers", "Proveedores");
    case "supplier-invoices":
      return t(lang, "Supplier Invoices", "Facturas de proveedores");
    case "agents":
      return t(lang, "Agents", "Agentes");
    case "settings":
      return t(lang, "Settings", "Ajustes");
    case "account":
      return t(lang, "Account", "Cuenta");
    case "invitations":
      return t(lang, "Invitations", "Invitaciones");
    case "connect-data":
      return t(lang, "Connect data", "Conectar datos");
    default:
      return id;
  }
}

export function isDataSettingsLinkListed(
  id: MappedLegacyRoute["id"],
  opts: { isAdmin: boolean }
): boolean {
  if (id === "invitations") return opts.isAdmin;
  if (id === "menu-recipes") return false;
  if (id === "targets") return false;
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

/** @deprecated Use withShellParams — kept so existing imports keep working. */
export function withLocationParam(
  href: string,
  locationId: string | null
): string {
  return withShellParams(href, { locationId });
}
