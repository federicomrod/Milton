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
/** Shown on a plato marked «Estimado» when the Milton estimate is not displayed. */
export const ESTIMATE_HIDDEN_REASON =
  "Ya tiene costo real; no se muestra el estimado.";
/** «Estimado» with no Milton estimate row: the cost comes from an unapproved draft. */
export const ESTIMATE_DRAFT_REASON =
  "Calculado desde un borrador sin aprobar; aún no hay estimado de Milton.";
export const ESTIMATE_BUTTON = "Estimar con Milton";
export const ESTIMATE_HELP =
  "Milton estima cuánto lleva cada plato y cuánto cuesta cada ingrediente en tu país. Son aproximaciones para que veas por dónde van tus márgenes; tú las validas.";
export const ESTIMATE_USE_BUTTON = "Usar como borrador";
export const ESTIMATE_USE_SUCCESS = (n: number) =>
  `Listo: ${n} ${n === 1 ? "ingrediente estimado" : "ingredientes estimados"} en el borrador. Revísalos y aprueba.`;

/** The button can copy this estimate into a draft. Hide it otherwise. */
export function canUseEstimateAsDraft(
  estimate: Pick<DishEstimateRow, "lines" | "used_as_draft_at"> | null
): boolean {
  return Boolean(
    estimate && !estimate.used_as_draft_at && estimate.lines.length > 0
  );
}
export const ESTIMATE_MISSING_TABLE =
  "Falta aplicar la actualización de la base de datos (062).";

export const ESTIMATE_NO_ROLE_HINT =
  "Pídele a la persona dueña o administradora que cambie tu rol.";
export const ESTIMATE_UNAVAILABLE =
  "Las estimaciones aún no están activas en este ambiente.";
export const ESTIMATE_NOTHING_TO_DO =
  "Todos tus platos tienen receta. No hay nada que estimar.";
export const ESTIMATE_PROBE_FAILED = "No pude revisar tus platos.";
export const ESTIMATE_RETRY = "Reintentar";

/**
 * The ONE gate for reading the menu and estimating: the capability the API
 * routes enforce (`recipes.edit`), as the server sent it. Never a role rule,
 * never `can_submit`. Old fixtures without the map read as "not allowed".
 */
export function canEditRecipes(actor: {
  capabilities?: Record<string, boolean> | null;
}): boolean {
  return actor.capabilities?.["recipes.edit"] === true;
}

/** What the screen already knows about the dish's REAL numbers. */
export interface RealDishState {
  real_cost: number | null;
  has_approved_version?: boolean | null;
  /** Ignored: a Confirmado link does not hide an estimate. */
  link_confirmed?: boolean | null;
  excel_total?: number | null;
}

/**
 * The overlay is only for a dish with NO real cost: an approved recipe, an
 * Excel recipe or any real cost hides it (and so does a draft already made
 * from the estimate). A Confirmado link alone does not: it only says which
 * POS product the plato is.
 */
export function overlayAllowed(
  estimate: DishEstimateRow,
  real: RealDishState
): boolean {
  if (estimate.used_as_draft_at) return false;
  if (real.real_cost != null) return false;
  if (real.has_approved_version) return false;
  if (real.excel_total != null) return false;
  return true;
}

export interface EstimateText {
  cost: string;
  margin: string | null;
  /** «≈ $4.20 costo estimado · ≈ 62% margen estimado» */
  text: string;
  /** Parsed parts for styled rendering: numbers vs labels */
  parts: Array<{ value: string; isNumber: boolean }>;
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
  const text = margin ? `${cost} · ${margin}` : cost;

  // Parse for styled rendering: numbers in blue, labels in ink
  const parts: Array<{ value: string; isNumber: boolean }> = [];
  if (estimate.est_cost == null) {
    parts.push({ value: "≈ Sin precio", isNumber: false });
  } else {
    const money = formatMoneyEs(estimate.est_cost, currency);
    parts.push({ value: "≈ ", isNumber: false });
    parts.push({ value: money, isNumber: true });
    parts.push({ value: " costo estimado", isNumber: false });
    if (margin) {
      parts.push({ value: " · ≈ ", isNumber: false });
      parts.push({ value: `${Math.round(pct!)}%`, isNumber: true });
      parts.push({ value: " margen estimado", isNumber: false });
    }
  }

  return { cost, margin, text, parts };
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

/** What the person reads when one plato could not be estimated. */
export function estimateSkipMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "has_recipe":
    case "approved":
      return "Este plato ya tiene receta; Milton no la cambia.";
    case "no_encontrado":
      return "No encontré ese plato.";
    case "error_guardado":
      return "No pude guardar el estimado. Intenta de nuevo.";
    default:
      return "No pude estimar este plato. Intenta de nuevo.";
  }
}
