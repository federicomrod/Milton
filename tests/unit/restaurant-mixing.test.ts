// #237 review, item 3: with "Todos los restaurantes", each restaurant's
// sales are costed only with its own link or the shared one. A product
// linked only in restaurant A never applies A's recipe to B's sales.
// Synthetic names and prices only.

import { describe, expect, it } from "vitest";
import type { CostingData } from "@/lib/restaurant/costing";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import { moveVariantLocally } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { evidenceLinesOf } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  latestPrice,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import { entry } from "./helpers/memory-editor-store";

const CO = "co-1";
const A = "loc-a";
const B = "loc-b";

function sale(
  productId: number,
  name: string,
  qty: number,
  net: number,
  location: string | null
) {
  return {
    company_id: CO,
    location_id: location,
    raw_item_name: name,
    quantity: qty,
    gross_revenue: net,
    net_revenue: net,
    source_metadata: { product_id: productId },
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

// m-a: 6 oz carne = $3.00 (approved). m-shared: 2 oz carne = $1.00.
const versions: DishVersion[] = [
  {
    id: "v-a",
    menu_item_id: "m-a",
    version_number: 1,
    status: "approved",
    effective_date: null,
  },
  {
    id: "v-shared",
    menu_item_id: "m-shared",
    version_number: 1,
    status: "approved",
    effective_date: null,
  },
];
const inputsByVersionId = new Map<string, VersionInput[]>([
  ["v-a", [input("a1", { ingredient_id: "i-carne", quantity: 6, unit: "oz" })]],
  [
    "v-shared",
    [input("s1", { ingredient_id: "i-carne", quantity: 2, unit: "oz" })],
  ],
]);

function run(
  sales: ReturnType<typeof sale>[],
  links: PosProductLinkRecord[],
  locationId: string | null = null
) {
  const data = costing();
  const list = buildPosProductList({
    companyId: CO,
    sales,
    links,
    recipeVersions: versions.map((v) => ({
      menu_item_id: v.menu_item_id,
      status: v.status,
    })),
    locationId,
  });
  const result = buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId,
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
    locationId,
  });
  return { list, result };
}

