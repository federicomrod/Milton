// lib/restaurant/recipe-costing/optimistic.ts
//
// What Platos shows right away, before the server answers (R1-09c). Pure.
// The server's answer always replaces it; on an error the screen rolls
// back to what it had. Same rules as the shared loader: a line without a
// price leaves the cost unknown ("Sin precio"), never $0.

import type { EditorState } from "./editor-service";
import type {
  DishSummary,
  PlatoQueueRow,
  RecipeCostingWorkspace,
} from "./workspace";
import { dishStateFrom } from "@/lib/restaurant/costing/dish-state";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import {
  CLASSIFICATION_LABELS,
  type PosProductClassification,
} from "@/lib/restaurant/pos-product-links";
import {
  DISH_STATUS_LABELS,
  type DishStatus,
} from "@/lib/restaurant/costing/dish-status";

const TONE: Record<DishStatus, PlatoQueueRow["status_tone"]> = {
  aprobado: "ok",
  estimado: "pur",
  falta_precio: "warn",
  sin_receta: "grey",
};

function chipFor(
  status: DishStatus,
  foodCostPct: number | null
): Pick<PlatoQueueRow, "status_label" | "status_tone"> {
  return {
    status_label:
      status === "aprobado" && foodCostPct !== null
        ? `${Math.round(foodCostPct)}%`
        : DISH_STATUS_LABELS[status],
    status_tone: TONE[status],
  };
}

/** The open draft's cost as the editor computes it after each edit. */
export function summaryFromEditorState(
  summary: DishSummary,
  state: Pick<EditorState, "total_cost" | "pending" | "lines" | "editable">
): DishSummary {
  // The header follows the APPROVED version in force. While a newer draft is
  // being edited it keeps the approved number; when the editor shows the
  // approved version itself (read-only), a price, conversion or unit fix
  // updates the table AND the header: the same rule as the server
  // (dish-state.ts) over the editor's live lines.
  const hasApprovedInForce =
    summary.has_approved_version === true ||
    (summary.status === "aprobado" && summary.has_approved_version == null);
  if (hasApprovedInForce && state.editable) return summary;
  if (!hasApprovedInForce && !state.editable) return summary;
  const next = dishStateFrom({
    has_version: true,
    line_count: state.lines.length,
    missing: state.pending,
    total: state.lines.length > 0 ? state.total_cost : null,
    approved: hasApprovedInForce,
    confirmed: hasApprovedInForce
      ? (summary.link_confirmed ?? summary.state_reason == null)
      : summary.covered,
    treatment: summary.treatment,
    combo_covered: false,
    in_food_sales: true,
    avg_net_price: summary.avg_net_price,
  });
  const unitCost = next.unit_cost;
  const price = summary.avg_net_price;
  return {
    ...summary,
    covered: next.covered,
    in_cogs: next.in_cogs,
    status: next.status,
    status_label: next.status_label,
    state_reason: next.reason,
    unit_cost: unitCost,
    food_cost_pct: next.food_cost_pct,
    unit_margin: unitCost !== null && price !== null ? price - unitCost : null,
    excel_diff:
      unitCost !== null && summary.excel_total !== null
        ? unitCost - summary.excel_total
        : null,
    excel_diff_flag:
      unitCost !== null &&
      summary.excel_total !== null &&
      Math.abs(unitCost - summary.excel_total) > 0.05,
    lines_missing_price: state.pending,
  };
}

/** Put one dish's new numbers into the list and its chip. */
export function withDishSummary(
  data: RecipeCostingWorkspace,
  summary: DishSummary
): RecipeCostingWorkspace {
  const id = summary.odoo_product_id;
  return {
    ...data,
    selected_dish:
      data.selected_dish?.odoo_product_id === id ? summary : data.selected_dish,
    dish_summaries:
      data.dish_summaries?.map((d) =>
        d.odoo_product_id === id ? summary : d
      ) ?? null,
    plato_queue: data.plato_queue.map((row) =>
      row.odoo_product_id === id
        ? {
            ...row,
            dish_status: summary.status,
            ...chipFor(summary.status, summary.food_cost_pct),
          }
        : row
    ),
  };
}

