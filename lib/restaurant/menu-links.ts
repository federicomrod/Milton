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
  if (!statuses || statuses.length === 0) return `${MENU}/platos`;
  return `${MENU}/platos?estado=${statuses.join(",")}`;
}

/** One dish open in Platos. */
export function dishHref(odooProductId: number): string {
  return `${MENU}/platos?producto=${odooProductId}`;
}

/** One preparation open in Preparaciones. */
export function preparationHref(componentId: string): string {
  return `${MENU}/preparaciones?prep=${encodeURIComponent(componentId)}`;
}

/** Ingredientes, optionally filtered ("falta_precio" first in setup). */
export function ingredientesHref(filter?: "falta_precio"): string {
  return filter
    ? `${MENU}/ingredientes?filtro=${filter}`
    : `${MENU}/ingredientes`;
}

/** One ingredient (its single price record, source and date). */
export function ingredientHref(ingredientId: string): string {
  return `${MENU}/ingredientes?ingrediente=${encodeURIComponent(ingredientId)}`;
}

/** `?estado=falta_precio,sin_receta` → the statuses it names. */
export function parseDishStatusFilter(
  raw: string | null | undefined
): DishStatus[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(",").map((s) => s.trim()));
  return DISH_STATUSES.filter((status) => wanted.has(status));
}
