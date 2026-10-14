// R1-10: POS variants grouped into menu dishes. Synthetic data only.

import { describe, expect, it } from "vitest";
import {
  buildMenuDishes,
  proteinLineCost,
  scaledCost,
} from "@/lib/restaurant/menu-dishes/menu-dishes";
import type { DishEconomics } from "@/lib/restaurant/costing/dish-economics";

let seq = 0;
function variant(
  name: string,
  over: Partial<DishEconomics> = {}
): DishEconomics {
  seq += 1;
  return {
    odoo_product_id: seq,
    name,
    raw_names: [name],
    menu_item_id: null,
    category: "Platos",
    treatment: "por_clasificar",
    is_combo: false,
    status: "sin_receta",
    status_label: "Sin receta",
    unit_cost: null,
    cost_source: null,
    cost_date: null,
    recipe_version_id: null,
    excel_total: null,
    excel_diff: null,
    excel_diff_flag: false,
    units_sold: 10,
    net_sales: 100,
    share_of_food_sales: 0,
    avg_net_price: 10,
    food_cost_pct: null,
    unit_margin: null,
    covered: false,
    in_cogs: false,
    lines: [],
    lines_missing_price: 0,
    ...over,
  };
}

const approved6 = () =>
  variant("Bistec (6 onz.) (Pan con Ajo, 3/4)", {
    status: "aprobado",
    unit_cost: 6,
    covered: true,
    in_cogs: true,
    recipe_version_id: "v1",
    units_sold: 20,
    net_sales: 400,
    lines: [
      {
        name: "Res",
        raw_name: "Res",
        kind: "ingredient",
        ingredient_id: "i",
        component_id: null,
        qty: 6,
        unit: "oz",
        unit_cost: 0.6,
        amount: 3.6,
        own_cost: true,
        price_source: "excel",
        price_date: null,
        catalog_price: null,
        excel_unit_cost: 0.6,
        pending: false,
      },
      {
        name: "Pan",
        raw_name: "Pan",
        kind: "ingredient",
        ingredient_id: "p",
        component_id: null,
        qty: 1,
        unit: "unit",
        unit_cost: 2.4,
        amount: 2.4,
        own_cost: true,
        price_source: "excel",
        price_date: null,
        catalog_price: null,
        excel_unit_cost: 2.4,
        pending: false,
      },
    ],
  });

