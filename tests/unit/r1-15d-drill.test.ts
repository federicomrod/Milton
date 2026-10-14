// R1-15d: the drill view's group-by, cross and grouped values. Synthetic.

import { describe, expect, it } from "vitest";
import {
  applyFilters,
  crossTab,
  dimensionValue,
  drillRows,
  valueGroupsFor,
  type ValueGroup,
} from "@/lib/restaurant/menu-dishes/drill";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";

let n = 0;
function v(
  size: number | null,
  side: string | null,
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
    name: `P${n}`,
    size,
    size_unit: size === null ? null : "oz",
    side,
    sides: side ? [side] : [],
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

const variants = [
  v(6, "Tortilla", 200, 60),
  v(8, "Tortilla", 130, 40),
  v(6, "Papas fritas", 100, 30),
  v(8, "Papas fritas", 60, 20),
  v(6, "Puré", 40, 18),
  v(8, "Puré", 10, null), // no price: never $0
  v(12, null, 30, 9),
];

describe("drillRows", () => {
  it("sums by value; margin from sums, not an average of percentages", () => {
    const { rows, total } = drillRows(variants, "side");
    const papas = rows.find((r) => r.label === "Papas fritas")!;
    expect(papas.rollup.net_sales).toBe(160);
    expect(papas.rollup.margin_pct).toBeCloseTo(((160 - 50) / 160) * 100, 6);
    expect(total.net_sales).toBe(570);
  });

  it("shares add up to exactly 100", () => {
    const { rows } = drillRows(variants, "side");
    expect(rows.reduce((s, r) => s + r.share_pct, 0)).toBeCloseTo(100, 6);
  });

  it("a missing price is Sin precio, never $0, and lowers coverage", () => {
    const { rows } = drillRows(variants, "side");
    const pure = rows.find((r) => r.label === "Puré")!;
    expect(pure.rollup.rows_without_cost).toBe(1);
    expect(pure.rollup.cost_total).toBe(18);
    expect(pure.rollup.coverage).toBeCloseTo(40 / 50, 6);
    const only = drillRows([variants[5]], "side").rows[0];
    expect(only.rollup.cost_total).toBeNull();
    expect(only.rollup.margin_pct).toBeNull();
  });

  it("a group collapses its values; its share is the sum of its members' and the whole still adds to 100", () => {
    const papas: ValueGroup = {
      id: "g",
      name: "Papas",
      values: new Set(["Papas fritas", "Puré"]),
    };
    const { rows } = drillRows(variants, "side", [papas]);
    const g = rows.find((r) => r.kind === "group")!;
    expect(g.label).toBe("Papas");
    expect(g.members.map((m) => m.label).sort()).toEqual([
      "Papas fritas",
      "Puré",
    ]);
    expect(g.rollup.net_sales).toBe(210);
    expect(g.share_pct).toBeCloseTo(
      g.members.reduce((s, m) => s + m.share_pct, 0),
      6
    );
    expect(rows.reduce((s, r) => s + r.share_pct, 0)).toBeCloseTo(100, 6);
    expect(rows.some((r) => r.label === "Puré")).toBe(false);
  });

  it("a value in two groups counts once (the first)", () => {
    const a: ValueGroup = { id: "a", name: "A", values: new Set(["Puré"]) };
    const b: ValueGroup = { id: "b", name: "B", values: new Set(["Puré"]) };
    const { rows } = drillRows(variants, "side", [a, b]);
    expect(rows.filter((r) => r.kind === "group")).toHaveLength(1);
    expect(rows.reduce((s, r) => s + r.rollup.net_sales, 0)).toBe(570);
  });
});

describe("filters and values", () => {
  it("filters on another dimension", () => {
    const eight = applyFilters(variants, { size: "8 oz" });
    expect(eight).toHaveLength(3);
    expect(drillRows(eight, "side").total.net_sales).toBe(200);
  });
  it("labels missing values", () => {
    expect(dimensionValue(variants[6], "side")).toBe("Sin acompañante");
    expect(dimensionValue(variants[6], "size")).toBe("12 oz");
  });
});

describe("crossTab", () => {
  it("cells add up to exactly 100 and totals are sums of the shown cells", () => {
    const t = crossTab(variants, "size", "side");
    const all = t.cells.flat().reduce((s, x) => s + x, 0);
    expect(all).toBeCloseTo(100, 6);
    expect(t.rowTotals.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 6);
    expect(t.colTotals.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 6);
    const r6 = t.rowLabels.indexOf("6 oz");
    expect(t.rowTotals[r6]).toBeCloseTo(
      t.cells[r6].reduce((s, x) => s + x, 0),
      6
    );
  });
  it("uses a group as one column", () => {
    const papas: ValueGroup = {
      id: "g",
      name: "Papas",
      values: new Set(["Papas fritas", "Puré"]),
    };
    const t = crossTab(variants, "size", "side", [], [papas]);
    expect(t.colLabels).toContain("Papas");
    expect(t.colLabels).not.toContain("Puré");
    expect(t.cells.flat().reduce((s, x) => s + x, 0)).toBeCloseTo(100, 6);
  });
});

describe("valueGroupsFor", () => {
  it("takes the dish's own and the global groups of that dimension, confirmed only", () => {
    const groups = [
      {
        id: "1",
        name: "Papas",
        scope: "dimension_value",
        dimension: "side",
        menu_dish_id: "d1",
        source: "user",
        status: "confirmed",
      },
      {
        id: "2",
        name: "Global",
        scope: "dimension_value",
        dimension: "side",
        menu_dish_id: null,
        source: "ai_suggested",
        status: "confirmed",
      },
      {
        id: "3",
        name: "Otro plato",
        scope: "dimension_value",
        dimension: "side",
        menu_dish_id: "d2",
        source: "user",
        status: "confirmed",
      },
      {
        id: "4",
        name: "Sugerido",
        scope: "dimension_value",
        dimension: "side",
        menu_dish_id: "d1",
        source: "ai_suggested",
        status: "suggested",
      },
      {
        id: "5",
        name: "Tamaños",
        scope: "dimension_value",
        dimension: "size",
        menu_dish_id: "d1",
        source: "user",
        status: "confirmed",
      },
    ];
    const members = [
      { group_id: "1", member_type: "dimension_value", member_ref: "Puré" },
      {
        group_id: "2",
        member_type: "dimension_value",
        member_ref: "Gallo Pinto",
      },
    ];
    const out = valueGroupsFor(groups, members, "side", "d1");
    expect(out.map((g) => g.name)).toEqual(["Papas", "Global"]);
    expect(out[1].byMilton).toBe(true);
    expect([...out[0].values]).toEqual(["Puré"]);
  });
});
