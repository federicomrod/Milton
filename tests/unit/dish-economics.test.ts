// R1-09a: one loader for every dish's cost, status and coverage.
// Synthetic names and prices only.

import { describe, expect, it } from "vitest";
import type { CostingData } from "@/lib/restaurant/costing";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import {
  legacyMarginRows,
  periodCostKpisFromDishEconomics,
} from "@/lib/restaurant/costing/dish-economics-adapter";
import { evidenceLinesOf } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  latestPrice,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import { entry } from "./helpers/memory-editor-store";

const CO = "co-1";

function sale(
  productId: number,
  name: string,
  qty: number,
  net: number,
  extra = {}
) {
  return {
    company_id: CO,
    raw_item_name: name,
    quantity: qty,
    gross_revenue: net,
    net_revenue: net,
    source_metadata: { product_id: productId },
    ...extra,
  };
}

function link(
  productId: number,
  over: Partial<PosProductLinkRecord> = {}
): PosProductLinkRecord {
  return {
    company_id: CO,
    location_id: null,
    odoo_product_id: productId,
    odoo_name: `P${productId}`,
    classification: "plato_preparado",
    menu_item_id: null,
    link_state: "confirmado",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
    ...over,
  };
}

function input(
  id: string,
  over: Partial<VersionInput> & Pick<VersionInput, "quantity" | "unit">
): VersionInput {
  return {
    id,
    input_type: "ingredient",
    ingredient_id: null,
    component_id: null,
    unit_cost: null,
    cost_source: null,
    ...over,
  };
}

function costing(): CostingData {
  const entries = [
    entry("i-carne", "oz", 0.5),
    entry("i-frijol", "oz", 0.05),
    entry("i-aguacate", "lb", 1.6),
    // i-sal has no price at all.
  ];
  const byIngredient = new Map<string, typeof entries>();
  for (const e of entries) {
    byIngredient.set(e.ingredient_id, [
      ...(byIngredient.get(e.ingredient_id) ?? []),
      e,
    ]);
  }
  return {
    ingredientsById: new Map(
      [
        ["i-carne", "Carne", "oz"],
        ["i-frijol", "Frijol", "oz"],
        ["i-aguacate", "Aguacate", "lb"],
        ["i-sal", "Sal", "oz"],
      ].map(([id, name, unit]) => [id, { id, name, default_unit: unit }])
    ),
    componentsById: new Map([
      [
        "c-guaca",
        {
          id: "c-guaca",
          name: "Guacamole",
          output_unit: "oz",
          status: "active",
        },
      ],
    ]),
    componentRecipesByComponentId: new Map([
      [
        "c-guaca",
        {
          id: "cr-guaca",
          component_id: "c-guaca",
          output_quantity: 16,
          output_unit: "oz",
          status: "active",
        },
      ],
    ]),
    componentRecipeInputsByRecipeId: new Map([
      [
        "cr-guaca",
        [
          {
            input_type: "ingredient" as const,
            ingredient_id: "i-aguacate",
            component_id: null,
            quantity: 1,
            unit: "lb",
          },
        ],
      ],
    ]),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: byIngredient,
  };
}

