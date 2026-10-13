// Where old recipe / cost pages send people now: Menú › Recetas y costeo.

export const RECETAS_PATH = "/dashboard/restaurant/menu/recetas";

export function recetasHref(input: {
  location?: string | null;
  vista?: "plato" | "preparaciones";
  producto?: number | null;
  prep?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.vista) params.set("vista", input.vista);
  if (input.producto != null) params.set("producto", String(input.producto));
  if (input.prep) params.set("prep", input.prep);
  if (input.location) params.set("location", input.location);
  const query = params.toString();
  return query ? `${RECETAS_PATH}?${query}` : RECETAS_PATH;
}
