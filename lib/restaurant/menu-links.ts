// lib/restaurant/menu-links.ts
//
// Where each number links to (R1-09a "well connected"). One place, so the
// routes move once when Menú gets its real tabs.

import {
  DISH_STATUSES,
  type DishStatus,
} from "@/lib/restaurant/costing/dish-status";

const MENU = "/dashboard/restaurant/menu";

/** Menú › Resumen. */
export function menuResumenHref(): string {
  return MENU;
}

/** Platos, optionally filtered by the loader's statuses. */
export function platosHref(statuses?: readonly DishStatus[]): string {
  const params = new URLSearchParams({ vista: "plato" });
  if (statuses && statuses.length > 0) params.set("estado", statuses.join(","));
  return `${MENU}/recetas?${params.toString()}`;
}

/** One dish open in Platos. */
export function dishHref(odooProductId: number): string {
  const params = new URLSearchParams({
    vista: "plato",
    producto: String(odooProductId),
  });
  return `${MENU}/recetas?${params.toString()}`;
}

/** One ingredient (its single price record, source and date). */
export function ingredientHref(ingredientId: string): string {
  return `/dashboard/restaurant/ingredients?ingrediente=${encodeURIComponent(ingredientId)}`;
}

/** `?estado=falta_precio,sin_receta` → the statuses it names. */
export function parseDishStatusFilter(
  raw: string | null | undefined
): DishStatus[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(",").map((s) => s.trim()));
  return DISH_STATUSES.filter((status) => wanted.has(status));
}