/** "Aprobar": the dish shows as approved at once (rolled back on error). */
export function markApproved(
  data: RecipeCostingWorkspace,
  odooProductId: number
): RecipeCostingWorkspace {
  const summary =
    data.dish_summaries?.find((d) => d.odoo_product_id === odooProductId) ??
    (data.selected_dish?.odoo_product_id === odooProductId
      ? data.selected_dish
      : null);
  // «Aprobar» approves the recipe AND confirms the POS link (two steps on the
  // server). What the dish becomes is the server's rule (dish-state.ts) applied
  // to what is on screen: every line priced → «Aprobado» (covered, in COGS);
  // a line without price stays «Falta precio». Nothing is hand-set here.
  const resolved = summary
    ? dishStateFrom({
        has_version: summary.status !== "sin_receta",
        line_count: summary.status === "sin_receta" ? 0 : 1,
        missing: summary.lines_missing_price,
        total:
          summary.lines_missing_price > 0 || summary.unit_cost === null
            ? null
            : summary.unit_cost,
        approved: true,
        confirmed: true,
        treatment: summary.treatment,
        combo_covered: summary.treatment === "combo",
        in_food_sales: true,
        avg_net_price: summary.avg_net_price,
      })
    : null;
  const next = withDishSummary(
    data,
    summary && resolved
      ? {
          ...summary,
          status: resolved.status,
          status_label: resolved.status_label,
          state_reason: resolved.reason,
          unit_cost: resolved.unit_cost,
          food_cost_pct: resolved.food_cost_pct,
          covered: resolved.covered,
          in_cogs: resolved.in_cogs,
        }
      : ({
          odoo_product_id: odooProductId,
        } as DishSummary)
  );
  const status = resolved?.status ?? "aprobado";
  return {
    ...next,
    plato_queue: next.plato_queue.map((row) =>
      row.odoo_product_id === odooProductId
        ? {
            ...row,
            status: status === "aprobado" ? "listo" : row.status,
            dish_status: status,
          }
        : row
    ),
  };
}

/** The next dish still to review, top sellers first, after this one. */
export function nextToReview(
  queue: readonly PlatoQueueRow[],
  afterOdooProductId: number
): number | null {
  const pending = (row: PlatoQueueRow) =>
    row.odoo_product_id !== afterOdooProductId &&
    row.dish_status !== "aprobado" &&
    row.status !== "listo";
  const index = queue.findIndex(
    (r) => r.odoo_product_id === afterOdooProductId
  );
  const after = queue.slice(index + 1).find(pending);
  return (after ?? queue.find(pending))?.odoo_product_id ?? null;
}

/**
 * Choosing how a product is costed (Plato preparado, Reventa, Combo,
 * Excluido…): the product row and the queue change on screen at once; the
 * save runs in the background and the caller rolls back on an error. Nothing
 * is refetched. A treatment that needs no recipe leaves the queue.
 */
export function withTreatment(
  data: RecipeCostingWorkspace,
  odooProductId: number,
  treatment: PosProductClassification
): RecipeCostingWorkspace {
  const rule = TREATMENT_RULES[treatment];
  const patch = <
    T extends {
      odoo_product_id: number;
      treatment: PosProductClassification;
    },
  >(
    row: T
  ): T =>
    row.odoo_product_id === odooProductId
      ? {
          ...row,
          treatment,
          treatment_label: rule.label,
          classification: treatment,
          classification_label: CLASSIFICATION_LABELS[treatment],
          in_food_sales: rule.in_food_sales,
        }
      : row;
  const leavesQueue = !rule.needs_recipe && treatment !== "combo";
  return {
    ...data,
    products: data.products.map(patch),
    selected: data.selected ? patch(data.selected) : data.selected,
    plato_queue: leavesQueue
      ? data.plato_queue.filter((row) => row.odoo_product_id !== odooProductId)
      : data.plato_queue,
  };
}
