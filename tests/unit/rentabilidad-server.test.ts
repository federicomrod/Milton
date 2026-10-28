import { describe, expect, it } from "vitest";
import type { CostingData } from "@/lib/restaurant/costing";
import { costingAsOf } from "@/lib/restaurant/costing/dish-economics-server";
import { latestPrice } from "@/lib/restaurant/recipe-costing/editor";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  dailyNetSales,
  toSoldDish,
} from "@/lib/restaurant/rentabilidad-server";
import { foodCostFromDishes } from "@/lib/restaurant/rentabilidad";
import type { DetailCube, DetailRow } from "@/lib/restaurant/sales-detail-cube";
import type { DishEconomics } from "@/lib/restaurant/costing/dish-economics";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

function entry(
  id: string,
  date: string,
  unitCost: number,
  source: IngredientCostEntry["source_type"] = "manual"
): IngredientCostEntry {
  return {
    id,
    company_id: "co",
    ingredient_id: "ing",
    supplier_id: null,
    source_type: source,
    source_id: null,
    cost_date: date,
    effective_date: date,
    quantity: 1,
    unit: "kg",
    total_cost: unitCost,
    unit_cost: unitCost,
    normalized_unit: "kg",
    normalized_unit_cost: unitCost,
    currency: "USD",
    created_at: `${date}T00:00:00Z`,
  };
}

function costing(entries: IngredientCostEntry[]): CostingData {
  return {
    ingredientsById: new Map([
      ["ing", { id: "ing", name: "Queso", default_unit: "kg" }],
    ]),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map([["ing", entries]]),
  } as unknown as CostingData;
}

describe("a month is costed with the prices of its last day", () => {
  const data = costing([
    entry("a", "2026-09-20", 10),
    entry("b", "2026-10-15", 12), // price change on day 15 of October
    entry("c", "2026-11-05", 15), // after October
  ]);
  const priceAsOf = (asOf: string | null) =>
    latestPrice(asOf ? costingAsOf(data, asOf) : data, "ing", () => "manual")
      ?.unit_cost ?? null;

  it("a closed month uses the latest price on or before its last day", () => {
    expect(priceAsOf("2026-10-31")).toBe(12);
    expect(priceAsOf("2026-09-30")).toBe(10);
  });

  it("the current month uses today's price", () => {
    expect(priceAsOf(null)).toBe(15);
  });

  it("no price on or before the date is «Sin precio» (null), never 0", () => {
    expect(priceAsOf("2026-08-31")).toBeNull();
  });

  it("a zero that nobody typed is not a price", () => {
    const zero = costing([entry("z", "2026-10-02", 0, "import")]);
    expect(
      latestPrice(costingAsOf(zero, "2026-10-31"), "ing", () => "import")
    ).toBeNull();
  });
});

describe("combos count once", () => {
  it("a combo sold with its component lines is one product, one unit, sold once", () => {
    const base = {
      company_id: "co",
      location_id: "loc",
      is_tip: false,
    };
    const list = buildPosProductList({
      companyId: "co",
      sales: [
        {
          ...base,
          raw_item_name: "Combo Almuerzo",
          quantity: 1,
          gross_revenue: 0,
          net_revenue: 0,
          external_line_id: "100",
          source_metadata: { product_id: 10 },
        },
        {
          ...base,
          raw_item_name: "Hamburguesa",
          quantity: 1,
          gross_revenue: 80,
          net_revenue: 80,
          external_line_id: "101",
          combo_parent_external_line_id: "100",
          combo_parent_odoo_product_id: 10,
          source_metadata: { product_id: 11 },
        },
        {
          ...base,
          raw_item_name: "Refresco",
          quantity: 1,
          gross_revenue: 40,
          net_revenue: 40,
          external_line_id: "102",
          combo_parent_external_line_id: "100",
          combo_parent_odoo_product_id: 10,
          source_metadata: { product_id: 12 },
        },
      ],
      links: [],
      recipeVersions: [],
    });
    expect(list.products).toHaveLength(1);
    expect(list.products[0].units_sold).toBe(1);
    expect(list.net_sales).toBe(120);
  });
});

describe("Ventas netas come from the Ventas cube, to the cent", () => {
  it("sums the cube's net per business day (tips are not in it)", () => {
    const row = (date: number, net: number, tip = 0): DetailRow => [
      date,
      12,
      0,
      0,
      0,
      0,
      0,
      0,
      net,
      1,
      net,
      0,
      tip,
    ];
    const cube = {
      dates: ["2026-10-01", "2026-10-02"],
      rows: [row(0, 100.105), row(0, 50.1, 9), row(1, 20)],
    } as unknown as DetailCube;
    const out = dailyNetSales(cube);
    expect(out["2026-10-01"]).toBe(150.21);
    expect(out["2026-10-02"]).toBe(20);
  });
});

describe("toSoldDish", () => {
  it("maps a dish-economics row and keeps «Sin precio» out of the cost", () => {
    const dish = {
      odoo_product_id: 7,
      name: "PLATO",
      menu_dish_name: "PLATO",
      net_sales: 500,
      units_sold: 10,
      unit_cost: null,
      in_cogs: false,
      covered: false,
      excluded_reason: null,
      status: "falta_precio",
    } as unknown as DishEconomics;
    const food = foodCostFromDishes([toSoldDish(dish)]);
    expect(food.cogs).toBe(0);
    expect(food.uncovered[0]).toMatchObject({
      odooProductId: 7,
      name: "Plato",
      reason: "sin_precio",
    });
  });
});
