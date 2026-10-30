// Configuración is ONE scrolling page. These are its sections, in order, and
// where the old ?tab= / ?seccion= values (and the old /data/* routes) land.

export const CONFIG_SECTION_IDS = [
  "ajustes",
  "restaurantes",
  "conexiones",
  "objetivos",
  "turnos",
  "equipo",
  "cuenta",
] as const;

export type ConfigSectionId = (typeof CONFIG_SECTION_IDS)[number];

const LEGACY: Record<string, ConfigSectionId> = {
  ajustes: "ajustes",
  settings: "ajustes",
  restaurante: "restaurantes",
  restaurantes: "restaurantes",
  conexiones: "conexiones",
  objetivos: "objetivos",
  turnos: "turnos",
  equipo: "equipo",
  cuenta: "cuenta",
};

/** The section a hash or old tab value points to; null if it names none. */
export function sectionForLegacyTab(
  value: string | null | undefined
): ConfigSectionId | null {
  return LEGACY[(value ?? "").toLowerCase()] ?? null;
}
