import { describe, expect, it } from "vitest";
import {
  confirmPosProductLink,
  unlinkedPosProduct,
} from "@/lib/restaurant/pos-product-links";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { lineCostDisplay } from "@/lib/restaurant/recipe-costing/format";
import {
  applyInlineLineFix,
  groupUncertainByTab,
  toReviewLine,
} from "@/lib/restaurant/recipe-costing/review";
import { parseSuggestionEvidence } from "@/lib/restaurant/recipe-costing/evidence";
import {
  buildRecipeCostingWorkspace,
  matchesVincularFilter,
} from "@/lib/restaurant/recipe-costing/workspace";

function product(
  partial: Partial<RankedPosProduct> &
    Pick<RankedPosProduct, "odoo_product_id" | "odoo_name" | "net_sales">
): RankedPosProduct {
  return {
    share_of_net_sales: 0,
    is_combo: false,
    components: [],
    classification: "requiere_receta",
    classification_label: "Requiere receta",
    link_state: "sin_vincular",
    link_state_label: "Sin vincular",
    menu_item_id: null,
    counts_toward_coverage: false,
    ...partial,
  };
}

describe("pending lines never show $0", () => {
  it("renders Pendiente instead of $0 when the cost is missing", () => {
    const pending = lineCostDisplay({ pending: true, unit_cost: null });
    expect(pending.label).toBe("Pendiente");
    expect(pending.amount).toBeNull();
    expect(pending.label).not.toMatch(/\$0/);

    const zeroish = lineCostDisplay({ pending: true, unit_cost: 0 });
    expect(zeroish.label).toBe("Pendiente");
    expect(zeroish.amount).toBeNull();

    const line = toReviewLine({
      source_row: 12,
      raw_name: "QUESILLO",
      ingredient_match: null,
      sub_recipe_match: null,
      qty: 1,
      unit: "g",
      unit_cost: null,
      flags: ["pendiente_costo"],
      pending: true,
      reasons: [
        "esta línea quedó pendiente: falta el costo de QUESILLO. No puse $0",
      ],
    });
    expect(line.cost_label).toBe("Pendiente");
    expect(line.unit_cost).toBeNull();
  });
});

describe("review grouped by tab", () => {
  it("shows only uncertain items and a summary line per tab", () => {
    const tabs = groupUncertainByTab([
      {
        odoo_product_id: 1,
        odoo_name: "Pollo",
        menu_item_id: "m1",
        recipe_version_id: "v1",
        tab: "PLATOS",
        block_name: "Pollo",
        filename: "recetas.xlsx",
        pending: true,
        excel_match: "mismatch",
        reason: "Revisa el rendimiento",
        milton_cost_label: null,
        excel_total_label: "$3.80",
        lines: [],
      },
      {
        odoo_product_id: 2,
        odoo_name: "Salsa",
        menu_item_id: "m2",
        recipe_version_id: "v2",
        tab: "SALSAS",
        block_name: "Salsa",
        filename: "recetas.xlsx",
        pending: false,
        excel_match: "match",
        reason: "",
        milton_cost_label: "$1.00",
        excel_total_label: "$1.00",
        lines: [],
      },
    ]);
    expect(tabs).toHaveLength(2);
    const platos = tabs.find((tab) => tab.tab === "PLATOS");
    expect(platos?.summary).toMatch(/rendimiento|revisar/i);
    const salsas = tabs.find((tab) => tab.tab === "SALSAS");
    expect(salsas?.cuadra_con_excel).toBe(true);
    expect(salsas?.summary).toBe("Cuadra con Excel");
  });

  it("keeps a price fixed inline marked as a real amount", () => {
    const next = applyInlineLineFix(
      {
        source_row: 1,
        raw_name: "QUESILLO",
        ingredient_match: "QUESILLO",
        sub_recipe_match: null,
        qty: 1,
        unit: "g",
        unit_cost: null,
        flags: ["pendiente_costo"],
        pending: true,
        reasons: ["falta el costo"],
      },
      { unit_cost: 0.4 }
    );
    expect(next.pending).toBe(false);
    expect(next.unit_cost).toBe(0.4);
  });
});

