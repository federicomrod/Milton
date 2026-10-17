// Configuración is ONE page, /dashboard/restaurant/data, and the active tab
// lives in the URL (?tab=restaurante|conexiones|objetivos|turnos|equipo|cuenta)
// so links and the back button work. Each tab shows only its own section.
// The old routes (/data/restaurante, /data/objetivos, /data/turnos) redirect
// here; the older ?seccion=… still means the same as ?tab=….

import { DATA_SETTINGS_HREF } from "@/lib/restaurant/navigation";

export const CONFIG_TABS = [
  "restaurante",
  "conexiones",
  "objetivos",
  "turnos",
  "equipo",
  "cuenta",
] as const;

export type ConfigTab = (typeof CONFIG_TABS)[number];

export const DEFAULT_CONFIG_TAB: ConfigTab = "conexiones";

/** The tab a URL asks for (`tab`, or the older `seccion`); «equipo» is for admins only. */
export function parseConfigTab(
  params: { tab?: string | string[]; seccion?: string | string[] },
  isAdmin: boolean
): ConfigTab {
  const raw = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.toLowerCase();
  const asked = raw(params.tab) ?? raw(params.seccion);
  const tab = CONFIG_TABS.find((id) => id === asked) ?? DEFAULT_CONFIG_TAB;
  return tab === "equipo" && !isAdmin ? DEFAULT_CONFIG_TAB : tab;
}

/** /data?tab=… keeping any other params (restaurant, «aplica a»). */
export function configTabHref(
  tab: ConfigTab,
  extra: Record<string, string | undefined> = {}
): string {
  const query = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(extra)) {
    if (value) query.set(key, value);
  }
  return `${DATA_SETTINGS_HREF}?${query.toString()}`;
}
