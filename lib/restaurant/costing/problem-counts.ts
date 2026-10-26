// lib/restaurant/costing/problem-counts.ts
//
// The ONE count of «platos con problema» and of every Pendientes bucket.
// Menú › Resumen (cards + Pendientes), the Platos tab KPIs and the menu-reader
// card all call it, so they can never disagree for the same period.
//
// Counting rule (a dish with some approved sizes and some without a recipe is
// NOT counted twice):
//   * a dish is counted ONCE, in the bucket of its `pending_status` — the worst
//     status among its non-approved variants (falta_precio > estimado >
//     borrador > sin_receta; see rollupLeaves);
//   * its share in that bucket is only the sales of its non-approved variants
//     (`pending_sales`); the approved variants' sales count only in
//     «Ventas con costo». So coverage + Σ bucket shares ≤ 100%.
//   * problem_count = dishes in falta_precio + borrador + sin_receta
//     («estimado» is an AI estimate to review, not a problem).
// Pure.

import type { DishStatus } from "./dish-status";

/** What a dish row must carry (both come from rollupLeaves). */
export interface ProblemCountRow {
  net_sales: number;
  cost_status?: DishStatus;
  coverage?: number;
  pending_status?: DishStatus | null;
  pending_sales?: number;
}

export interface ProblemBucket {
  dishes: number;
  /** 0–1 of food sales: only the non-approved sales of those dishes. */
  share: number;
}

export interface ProblemCounts {
  falta_precio: ProblemBucket;
  estimado: ProblemBucket;
  borrador: ProblemBucket;
  sin_receta: ProblemBucket;
  /** Dishes in falta_precio + borrador + sin_receta. */
  problem_count: number;
}

export const PROBLEM_STATUSES: readonly DishStatus[] = [
  "falta_precio",
  "borrador",
  "sin_receta",
];

/** Rows built before pending_* existed: derive them from the dish's own status. */
function pendingOf(row: ProblemCountRow): {
  status: DishStatus | null;
  sales: number;
} {
  if (row.pending_status !== undefined) {
    return { status: row.pending_status, sales: row.pending_sales ?? 0 };
  }
  const status =
    row.cost_status && row.cost_status !== "aprobado" ? row.cost_status : null;
  const sales = status === null ? 0 : row.net_sales * (1 - (row.coverage ?? 0));
  return { status, sales };
}

export function problemCounts(
  rows: readonly ProblemCountRow[],
  foodSales: number
): ProblemCounts {
  const acc: Record<DishStatus, { dishes: number; sales: number }> = {
    aprobado: { dishes: 0, sales: 0 },
    estimado: { dishes: 0, sales: 0 },
    falta_precio: { dishes: 0, sales: 0 },
    borrador: { dishes: 0, sales: 0 },
    sin_receta: { dishes: 0, sales: 0 },
  };
  for (const row of rows) {
    const { status, sales } = pendingOf(row);
    if (!status || status === "aprobado") continue;
    acc[status].dishes += 1;
    acc[status].sales += sales;
  }
  const bucket = (st: DishStatus): ProblemBucket => ({
    dishes: acc[st].dishes,
    share: foodSales > 0 ? acc[st].sales / foodSales : 0,
  });
  return {
    falta_precio: bucket("falta_precio"),
    estimado: bucket("estimado"),
    borrador: bucket("borrador"),
    sin_receta: bucket("sin_receta"),
    problem_count: PROBLEM_STATUSES.reduce((n, st) => n + acc[st].dishes, 0),
  };
}