describe("recipe costing workspace resume", () => {
  it("keeps a confirmed link after rebuild so you can leave and come back", () => {
    const suggested = {
      ...unlinkedPosProduct({
        company_id: "co-a",
        odoo_product_id: 55,
        odoo_name: "Hamburguesa",
      }),
      menu_item_id: "menu-1",
      link_state: "sugerido" as const,
      evidence: {
        tab: "PLATOS",
        block_name: "Hamburguesa",
        pending: false,
        lines: [],
      },
    };
    const confirmed = confirmPosProductLink(suggested, {
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T18:00:00.000Z",
      confirmed_how: "en_pantalla",
    });
    const first = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: "Los Ranchos",
      currency: "USD",
      periodLabel: "1 jul - 31 jul 2026",
      view: "vincular",
      actor: { user_id: "user-1", role: "owner", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 55,
          odoo_name: "Hamburguesa",
          net_sales: 100,
          share_of_net_sales: 1,
          link_state: confirmed.link_state,
          link_state_label: "Confirmado",
          menu_item_id: "menu-1",
          counts_toward_coverage: false,
        }),
      ],
      links: [confirmed],
      versions: [
        {
          id: "ver-1",
          recipe_id: "rec-1",
          menu_item_id: "menu-1",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          notes: "Borrador",
        },
      ],
      menuItems: [{ id: "menu-1", name: "Hamburguesa" }],
      batches: [],
      coveragePct: 0,
      netSales: 100,
      coveredNetSales: 0,
      selectedOdooProductId: 55,
    });
    expect(first.selected?.link_state).toBe("confirmado");
    expect(first.selected?.can_undo).toBe(true);
    expect(first.products[0]?.confirmed).toBe(true);
    expect(first.who_approves).toMatch(/Los Ranchos/);
    expect(first.footer).toMatch(/POS/);

    const resumed = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: "Los Ranchos",
      currency: "USD",
      periodLabel: null,
      view: "vincular",
      actor: { user_id: "user-1", role: "owner", is_milton_staff: false },
      products: first.products.map((row) =>
        product({
          odoo_product_id: row.odoo_product_id,
          odoo_name: row.odoo_name,
          net_sales: row.net_sales,
          share_of_net_sales: 1,
          link_state: "confirmado",
          link_state_label: "Confirmado",
          menu_item_id: row.menu_item_id,
        })
      ),
      links: [confirmed],
      versions: [],
      menuItems: [{ id: "menu-1", name: "Hamburguesa" }],
      batches: [],
      coveragePct: 0,
      netSales: 100,
      coveredNetSales: 0,
      selectedOdooProductId: 55,
    });
    expect(resumed.selected?.odoo_product_id).toBe(55);
    expect(resumed.selected?.link_state).toBe("confirmado");
  });

  it("sorts the to-do by share of sales and keeps coverage math on the server DTO", () => {
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: null,
      currency: "USD",
      periodLabel: null,
      view: "resumen",
      actor: { user_id: "user-1", role: "manager", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 2,
          odoo_name: "Sopa",
          net_sales: 20,
          share_of_net_sales: 0.2,
        }),
        product({
          odoo_product_id: 1,
          odoo_name: "Pollo",
          net_sales: 80,
          share_of_net_sales: 0.8,
          link_state: "sugerido",
          link_state_label: "Sugerido",
          menu_item_id: "m1",
        }),
      ],
      links: [
        {
          ...unlinkedPosProduct({
            company_id: "co-a",
            odoo_product_id: 1,
            odoo_name: "Pollo",
          }),
          menu_item_id: "m1",
          link_state: "sugerido",
          evidence: {
            tab: "PLATOS",
            block_name: "Pollo empanizado",
            pending: true,
            excel_match: "mismatch",
            milton_cost: 2.54,
            excel_total: 3.8,
            reasons: ["Revisa el rendimiento de Empanizado."],
            lines: [
              {
                raw_name: "Empanizado",
                qty: 1,
                unit: "porción",
                unit_cost: null,
                pending: true,
                flags: ["pendiente_costo"],
              },
            ],
          },
        },
      ],
      versions: [],
      menuItems: [{ id: "m1", name: "Pollo empanizado" }],
      batches: [],
      coveragePct: 41,
      netSales: 100,
      coveredNetSales: 41,
    });
    expect(workspace.todos[0]?.odoo_name).toBe("Pollo");
    expect(workspace.todos[0]?.share_label).toBe("80%");
    expect(workspace.coverage.coverage_label).toBe("41%");
    expect(workspace.actor.can_approve).toBe(false);
    expect(workspace.actor.can_submit).toBe(true);
    expect(workspace.stepper).toHaveLength(4);
    expect(workspace.filter_counts.todos).toBe(2);
    const vincular = workspace.products.find(
      (row) => row.odoo_product_id === 1
    );
    expect(vincular && matchesVincularFilter(vincular, "por_resolver")).toBe(
      true
    );
    expect(workspace.review_tabs[0]?.tab).toBe("PLATOS");
    const pendingLine = workspace.review_tabs[0]?.items[0]?.lines[0];
    expect(pendingLine?.cost_label).toBe("Pendiente");
    expect(pendingLine?.aporte_label).toBe("Pendiente");
    expect(JSON.stringify(workspace)).not.toMatch(/"\$0"/);
  });

  it("computes aporte from qty × unit cost and never $0 on a pending line", () => {
    const priced = toReviewLine(
      {
        source_row: 1,
        raw_name: "Pechuga",
        ingredient_match: "Pechuga",
        sub_recipe_match: null,
        qty: 0.2,
        unit: "kg",
        unit_cost: 6.2,
        flags: ["ok"],
        pending: false,
        reasons: [],
      },
      "USD",
      2.54
    );
    expect(priced.aporte).toBe(1.24);
    expect(priced.aporte_label).toMatch(/1[.,]24/);
    expect(priced.dish_pct_label).toBe("49%");
  });

  it("shows a combo as one product", () => {
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: null,
      currency: "USD",
      periodLabel: null,
      view: "vincular",
      actor: { user_id: "u", role: "owner", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 1301,
          odoo_name: "Combo familiar",
          net_sales: 4410,
          share_of_net_sales: 0.05,
          is_combo: true,
          components: [
            { odoo_product_id: 9, odoo_name: "Carne", net_sales: 2000 },
            { odoo_product_id: 8, odoo_name: "Arroz", net_sales: 2410 },
          ],
        }),
      ],
      links: [],
      versions: [],
      menuItems: [],
      batches: [],
      coveragePct: 0,
      netSales: 4410,
      coveredNetSales: 0,
    });
    expect(workspace.products).toHaveLength(1);
    expect(workspace.products[0]?.is_combo).toBe(true);
    expect(workspace.products[0]?.components).toHaveLength(2);
  });
});

describe("suggestion evidence pending cost", () => {
  it("does not keep a $0 unit cost on a pending line", () => {
    const evidence = parseSuggestionEvidence({
      lines: [
        {
          raw_name: "QUESILLO",
          qty: 1,
          unit: "g",
          unit_cost: 0,
          pending: true,
          flags: ["pendiente_costo"],
        },
      ],
    });
    expect(evidence.lines[0]?.unit_cost).toBeNull();
    expect(evidence.lines[0]?.pending).toBe(true);
  });
});
