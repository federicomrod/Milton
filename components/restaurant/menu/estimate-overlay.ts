// «Estimado por Milton» (issue #212): pure helpers for showing the estimates
// SEPARATELY from the real figures. Nothing here feeds costing, coverage,
// COGS or any KPI: an estimate is a muted overlay, shown only for a dish that
// has no real cost, and a missing price is never $0.

import {
  estimatedMargin,
  type DishEstimateRow,
} from "@/lib/restaurant/menu-reading/estimate";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";

export const ESTIMATE_BADGE = "Estimado por Milton";
export const PRICE_ESTIMATE_BADGE = "Precio estimado";
export const ESTIMATE_BUTTON = "Estimar con Milton";
export const ESTIMATE_HELP =
  "Milton estima cuánto lleva cada plato y cuánto cuesta cada ingrediente en tu país. Son aproximaciones para que veas por dónde van tus márgenes; tú las validas.";
export const ESTIMATE_USE_BUTTON = "Usar como borrador";
export const ESTIMATE_MISSING_TABLE =
  "Falta aplicar la actualización de la base de datos (062).";

/** What the screen already knows about the dish's REAL numbers. */
export interface RealDishState {
  real_cost: number | null;
  has_approved_version?: boolean | null;
  link_confirmed?: boolean | null;
  excel_total?: number | null;
}

/**
 * The overlay is only for a dish with NO real cost: an approved recipe, a
 * confirmed link, an Excel recipe or any real cost hides it (and so does a
 * draft already made from the estimate).
 */
export function overlayAllowed(
  estimate: DishEstimateRow,
  real: RealDishState
): boolean {
  if (estimate.used_as_draft_at) return false;
  if (real.real_cost != null) return false;
  if (real.has_approved_version) return false;
  if (real.link_confirmed) return false;
  if (real.excel_total != null) return false;
  return true;
}

export interface EstimateText {
  cost: string;
  margin: string | null;
  /** «≈ $4.20 costo estimado · ≈ 62% margen estimado» */
  text: string;
}

export function estimateText(
  estimate: Pick<DishEstimateRow, "est_cost">,
  currency: string,
  avgNetPrice: number | null
): EstimateText {
  const cost =
    estimate.est_cost == null
      ? "≈ Sin precio"
      : `≈ ${formatMoneyEs(estimate.est_cost, currency)} costo estimado`;
  const pct = estimatedMargin(estimate.est_cost, avgNetPrice);
  const margin = pct == null ? null : `≈ ${Math.round(pct)}% margen estimado`;
  return { cost, margin, text: margin ? `${cost} · ${margin}` : cost };
}

/** The estimate of a POS product (by product or by its recipe). */
export function estimateForProduct(
  estimates: readonly DishEstimateRow[] | null | undefined,
  product: { odoo_product_id: number; menu_item_id?: string | null }
): DishEstimateRow | null {
  if (!estimates) return null;
  return (
    estimates.find(
      (e) =>
        e.odoo_product_id === product.odoo_product_id ||
        (product.menu_item_id != null &&
          e.menu_item_id === product.menu_item_id)
    ) ?? null
  );
}

/** The estimate of a menu dish, by any of its POS products. */
export function estimateForProducts(
  estimates: readonly DishEstimateRow[] | null | undefined,
  productIds: readonly (number | null)[]
): DishEstimateRow | null {
  if (!estimates || estimates.length === 0) return null;
  const wanted = new Set(
    productIds.filter((id): id is number => id !== null && id !== undefined)
  );
  return (
    estimates.find(
      (e) => e.odoo_product_id !== null && wanted.has(e.odoo_product_id)
    ) ?? null
  );
}

/**
 * Resumen: how many dishes MORE have an approximate margin thanks to an
 * estimate — an estimate with a cost, on a dish with no real cost. It never
 * touches the real coverage or margins.
 */
export function extraEstimatedDishes(
  estimates: readonly DishEstimateRow[] | null | undefined,
  dishes: ReadonlyArray<{
    product_id: number | null;
    cost_status: string;
    coverage: number;
    approved_count?: number;
  }>
): number {
  if (!estimates || estimates.length === 0) return 0;
  const withCost = new Set<number>();
  for (const e of estimates) {
    if (e.est_cost != null && !e.used_as_draft_at && e.odoo_product_id !== null)
      withCost.add(e.odoo_product_id);
  }
  let n = 0;
  for (const dish of dishes) {
    if (dish.product_id === null || !withCost.has(dish.product_id)) continue;
    const covered =
      dish.coverage > 0 ||
      (dish.approved_count ?? 0) > 0 ||
      dish.cost_status === "aprobado" ||
      dish.cost_status === "estimado";
    if (!covered) n += 1;
  }
  return n;
}

export function extraEstimatedLabel(n: number): string {
  return `Con estimados de Milton: ${n} ${n === 1 ? "plato más" : "platos más"} con margen aproximado`;
}
