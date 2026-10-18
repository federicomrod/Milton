// The pre-pivot CFO pages (they carried the old top navigation bar) now send
// people to their restaurant equivalent. Used by proxy.ts, before the
// onboarding gate. Account, settings and the admin tools are NOT here: they
// live in the restaurant shell / their own admin sidebar.

const RESTAURANT_HOME = "/dashboard/restaurant";
const SALES = "/dashboard/restaurant/sales";
const CONNECTIONS = "/dashboard/restaurant/data?tab=conexiones";

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Where an old page now lives; null when the path is not an old page. */
export function legacyRedirectTarget(pathname: string): string | null {
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    return RESTAURANT_HOME;
  }
  if (under(pathname, "/dashboard/model")) return RESTAURANT_HOME;
  if (under(pathname, "/dashboard/analytics")) return SALES;
  if (under(pathname, "/dashboard/reporting")) return RESTAURANT_HOME;
  if (under(pathname, "/dashboard/scenarios")) return RESTAURANT_HOME;
  // Importing sales: the file upload is in Configuración › Conexiones.
  if (under(pathname, "/dashboard/data")) return CONNECTIONS;
  if (under(pathname, "/dashboard/upload")) return CONNECTIONS;
  return null;
}