function scenario() {
  const sales = [
    sale(1, "Churrasco", 10, 200),
    sale(2, "Borrador IA", 5, 50),
    sale(3, "Sin precio", 2, 30),
    sale(4, "Sin receta", 1, 20),
    sale(5, "Camiseta", 1, 10),
    sale(99, "Propina", 1, 15, { is_tip: true }),
  ];
  const links = [
    link(1, {
      menu_item_id: "m1",
      evidence: { excel_total: 4.2, lines: [] },
    }),
    link(2, { menu_item_id: "m2", link_state: "sugerido" }),
    link(3, { menu_item_id: "m3" }),
    link(5, { classification: "excluido" }),
  ];
  const versions: DishVersion[] = [
    {
      id: "v1",
      menu_item_id: "m1",
      version_number: 1,
      status: "approved",
      effective_date: null,
      approved_at: "2026-10-01T10:00:00Z",
    },
    {
      id: "v2",
      menu_item_id: "m2",
      version_number: 1,
      status: "in_review",
      effective_date: null,
      created_at: "2026-10-02T10:00:00Z",
    },
    {
      id: "v3",
      menu_item_id: "m3",
      version_number: 1,
      status: "approved",
      effective_date: null,
    },
  ];
  const inputsByVersionId = new Map<string, VersionInput[]>([
    [
      "v1",
      [
        // The Excel's own line cost wins over the catalog's $0.50/oz.
        input("a1", {
          ingredient_id: "i-carne",
          quantity: 6,
          unit: "oz",
          unit_cost: 0.6,
          cost_source: "PARRILLA!E8",
        }),
        input("a2", { ingredient_id: "i-frijol", quantity: 2, unit: "oz" }),
        // A preparation: 2 oz of guacamole at $1.60/16 oz.
        input("a3", {
          input_type: "component",
          component_id: "c-guaca",
          quantity: 2,
          unit: "oz",
        }),
      ],
    ],
    [
      "v2",
      [input("b1", { ingredient_id: "i-frijol", quantity: 4, unit: "oz" })],
    ],
    [
      "v3",
      [
        input("c1", { ingredient_id: "i-carne", quantity: 2, unit: "oz" }),
        input("c2", { ingredient_id: "i-sal", quantity: 1, unit: "oz" }),
      ],
    ],
  ]);
  const data = costing();
  const list = buildPosProductList({
    companyId: CO,
    sales,
    links,
    recipeVersions: versions.map((v) => ({
      menu_item_id: v.menu_item_id,
      status: v.status,
    })),
  });
  return buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId,
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
}

describe("buildDishEconomics", () => {
  const result = scenario();
  const byId = new Map(result.dishes.map((d) => [d.odoo_product_id, d]));

  it("gives each dish one status", () => {
    expect(byId.get(1)?.status).toBe("aprobado");
    expect(byId.get(2)?.status).toBe("estimado");
    expect(byId.get(3)?.status).toBe("falta_precio");
    expect(byId.get(4)?.status).toBe("sin_receta");
  });

  it("leaves tips and excluded products out of the dishes and the denominator", () => {
    expect(byId.has(99)).toBe(false);
    expect(byId.has(5)).toBe(false);
    expect(result.totals.food_net_sales).toBe(300);
    expect(result.totals.dish_count).toBe(4);
  });

  it("costs lines like the editor: Excel line cost, catalog price, preparation", () => {
    const dish = byId.get(1)!;
    // 6 × 0.60 + 2 × 0.05 + 2 × (1.60 / 16)
    expect(dish.unit_cost).toBeCloseTo(3.6 + 0.1 + 0.2, 10);
    expect(dish.lines).toHaveLength(3);
    expect(dish.lines[0].own_cost).toBe(true);
    expect(dish.lines[0].price_source).toBe("excel");
    expect(dish.lines[1].price_source).toBe("lista");
    expect(dish.lines[1].price_date).toBe("2026-04-01");
    expect(dish.cost_date).toBe("2026-10-01");
  });

  it("keeps the Excel COSTO TOTAL as a reference and flags a gap over $0.05", () => {
    const dish = byId.get(1)!;
    expect(dish.excel_total).toBe(4.2);
    expect(dish.excel_diff).toBeCloseTo(-0.3, 10);
    expect(dish.excel_diff_flag).toBe(true);
  });

  it("never turns a missing price into $0", () => {
    const dish = byId.get(3)!;
    expect(dish.unit_cost).toBeNull();
    expect(dish.food_cost_pct).toBeNull();
    expect(dish.lines_missing_price).toBe(1);
    expect(dish.covered).toBe(false);
    const row = legacyMarginRows(result).find((r) => r.odoo_product_id === 3)!;
    expect(row.cost.cost).toBeNull();
    expect(row.estimated_total_cost).toBeNull();
  });

  it("counts only approved, costed sales in coverage and COGS", () => {
    const t = result.totals;
    expect(t.covered_net_sales).toBe(200);
    expect(t.coverage_pct).toBe(66.7);
    expect(t.estimated_cogs).toBe(39);
    expect(t.food_cost_pct).toBe(19.5);
    expect(t.problem_count).toBe(2);
    expect(t.estimated_count).toBe(1);
    expect(periodCostKpisFromDishEconomics(result).coverage_pct).toBe(66.7);
  });

  it("reports the share of food sales per dish", () => {
    expect(byId.get(1)?.share_of_food_sales).toBeCloseTo(200 / 300, 10);
  });
});