describe("Todos los restaurantes: no restaurant mixing", () => {
  const sales = [
    sale(1, "Churrasco Prueba", 10, 200, A),
    sale(1, "Churrasco Prueba", 5, 100, B),
  ];
  const onlyA = [link(1, { location_id: A, menu_item_id: "m-a" })];

  it("does not cost B's sales with a link that only exists in A", () => {
    const { result, list } = run(sales, onlyA);
    expect(result.totals.food_net_sales).toBe(300);
    // Only A's $200 is covered; B's $100 has no link.
    expect(result.totals.covered_net_sales).toBe(200);
    expect(result.totals.coverage_pct).toBeCloseTo(66.7, 1);
    // COGS = A's 10 units × $3.00, nothing for B's 5 units.
    expect(result.totals.estimated_cogs).toBe(30);
    expect(list.covered_net_sales).toBe(200);
  });

  it("keeps one row per product, with its restaurant parts", () => {
    const { result } = run(sales, onlyA);
    const rows = result.dishes.filter((d) => d.odoo_product_id === 1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.units_sold).toBe(15);
    expect(row.net_sales).toBe(300);
    expect(row.covered).toBe(false);
    // A cost for every unit is not known: never a blended A cost.
    expect(row.unit_cost).toBeNull();
    expect(row.parts?.map((p) => p.sales_scope?.kind).sort()).toEqual([
      "restaurante",
      "sin_vinculo",
    ]);
    const partB = row.parts?.find((p) => p.sales_scope?.kind === "sin_vinculo");
    expect(partB?.net_sales).toBe(100);
    expect(partB?.unit_cost).toBeNull();
    expect(partB?.covered).toBe(false);
  });

  it("the menu dish does not lend A's recipe to B's variant", () => {
    const { result } = run(sales, onlyA);
    const dish = result.menu_dishes.find((d) =>
      d.variants.some((v) => v.odoo_product_id === 1)
    );
    expect(dish?.variants).toHaveLength(2);
    const b = dish?.variants.find((v) => v.sales_scope?.kind === "sin_vinculo");
    expect(b?.unit_cost).toBeNull();
    expect(b?.covered).toBe(false);
    expect(dish?.cost_total).toBe(30);
    expect(new Set(dish?.variants.map((v) => v.key)).size).toBe(2);
  });

  it("costs B with the shared link and A with its own", () => {
    const { result } = run(sales, [
      link(1, { menu_item_id: "m-shared" }),
      link(1, { location_id: A, menu_item_id: "m-a" }),
    ]);
    expect(result.totals.covered_net_sales).toBe(300);
    // A: 10 × $3.00, B: 5 × $1.00.
    expect(result.totals.estimated_cogs).toBe(35);
    const row = result.dishes.find((d) => d.odoo_product_id === 1);
    expect(row?.unit_cost).toBeCloseTo(35 / 15, 6);
    expect(row?.covered).toBe(true);
  });

  it("a product sold only in B and linked only in A is uncovered", () => {
    const { result } = run([sale(1, "Churrasco Prueba", 5, 100, B)], onlyA);
    expect(result.totals.covered_net_sales).toBe(0);
    expect(result.totals.estimated_cogs).toBe(0);
    const row = result.dishes.find((d) => d.odoo_product_id === 1);
    expect(row?.status).toBe("sin_receta");
  });

  it("does not split a product that one shared link costs", () => {
    const { result } = run(sales, [link(1, { menu_item_id: "m-shared" })]);
    const row = result.dishes.find((d) => d.odoo_product_id === 1);
    expect(row?.parts).toBeUndefined();
    expect(result.totals.estimated_cogs).toBe(15);
  });

  it("each restaurant on its own: A covered, B not", () => {
    const a = run(sales, onlyA, A).result;
    expect(a.totals.coverage_pct).toBe(100);
    expect(a.totals.estimated_cogs).toBe(30);
    const b = run(sales, onlyA, B).result;
    expect(b.totals.covered_net_sales).toBe(0);
    expect(b.totals.estimated_cogs).toBe(0);
  });

  it("another product in B never borrows a recipe linked only in A", () => {
    const { result } = run(
      [
        sale(1, "Churrasco Prueba (6 oz)", 10, 200, A),
        sale(2, "Churrasco Prueba (8 oz)", 4, 120, B),
      ],
      [
        link(1, { location_id: A, menu_item_id: "m-a" }),
        link(2, { menu_item_id: null }),
      ]
    );
    const dish = result.menu_dishes.find((d) =>
      d.variants.some((v) => v.odoo_product_id === 2)
    );
    expect(dish?.variants.map((v) => v.odoo_product_id).sort()).toEqual([1, 2]);
    const eight = dish?.variants.find((v) => v.odoo_product_id === 2);
    expect(eight?.unit_cost).toBeNull();
    expect(eight?.covered).toBe(false);
    expect(result.totals.covered_net_sales).toBe(200);
  });

  it("Mover variante moves every restaurant part of the product", () => {
    const { result } = run(sales, onlyA);
    const moved = moveVariantLocally(
      result.menu_dishes,
      1,
      "nuevo:Otro",
      "Otro"
    );
    const target = moved.find((d) => d.id === "nuevo:Otro");
    expect(target?.variants).toHaveLength(2);
    expect(target?.net_sales).toBe(300);
  });

  it("a shared recipe sold only in A still costs B's variant; Todos = A + B", () => {
    const sales2 = [
      sale(1, "Churrasco Prueba (6 oz)", 10, 200, A),
      sale(2, "Churrasco Prueba (8 oz)", 4, 120, B),
    ];
    const links2 = [
      link(1, {
        menu_item_id: "m-shared",
        odoo_name: "Churrasco Prueba (6 oz)",
      }),
      link(2, { menu_item_id: null }),
    ];
    const all = run(sales2, links2).result.totals;
    const a = run(sales2, links2, A).result.totals;
    const b = run(sales2, links2, B).result.totals;
    expect(b.covered_net_sales).toBe(120);
    expect(all.covered_net_sales).toBe(
      a.covered_net_sales + b.covered_net_sales
    );
    expect(all.estimated_cogs).toBeCloseTo(
      a.estimated_cogs + b.estimated_cogs,
      6
    );
  });

  it("a recipe linked only in A never costs B on its own", () => {
    const sales2 = [
      sale(1, "Churrasco Prueba (6 oz)", 10, 200, A),
      sale(2, "Churrasco Prueba (8 oz)", 4, 120, B),
    ];
    const links2 = [
      link(1, {
        location_id: A,
        menu_item_id: "m-a",
        odoo_name: "Churrasco Prueba (6 oz)",
      }),
      link(2, { menu_item_id: null }),
    ];
    const b = run(sales2, links2, B).result.totals;
    expect(b.covered_net_sales).toBe(0);
    expect(b.estimated_cogs).toBe(0);
    const all = run(sales2, links2).result.totals;
    const a = run(sales2, links2, A).result.totals;
    expect(all.covered_net_sales).toBe(
      a.covered_net_sales + b.covered_net_sales
    );
  });
});
