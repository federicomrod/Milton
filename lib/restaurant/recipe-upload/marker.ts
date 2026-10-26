// lib/restaurant/recipe-upload/marker.ts
//
// Client-safe helpers for «Sube tus recetas». A draft that came from a file and
// is a preparation (sub-receta) is stored with a marker at the end of its
// dish_name: there is no column for it and no migration. The UI reads the
// marker, shows the badge «Preparación» and never shows the marker itself.

export const PREPARATION_MARKER = " · preparación";

export function isPreparationName(name: string | null | undefined): boolean {
  return (
    typeof name === "string" &&
    name.toLowerCase().endsWith(PREPARATION_MARKER.toLowerCase())
  );
}

export function stripPreparationMarker(name: string): string {
  return isPreparationName(name)
    ? name.slice(0, name.length - PREPARATION_MARKER.length).trim()
    : name;
}

export function withPreparationMarker(name: string): string {
  const base = stripPreparationMarker(name).trim();
  return `${base}${PREPARATION_MARKER}`;
}

/** Accent / case / space folded name, for «same dish» comparisons. */
export function foldDishName(name: string): string {
  return stripPreparationMarker(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
