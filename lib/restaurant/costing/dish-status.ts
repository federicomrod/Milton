// lib/restaurant/costing/dish-status.ts
//
// The five dish statuses every screen shows (R1-09a + «Borrador»). No imports, so
// client components can use it without pulling in the costing engine.

export type DishStatus =
  | "aprobado"
  | "estimado"
  | "falta_precio"
  | "borrador"
  | "sin_receta";

export const DISH_STATUS_LABELS: Record<DishStatus, string> = {
  aprobado: "Aprobado",
  estimado: "Estimado",
  falta_precio: "Falta precio",
  borrador: "Borrador",
  sin_receta: "Sin receta",
};

export const DISH_STATUSES: readonly DishStatus[] = [
  "aprobado",
  "estimado",
  "falta_precio",
  "borrador",
  "sin_receta",
];
