// R1-15h: group Desglose (Producto), empty dimensions hidden, profit ranking. Synthetic.
import { describe, expect, it } from "vitest";
import {
  availableDimensions,
  drillRows,
  profitRanking,
} from "@/lib/restaurant/menu-dishes/drill";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";

let n = 0;
function v(
  name: string,
  net_sales: number,
  cost_total: number | null,
  over: Partial<MenuDishVariant> = {}
): MenuDishVariant {
  n += 1;
  return {
    odoo_product_id: n,
    key: `k${n}`,
    sales_scope: null,
    saved: true,
    name,
    size: null,
    size_unit: null,
    side: null,
    sides: [],
    cooking_point: null,
    channel: "salón",
    is_promo: false,
    units: 10,
    net_sales,
    unit_cost: null,
    cost_total,
    margin: null,
    food_cost_pct: null,
    cost_basis: null,
    status: cost_total === null ? "falta_precio" : "aprobado",
    covered: cost_total !== null,
    ...over,
  };
}

const drinks = [
  v("Mojito", 300, 90),
  v("Cuba Libre", 500, 100),
  v("Vodka Soda", 200, 80),
];

describe("availableDimensions", () => {
  it("drinks offer Producto only: no size, side or cooking point, no Canal when all Salón", () => {
    expect(availableDimensions(drinks, { product: true })).toEqual(["product"]);
  });
  it("a dish with sides and sizes offers those, not Producto", () => {
    const dish = [
      v("A", 1, 1, { size: 6, size_unit: "oz", side: "Papas" }),
      v("B", 1, 1, { size: 8, size_unit: "oz" }),
    ];
    expect(availableDimensions(dish)).toEqual(["size", "side"]);
  });
  it("Canal stays when there are events; Punto when a cooking point exists", () => {
    const dish = [
      v("A", 1, 1, { cooking_point: "Término medio" }),
      v("B", 1, 1, { channel: "eventos" }),
    ];
    expect(availableDimensions(dish)).toEqual(["point", "channel"]);
  });
  it("Producto needs two different products", () => {
    expect(availableDimensions([v("Solo", 1, 1)], { product: true })).toEqual(
      []
    );
  });
});

describe("the Producto breakdown of a group", () => {
  it("splits sales by member, sorted by sales, shares adding to 100", () => {
    const { rows } = drillRows(drinks, "product");
    expect(rows.map((r) => r.label)).toEqual([
      "Cuba Libre",
      "Mojito",
      "Vodka Soda",
    ]);
    expect(rows.map((r) => r.share_pct)).toEqual([50, 30, 20]);
    expect(rows[0].rollup.margin_pct).toBeCloseTo(80, 6);
  });
});

describe("profitRanking", () => {
  const rows = (vs: MenuDishVariant[]) => drillRows(vs, "product").rows;
  it("marks the top and bottom (up to 3), never overlapping", () => {
    const r = rows([
      v("A", 100, 20),
      v("B", 100, 30),
      v("C", 100, 40),
      v("D", 100, 50),
      v("E", 100, 60),
      v("F", 100, 70),
      v("G", 100, 80),
    ]);
    const k = profitRanking(r);
    expect(k.best.size).toBe(3);
    expect(k.worst.size).toBe(3);
    for (const id of k.best) expect(k.worst.has(id)).toBe(false);
    expect(
      [...k.best].map((id) => r.find((x) => x.id === id)!.label).sort()
    ).toEqual(["A", "B", "C"]);
    expect(
      [...k.worst].map((id) => r.find((x) => x.id === id)!.label).sort()
    ).toEqual(["E", "F", "G"]);
  });
  it("a member with no price is never ranked (not 0%) and shows Sin precio", () => {
    const r = rows([
      v("A", 100, 20),
      v("B", 100, 90),
      v("Sin precio", 400, null),
    ]);
    const k = profitRanking(r);
    const unpriced = r.find((x) => x.label === "Sin precio")!;
    expect(unpriced.rollup.margin_pct).toBeNull();
    expect(k.best.has(unpriced.id)).toBe(false);
    expect(k.worst.has(unpriced.id)).toBe(false);
  });
  it("two ranked rows mark one best and one worst; one row marks none", () => {
    const two = profitRanking(rows([v("A", 100, 20), v("B", 100, 90)]));
    expect([two.best.size, two.worst.size]).toEqual([1, 1]);
    const one = profitRanking(rows([v("A", 100, 20)]));
    expect([one.best.size, one.worst.size]).toEqual([0, 0]);
  });
});
