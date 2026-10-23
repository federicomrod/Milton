// lib/restaurant/costing/dish-coverage.ts
//
// The ONE definition of "plato costeado" used by Menú › Resumen and by
// Menú › Platos (menuDishKpis), so the two can never disagree:
//   - costeado  = the dish has AT LEAST ONE approved variant (tamaño);
//   - completo  = every variant with sales is approved;
//   - parcial   = costeado but not completo (some sizes still pending).
// `covered` already includes the partial ones: «12 de 63 costeados · 5 parciales».
// Pure.

import type { DishStatus } from "./dish-status";

export interface DishCoverageInput {
  cost_status: DishStatus;
  approved_count?: number;
  variant_count?: number;
}

export type DishCoverageClass = "completo" | "parcial" | "ninguno";

export interface DishCoverageCounts {
  /** Dishes with at least one approved variant (includes `partial`). */
  covered: number;
  /** Of those, the ones with some variants still not approved. */
  partial: number;
  /** Every dish counted. */
  total: number;
}

export function dishCoverageClass(d: DishCoverageInput): DishCoverageClass {
  const approved = d.approved_count ?? 0;
  const variants = d.variant_count ?? 0;
  if (variants > 0) {
    if (approved >= variants) return "completo";
    return approved > 0 ? "parcial" : "ninguno";
  }
  // No variant info: fall back to the dish's own status.
  return d.cost_status === "aprobado" ? "completo" : "ninguno";
}

export function countDishCoverage(
  dishes: readonly DishCoverageInput[]
): DishCoverageCounts {
  let covered = 0;
  let partial = 0;
  for (const d of dishes) {
    const c = dishCoverageClass(d);
    if (c !== "ninguno") covered += 1;
    if (c === "parcial") partial += 1;
  }
  return { covered, partial, total: dishes.length };
}

/** «12 de 63 platos costeados · 5 parciales» (the parciales part only when there are some). */
export function dishCoverageLabel(c: DishCoverageCounts): string {
  const base = `${c.covered} de ${c.total} platos costeados`;
  return c.partial > 0
    ? `${base} · ${c.partial} ${c.partial === 1 ? "parcial" : "parciales"}`
    : base;
}
