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
  // An approved dish is costed with its approved version; edits go to a
  // new draft and do not change the number in force.
  if (summary.status === "aprobado" || !state.editable) return summary;
  const unitCost =
    state.lines.length > 0 && state.total_cost !== null
      ? state.total_cost
      : null;
  const status: DishStatus =
    state.lines.length === 0
      ? "sin_receta"
      : unitCost === null
        ? "falta_precio"
        : "estimado";
  const price = summary.avg_net_price;
  return {
    ...summary,
    status,
    status_label: DISH_STATUS_LABELS[status],
    unit_cost: unitCost,
    food_cost_pct:
      unitCost !== null && price !== null && price > 0
        ? (unitCost / price) * 100
        : null,
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
  const next = withDishSummary(
    data,
    summary
      ? {
          ...summary,
          status: "aprobado",
          status_label: DISH_STATUS_LABELS.aprobado,
          covered: true,
          in_cogs: summary.unit_cost !== null,
        }
      : ({
          odoo_product_id: odooProductId,
        } as DishSummary)
  );
  return {
    ...next,
    plato_queue: next.plato_queue.map((row) =>
      row.odoo_product_id === odooProductId
        ? { ...row, status: "listo", dish_status: "aprobado" }
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
