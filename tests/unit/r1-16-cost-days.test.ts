// R1-16b: the day × category cost rows. Synthetic.
import { describe, expect, it } from "vitest";
import {
  buildMixRows,
  dayProductsFromRows,
  parseDayProducts,
  resolverFromDishEconomics,
} from "@/lib/restaurant/cockpit-cost-days";

describe("day × product groups", () => {
  it("parses the SQL shape and drops garbage", () => {
    const p = parseDayProducts([
      { d: "2026-10-01", l: null, p: 7, c: "Bebidas", n: 100, u: 4 },
      { d: "bad" },
      null,
    ]);
    expect(p).toEqual([
      {
        date: "2026-10-01",
        location_id: null,
        product_id: 7,
        category: "Bebidas",
        net: 100,
        units: 4,
      },
    ]);
    expect(parseDayProducts("x")).toBeNull();
  });
  it("from raw rows: tips out, local date, one group per day/restaurant/product/category", () => {
    const rows = [
      {
        sale_date: "2026-10-01",
        raw_item_name: "Mojito",
        quantity: 2,
        gross_revenue: 20,
        location_id: "L1",
        category: "Bebidas",
        source_metadata: { product_id: 9 },
      },
      {
        sale_date: "2026-10-01",
        raw_item_name: "Mojito",
        quantity: 1,
        gross_revenue: 10,
        location_id: "L1",
        category: "Bebidas",
        source_metadata: { product_id: 9 },
      },
      {
        sale_date: "2026-10-01",
        raw_item_name: "Propina",
        quantity: 1,
        gross_revenue: 5,
        is_tip: true,
        location_id: "L1",
      },
    ] as never;
    const g = dayProductsFromRows(rows, "UTC");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({
      product_id: 9,
      net: 30,
      units: 3,
      category: "Bebidas",
    });
  });
});

describe("cost and category per day", () => {
  const dish = (
    id: number,
    unit: number | null,
    parts?: unknown[],
    covered = true
  ) => ({ odoo_product_id: id, unit_cost: unit, covered, parts }) as never;
  const resolver = resolverFromDishEconomics({
    dishes: [
      dish(1, 4),
      dish(2, null),
      dish(3, 9, [
        {
          unit_cost: 2,
          covered: true,
          sales_scope: { sale_location_ids: ["L1"] },
        },
        {
          unit_cost: 6,
          covered: true,
          sales_scope: { sale_location_ids: ["L2"] },
        },
      ]),
    ],
    menu_dishes: [
      { category: "Churrascos", variants: [{ odoo_product_id: 1 }] },
    ] as never,
    excluded_menu_dishes: [
      { category: "Bebidas", variants: [{ odoo_product_id: 3 }] },
    ] as never,
  });
  const p = (
    date: string,
    product_id: number | null,
    net: number,
    units: number,
    location_id: string | null = null,
    category: string | null = null
  ) => ({ date, location_id, product_id, category, net, units });
  it("cost = units × unit cost, only where a cost is known; the rest is uncosted, never $0", () => {
    const rows = buildMixRows(
      [p("2026-10-01", 1, 100, 10), p("2026-10-01", 2, 50, 5)],
      resolver
    );
    const churr = rows.find((r) => r.category === "Churrascos")!;
    expect(churr).toMatchObject({ net: 100, cost: 40, covered_net: 100 });
    const none = rows.find((r) => r.category !== "Churrascos")!;
    expect(none).toMatchObject({ net: 50, cost: 0, covered_net: 0 }); // uncosted: not in the covered sales
  });
  it("a draft or unapproved cost is uncosted, like in Menú (coverage matches Menú's)", () => {
    const r = resolverFromDishEconomics({
      dishes: [
        dish(5, 3, undefined, false),
        dish(
          6,
          3,
          [
            {
              unit_cost: 1,
              covered: false,
              sales_scope: { sale_location_ids: ["L1"] },
            },
          ],
          false
        ),
      ],
      menu_dishes: [],
      excluded_menu_dishes: [],
    });
    expect(r.unitCostOf(5, null)).toBeNull();
    expect(r.unitCostOf(6, "L1")).toBeNull();
  });
  it("a product costed differently per restaurant uses that restaurant's cost", () => {
    const rows = buildMixRows(
      [p("2026-10-01", 3, 30, 3, "L1"), p("2026-10-01", 3, 30, 3, "L2")],
      resolver
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "Bebidas",
      net: 60,
      cost: 2 * 3 + 6 * 3,
      covered_net: 60,
    });
  });
  it("category: the dish's, else the POS line's, else «Sin categoría» (never invented)", () => {
    const rows = buildMixRows(
      [
        p("2026-10-01", 1, 10, 1),
        p("2026-10-01", 77, 10, 1, null, "Postres"),
        p("2026-10-01", 78, 10, 1),
        p("2026-10-01", null, 10, 1),
      ],
      resolver
    );
    expect(rows.map((r) => r.category).sort()).toEqual([
      "Churrascos",
      "Postres",
      "Sin categoría",
    ]);
    expect(rows.find((r) => r.category === "Sin categoría")!.net).toBe(20);
  });
  it("sums of the rows equal the sums of the products (nothing lost or doubled)", () => {
    const prods = [
      p("2026-10-01", 1, 100, 10),
      p("2026-10-02", 1, 50, 5),
      p("2026-10-01", 2, 70, 7),
    ];
    const rows = buildMixRows(prods, resolver);
    expect(rows.reduce((s, r) => s + r.net, 0)).toBe(220);
  });
});
