// R1-09c: what Platos shows before the server answers. Synthetic data.

import { describe, expect, it } from "vitest";
import {
  markApproved,
  nextToReview,
  summaryFromEditorState,
  withDishSummary,
} from "@/lib/restaurant/recipe-costing/optimistic";
import type {
  DishSummary,
  PlatoQueueRow,
  RecipeCostingWorkspace,
} from "@/lib/restaurant/recipe-costing/workspace";

function summary(over: Partial<DishSummary> = {}): DishSummary {
  return {
    odoo_product_id: 1,
    name: "Plato",
    raw_names: ["Plato"],
    menu_item_id: "m1",
    category: null,
    treatment: "plato_preparado",
    is_combo: false,
    status: "estimado",
    status_label: "Estimado",
    unit_cost: 4,
    cost_source: "borrador",
    cost_date: null,
    recipe_version_id: "v1",
    excel_total: 4,
    excel_diff: 0,
    excel_diff_flag: false,
    units_sold: 10,
    net_sales: 200,
    share_of_food_sales: 0.5,
    avg_net_price: 20,
    food_cost_pct: 20,
    unit_margin: 16,
    covered: false,
    in_cogs: false,
    lines_missing_price: 0,
    ...over,
  };
}

function row(id: number, over: Partial<PlatoQueueRow> = {}): PlatoQueueRow {
  return {
    odoo_product_id: id,
    odoo_name: `P${id}`,
    share_label: "1%",
    status: "borrador",
    status_label: "Estimado",
    status_tone: "pur",
    dish_status: "estimado",
    ...over,
  };
}

function workspace(): RecipeCostingWorkspace {
  return {
    plato_queue: [
      row(1),
      row(2, { dish_status: "aprobado", status: "listo" }),
      row(3),
    ],
    dish_summaries: [summary(), summary({ odoo_product_id: 3 })],
    selected_dish: summary(),
  } as unknown as RecipeCostingWorkspace;
}

describe("optimistic Platos", () => {
  it("follows the editor's total, and a missing price is never $0", () => {
    const priced = summaryFromEditorState(summary(), {
      total_cost: 5,
      pending: 0,
      lines: [{}, {}] as never,
      editable: true,
    });
    expect(priced).toMatchObject({
      unit_cost: 5,
      food_cost_pct: 25,
      unit_margin: 15,
      status: "estimado",
    });
    expect(priced.excel_diff_flag).toBe(true);
    const missing = summaryFromEditorState(summary(), {
      total_cost: null,
      pending: 1,
      lines: [{}] as never,
      editable: true,
    });
    expect(missing).toMatchObject({
      unit_cost: null,
      status: "falta_precio",
      lines_missing_price: 1,
    });
  });

  it("never changes an approved dish's number from a draft edit", () => {
    const approved = summary({ status: "aprobado" });
    expect(
      summaryFromEditorState(approved, {
        total_cost: 9,
        pending: 0,
        lines: [{}] as never,
        editable: true,
      })
    ).toBe(approved);
  });

  it("marks a dish approved at once and moves to the next one to review", () => {
    const next = markApproved(workspace(), 1);
    const r1 = next.plato_queue.find((r) => r.odoo_product_id === 1)!;
    expect(r1).toMatchObject({
      dish_status: "aprobado",
      status: "listo",
      status_label: "20%",
    });
    expect(nextToReview(workspace().plato_queue, 1)).toBe(3);
    expect(nextToReview(next.plato_queue, 3)).toBeNull();
  });

  it("puts one dish's numbers in the list and its chip", () => {
    const next = withDishSummary(
      workspace(),
      summary({ odoo_product_id: 3, status: "falta_precio", unit_cost: null })
    );
    expect(next.plato_queue.find((r) => r.odoo_product_id === 3)).toMatchObject(
      {
        dish_status: "falta_precio",
        status_label: "Falta precio",
        status_tone: "warn",
      }
    );
  });
});
