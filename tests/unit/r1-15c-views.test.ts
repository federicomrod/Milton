// R1-15c: moving a product out of the excluded list into a dish, where each
// product sits in the tree, and Agrupados + Sin agrupar = Todos. Synthetic.

import { describe, expect, it } from "vitest";
import {
  buildGroupTree,
  groupingCounts,
  type TreeGroup,
  type TreeLeaf,
} from "@/lib/restaurant/costing/rollup";
import {
  buildMenuDishes,
  moveVariantAcross,
} from "@/lib/restaurant/menu-dishes/menu-dishes";
import type { DishEconomics } from "@/lib/restaurant/costing/dish-economics";

let seq = 100;
function product(name: string, net_sales: number): DishEconomics {
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
    net_sales,
    share_of_food_sales: 0,
    avg_net_price: 10,
    food_cost_pct: null,
    unit_margin: null,
    covered: false,
    in_cogs: false,
    lines: [],
    lines_missing_price: 0,
  };
}

const leaf = (ref: string, net_sales: number): TreeLeaf => ({
  key: ref,
  ref,
  name: `P ${ref}`,
  units: 1,
  net_sales,
  cost_total: null,
  covered: false,
  status: "falta_precio",
});
const group = (id: string, name: string, parent_id: string | null = null) =>
  ({
    id,
    name,
    parent_id,
    restaurant_id: null,
    source: "user",
    status: "confirmed",
    menu_dish_id: null,
  }) as TreeGroup;

describe("moveVariantAcross", () => {
  it("moves a product from the excluded list into a dish, shares over dishes only", () => {
    const all = buildMenuDishes({
      products: [product("Sopa de Casa", 300), product("Flan", 100)],
      excludedNetSalesBefore: 0,
    });
    const sopa = all.dishes.find((d) => d.name === "Sopa de Casa")!;
    const flan = all.dishes.find((d) => d.name === "Flan")!;
    // Pretend Flan was excluded by hand.
    const excluded = [{ ...flan, status: "excluded" as const }];
    const dishes = [sopa];
    const r = moveVariantAcross(
      dishes,
      excluded,
      flan.variants[0].odoo_product_id,
      sopa.id
    );
    expect(r.excluded).toHaveLength(0);
    expect(r.dishes).toHaveLength(1);
    expect(r.dishes[0].variants).toHaveLength(2);
    expect(r.dishes[0].net_sales).toBe(400);
    expect(r.dishes[0].share_of_food_sales).toBeCloseTo(1, 10);
  });

  it("behaves like the plain move when the product is in a dish", () => {
    const all = buildMenuDishes({
      products: [product("Bistec", 300), product("Sopa", 100)],
      excludedNetSalesBefore: 0,
    });
    const [a, b] = all.dishes;
    const r = moveVariantAcross(
      all.dishes,
      [],
      b.variants[0].odoo_product_id,
      a.id
    );
    expect(r.dishes).toHaveLength(1);
    expect(r.excluded).toEqual([]);
  });
});

describe("the counts", () => {
  it("Agrupados + Sin agrupar = Todos", () => {
    const tree = buildGroupTree({
      leaves: [leaf("1", 50), leaf("2", 30), leaf("3", 20)],
      groups: [group("g1", "Bebidas")],
      members: [{ group_id: "g1", member_ref: "1" }],
    });
    const c = groupingCounts(tree);
    expect(c.grouped + c.ungrouped).toBe(c.all);
    expect(c.ungrouped).toBe(2);
    expect(c.ungrouped_share_pct).toBe(50);
  });
});
