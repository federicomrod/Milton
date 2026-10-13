import { describe, expect, it } from "vitest";
import {
  confirmPosProductLink,
  unlinkedPosProduct,
} from "@/lib/restaurant/pos-product-links";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import { lineCostDisplay } from "@/lib/restaurant/recipe-costing/format";
import { toReviewLine } from "@/lib/restaurant/recipe-costing/review";
import { parseSuggestionEvidence } from "@/lib/restaurant/recipe-costing/evidence";
import {
  buildRecipeCostingWorkspace,
  rankedProductsFromLinks,
} from "@/lib/restaurant/recipe-costing/workspace";

function product(
  partial: Partial<RankedPosProduct> &
    Pick<RankedPosProduct, "odoo_product_id" | "odoo_name" | "net_sales">
): RankedPosProduct {
  const classification = partial.classification ?? "plato_preparado";
  const treatment =
    partial.treatment ??
    (classification === "por_clasificar" && partial.is_combo
      ? "combo"
      : classification);
  return {
    share_of_net_sales: 0,
    units_sold: 0,
    category: null,
    is_combo: false,
    components: [],
    excluded_parts: [],
    classification_label: "Plato preparado",
    suggested_treatment: null,
    in_food_sales: TREATMENT_RULES[treatment].in_food_sales,
    share_of_food_sales: partial.share_of_net_sales ?? 0,
    link_state: "sin_vincular",
    link_state_label: "Sin vincular",
    menu_item_id: null,
    counts_toward_coverage: false,
    ...partial,
    classification,
    treatment,
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

  it("shows gram costs per kg like the mockup", () => {
    const line = toReviewLine({
      source_row: 48,
      raw_name: "Pechuga de pollo",
      ingredient_match: null,
      sub_recipe_match: null,
      qty: 200,
      unit: "g",
      unit_cost: 0.0062,
      flags: ["ok"],
      pending: false,
      reasons: [],
    });
    expect(line.unit_cost_label).toMatch(/\$6\.20 \/ kg/);
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
      view: "plato",
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
      view: "plato",
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
    expect(workspace.setup_checklist.map((c) => c.id)).toEqual([
      "pos",
      "excel",
      "platos",
    ]);
    expect(workspace.coverage.goal_pct).toBe(90);
    expect(workspace.coverage.goal_reached).toBe(false);
    expect(workspace.products).toHaveLength(2);
    const pollo = workspace.products.find((row) => row.odoo_product_id === 1);
    const pendingLine = pollo?.preview_lines.find((line) => line.pending);
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
      view: "plato",
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

describe("Validar slim product list", () => {
  it("builds editor stubs from links without scanning 410 sales rows", () => {
    const links = Array.from({ length: 410 }, (_, index) => ({
      ...unlinkedPosProduct({
        company_id: "co-a",
        odoo_product_id: index + 1,
        odoo_name: `Plato ${index + 1}`,
      }),
    }));
    const started = Date.now();
    const products = rankedProductsFromLinks(links, 7);
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: null,
      currency: "USD",
      periodLabel: null,
      view: "plato",
      actor: { user_id: "u", role: "owner", is_milton_staff: false },
      products,
      links,
      versions: [],
      menuItems: [],
      batches: [],
      coveragePct: 0,
      netSales: 0,
      coveredNetSales: 0,
      selectedOdooProductId: 7,
      timings: { load_ms: Date.now() - started, path: "plato_editor" },
    });
    const elapsed = Date.now() - started;
    expect(workspace.products).toHaveLength(410);
    expect(workspace.editor?.odoo_product_id).toBe(7);
    expect(workspace.timings?.path).toBe("plato_editor");
    expect(elapsed).toBeLessThan(200);
  });
});

describe("unbound name-only suggestion", () => {
  it("does not treat an empty exact-name leftover as Confirmable", () => {
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: null,
      currency: "USD",
      periodLabel: null,
      view: "plato",
      actor: { user_id: "u", role: "owner", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 7576,
          odoo_name: "Parrillada Pinolera (3 personas)",
          net_sales: 6161,
          share_of_net_sales: 0.045,
          link_state: "sugerido",
          link_state_label: "Sugerido",
          menu_item_id: "menu-empty",
        }),
      ],
      links: [
        {
          ...unlinkedPosProduct({
            company_id: "co-a",
            odoo_product_id: 7576,
            odoo_name: "Parrillada Pinolera (3 personas)",
          }),
          menu_item_id: "menu-empty",
          link_state: "sugerido",
          evidence: { block_name: "Parrillada Pinolera (3 personas)" },
        },
      ],
      versions: [
        {
          id: "ver-empty",
          recipe_id: "rec-empty",
          menu_item_id: "menu-empty",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          notes: "Borrador",
        },
      ],
      menuItems: [
        { id: "menu-empty", name: "Parrillada Pinolera (3 personas)" },
      ],
      batches: [],
      coveragePct: 0,
      netSales: 6161,
      coveredNetSales: 0,
      selectedOdooProductId: 7576,
    });
    const row = workspace.products[0];
    expect(row?.suggestion_bound).toBe(false);
    expect(row?.can_confirm_suggestion).toBe(false);
    expect(row?.action_label).not.toBe("Confirmar");
    expect(row?.evidence_label).toMatch(/no trae ingredientes/i);
    expect(workspace.editor?.checklist.ready).toBe(false);
    expect(
      workspace.editor?.checklist.items.find((item) => item.id === "excel")
        ?.label
    ).toBe("Sin dato de Excel para comparar");
    expect(workspace.todos[0]?.kind).toBe("sin_receta");
  });
});