describe("menu dishes", () => {
  it("groups sizes, sides and events of one dish; excludes drinks; no orphans or duplicates", () => {
    const products = [
      approved6(),
      variant("Bistec (8 onz.) (Tortilla, Bien Cocido)", {
        units_sold: 10,
        net_sales: 250,
      }),
      variant("Bistecs 8oz. (Eventos) (1/2, Pan con Ajo)", {
        units_sold: 5,
        net_sales: 120,
        category: "Eventos",
      }),
      variant("Sopa de Casa", { units_sold: 4, net_sales: 30 }),
      variant("Agua", { category: "Bebidas sin Licor", net_sales: 50 }),
    ];
    const r = buildMenuDishes({ products, excludedNetSalesBefore: 0 });
    expect(r.dishes.map((d) => d.name)).toEqual(["Bistec", "Sopa de Casa"]);
    expect(r.dishes[0].variants).toHaveLength(3);
    expect(r.excluded).toHaveLength(1);
    expect(r.totals.excluded_by_reason).toEqual({ bebida: 1 });
    // Every variant in exactly one dish or excluded.
    const ids = [...r.dishes, ...r.excluded].flatMap((d) =>
      d.variants.map((v) => v.odoo_product_id)
    );
    expect(new Set(ids).size).toBe(products.length);
    expect(ids).toHaveLength(products.length);
    // Shares add up to 100%.
    expect(r.dishes.reduce((s, d) => s + d.share_of_food_sales, 0)).toBeCloseTo(
      1,
      10
    );
    expect(
      r.dishes[0].variants.find((v) => /Eventos/.test(v.name))?.channel
    ).toBe("eventos");
  });

  it("costs a variant with no recipe from the dish's, scaling only the protein", () => {
    const products = [
      approved6(),
      variant("Bistec (8 onz.) (Tortilla)", { units_sold: 10, net_sales: 250 }),
    ];
    const r = buildMenuDishes({ products, excludedNetSalesBefore: 0 });
    const eight = r.dishes[0].variants.find((v) => v.size === 8)!;
    // 6 + (8/6 − 1) × 3.6 = 7.2
    expect(eight.unit_cost).toBeCloseTo(7.2, 10);
    expect(eight).toMatchObject({
      cost_basis: "dish",
      status: "aprobado",
      covered: true,
    });
    const six = r.dishes[0].variants.find((v) => v.size === 6)!;
    expect(six).toMatchObject({ unit_cost: 6, cost_basis: "own" });
  });

  it("sums, never averages: margin and food cost % come from the sums", () => {
    const products = [
      approved6(),
      variant("Bistec (8 onz.)", { units_sold: 10, net_sales: 250 }),
    ];
    const d = buildMenuDishes({ products, excludedNetSalesBefore: 0 })
      .dishes[0];
    const cost = 6 * 20 + 7.2 * 10;
    expect(d.units).toBe(30);
    expect(d.net_sales).toBe(650);
    expect(d.cost_total).toBeCloseTo(cost, 10);
    expect(d.food_cost_pct).toBeCloseTo((cost / 650) * 100, 10);
    expect(d.margin).toBeCloseTo(650 - cost, 10);
    expect(d.coverage).toBe(1);
    expect(d.cost_status).toBe("aprobado");
  });

  it("a missing price stays unknown (never $0) and makes the dish a problem", () => {
    const r = buildMenuDishes({
      products: [
        variant("Pollo (Tortilla)", { status: "falta_precio" }),
        variant("Pollo (Pan con Ajo)", { status: "falta_precio" }),
      ],
      excludedNetSalesBefore: 0,
    });
    expect(r.dishes[0]).toMatchObject({
      cost_total: null,
      cost_status: "falta_precio",
      coverage: 0,
    });
    expect(r.totals).toMatchObject({
      problem_count: 1,
      estimated_cogs: 0,
      dish_count: 1,
      coverage_pct: 0,
    });
  });

  it("a person's move and exclusion win over Milton's grouping", () => {
    const moved = variant("Bistec (Tortilla)");
    const drink = variant("Pozol", { category: "Platos" });
    const r = buildMenuDishes({
      products: [approved6(), moved, drink],
      storedDishes: [
        {
          id: "d-otro",
          name: "Otro Plato",
          restaurant_id: null,
          category: null,
          recipe_id: null,
          base_portion_qty: null,
          base_portion_unit: null,
          source: "name",
          status: "confirmed",
        },
      ],
      storedVariants: new Map([
        [
          moved.odoo_product_id,
          {
            odoo_product_id: moved.odoo_product_id,
            menu_dish_id: "d-otro",
            portion_qty: null,
            side_label: null,
            cooking_point: null,
            is_event: false,
            excluded_reason: null,
          },
        ],
        [
          drink.odoo_product_id,
          {
            odoo_product_id: drink.odoo_product_id,
            menu_dish_id: null,
            portion_qty: null,
            side_label: null,
            cooking_point: null,
            is_event: false,
            excluded_reason: "bebida",
          },
        ],
      ]),
      excludedNetSalesBefore: 0,
    });
    expect(r.byProduct.get(moved.odoo_product_id)?.dish_id).toBe("d-otro");
    expect(
      r.excluded.flatMap((d) => d.variants.map((v) => v.odoo_product_id))
    ).toContain(drink.odoo_product_id);
  });

  it("protein line and scaling helpers", () => {
    expect(proteinLineCost(approved6().lines)).toBe(3.6);
    expect(
      scaledCost({ baseCost: 6, baseProtein: 3.6, basePortion: 6, portion: 12 })
    ).toBeCloseTo(9.6, 10);
    expect(
      scaledCost({
        baseCost: 6,
        baseProtein: null,
        basePortion: 6,
        portion: 12,
      })
    ).toBe(6);
  });
});

describe("moveVariantLocally", () => {
  it("moves a variant and recomputes both dishes from sums", async () => {
    const { moveVariantLocally } =
      await import("@/lib/restaurant/menu-dishes/menu-dishes");
    const products = [
      approved6(),
      variant("Bistec (8 onz.)", { units_sold: 10, net_sales: 250 }),
      variant("Sopa de Casa", { net_sales: 50 }),
    ];
    const r = buildMenuDishes({ products, excludedNetSalesBefore: 0 });
    const eight = r.dishes[0].variants.find((v) => v.size === 8)!;
    const sopa = r.dishes.find((d) => d.name === "Sopa de Casa")!;
    const next = moveVariantLocally(r.dishes, eight.odoo_product_id, sopa.id);
    const bistec = next.find((d) => d.name === "Bistec")!;
    const sopa2 = next.find((d) => d.id === sopa.id)!;
    expect(bistec.net_sales).toBe(400);
    expect(sopa2.net_sales).toBe(300);
    expect(next.reduce((s, d) => s + d.share_of_food_sales, 0)).toBeCloseTo(
      1,
      10
    );
    expect(next.flatMap((d) => d.variants)).toHaveLength(3);
  });
});
