// Where old recipe / cost URLs send people now: the Menú tabs (R1-09b).
// /menu/recetas?vista=plato → /menu/platos, ?vista=preparaciones →
// /menu/preparaciones, no vista → /menu (Resumen). Other params survive.

export const MENU_PATH = "/dashboard/restaurant/menu";
export const PLATOS_PATH = `${MENU_PATH}/platos`;
export const PREPARACIONES_PATH = `${MENU_PATH}/preparaciones`;
export const INGREDIENTES_PATH = `${MENU_PATH}/ingredientes`;
/** @deprecated Redirects to the Menú tabs; kept for old links. */
export const RECETAS_PATH = `${MENU_PATH}/recetas`;

export type MenuTab = "resumen" | "platos" | "preparaciones" | "ingredientes";

export const MENU_TAB_PATHS: Record<MenuTab, string> = {
  resumen: MENU_PATH,
  platos: PLATOS_PATH,
  preparaciones: PREPARACIONES_PATH,
  ingredientes: INGREDIENTES_PATH,
};

/** Old `vista` values (incl. vincular / validar / menu-costeado). */
export function menuTabForVista(vista: string | null | undefined): MenuTab {
  if (vista === "plato" || vista === "vincular" || vista === "validar") {
    return "platos";
  }
  if (vista === "preparaciones") return "preparaciones";
  return "resumen";
}

export function recetasHref(input: {
  location?: string | null;
  vista?: "plato" | "preparaciones";
  producto?: number | null;
  prep?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.producto != null) params.set("producto", String(input.producto));
  if (input.prep) params.set("prep", input.prep);
  if (input.location) params.set("location", input.location);
  const path = MENU_TAB_PATHS[menuTabForVista(input.vista)];
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** An old /menu/recetas URL → its tab, keeping every other param. */
export function redirectFromRecetas(
  params: Record<string, string | string[] | undefined>
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "vista" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) next.append(key, v);
  }
  const vista = typeof params.vista === "string" ? params.vista : null;
  const path = MENU_TAB_PATHS[menuTabForVista(vista)];
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

/** Old /dashboard/restaurant/ingredients URL → Menú › Ingredientes, every param kept. */
export function redirectToIngredientes(
  params: Record<string, string | string[] | undefined>
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) next.append(key, v);
  }
  const query = next.toString();
  return query ? `${INGREDIENTES_PATH}?${query}` : INGREDIENTES_PATH;
}