describe("visual product kinds and display states", () => {
  it("labels drinks, combos and missing recipes like the mockup", () => {
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: "Los Ranchos",
      currency: "USD",
      periodLabel: null,
      view: "resumen",
      actor: { user_id: "u", role: "owner", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 1,
          odoo_name: "Pollo empanizado",
          net_sales: 80,
          units_sold: 401,
          category: "Platos fuertes",
          share_of_net_sales: 0.8,
        }),
        product({
          odoo_product_id: 2,
          odoo_name: "Coca-Cola 12 oz",
          net_sales: 10,
          units_sold: 1320,
          category: "Bebidas",
          classification: "reventa",
          classification_label: "Reventa",
          share_of_net_sales: 0.1,
        }),
        product({
          odoo_product_id: 3,
          odoo_name: "Combo familiar",
          net_sales: 10,
          is_combo: true,
          share_of_net_sales: 0.1,
        }),
      ],
      links: [],
      versions: [],
      menuItems: [],
      batches: [],
      coveragePct: 0,
      netSales: 100,
      coveredNetSales: 0,
    });
    const plato = workspace.products.find((row) => row.odoo_product_id === 1);
    const bebida = workspace.products.find((row) => row.odoo_product_id === 2);
    const combo = workspace.products.find((row) => row.odoo_product_id === 3);
    expect(plato?.kind_label).toBe("Plato");
    expect(plato?.units_label).toMatch(/401/);
    expect(bebida?.kind_label).toBe("Bebida");
    expect(bebida?.display_state_label).toBe("Reventa");
    expect(combo?.display_state_label).toBe("Combo");
    expect(combo?.action_label).toBe("Ver partes");
    expect(
      workspace.classification.find((row) => row.id === "reventa")?.count
    ).toBe(1);
    expect(plato?.action_label).toBe("Crear receta");
  });

  it("keeps combos with parts and no-cost products out of Qué falta", () => {
    const workspace = buildRecipeCostingWorkspace({
      companyId: "co-a",
      companyName: "Los Ranchos",
      currency: "USD",
      periodLabel: null,
      view: "resumen",
      actor: { user_id: "u", role: "owner", is_milton_staff: false },
      products: [
        product({
          odoo_product_id: 1,
          odoo_name: "Combo familiar",
          net_sales: 10,
          is_combo: true,
          components: [
            { odoo_product_id: 9, odoo_name: "Carne", net_sales: 8 },
          ],
        }),
        product({
          odoo_product_id: 2,
          odoo_name: "Sin cebolla",
          net_sales: 4,
          classification: "modificador_sin_costo",
        }),
        product({
          odoo_product_id: 4,
          odoo_name: "Propina",
          net_sales: 5,
          classification: "excluido",
        }),
        product({
          odoo_product_id: 3,
          odoo_name: "Sopa de res",
          net_sales: 6,
        }),
      ],
      links: [],
      versions: [],
      menuItems: [],
      batches: [],
      coveragePct: 0,
      netSales: 20,
      coveredNetSales: 0,
    });
    expect(workspace.todos.map((row) => row.odoo_name)).toEqual([
      "Sopa de res",
    ]);
    expect(workspace.todos[0]?.action_label).toBe("Crear receta");
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
