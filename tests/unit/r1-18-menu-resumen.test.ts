// R1-18: Menú › Resumen as the menu's cockpit — margin rankings, the browser
// arithmetic and the dataset. Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  MIN_RANKED_DISHES,
  RANKING_INCLUDES_ESTIMATED,
  marginRankings,
  type MarginDish,
} from "@/lib/restaurant/costing/menu-summary";
import {
  computeResumen,
  monthLabel,
  resumenRange,
  type ResumenData,
} from "@/lib/restaurant/menu-resumen";
import { buildResumenData } from "@/lib/restaurant/menu-resumen-data";
import type { DishStatus } from "@/lib/restaurant/costing/dish-status";

const dish = (
  name: string,
  margin: number | null,
  status: DishStatus = "aprobado",
  net = 100
): MarginDish => ({
  id: name,
  name,
  net_sales: net,
  margin_pct: margin,
  cost_status: status,
});

describe("marginRankings", () => {
  it("the minimum is 3 costed dishes (a single constant) and the default leaves AI estimates out", () => {
    expect(MIN_RANKED_DISHES).toBe(3);
    expect(RANKING_INCLUDES_ESTIMATED).toBe(false);
  });
  it("under 3 costed dishes: no lists, only the coverage («margen de 2 de 69 platos»)", () => {
    const dishes = [
      dish("A", 70),
      dish("B", 60),
      ...Array.from({ length: 67 }, (_, i) =>
        dish(`S${i}`, null, "sin_receta")
      ),
    ];
    const r = marginRankings(dishes);
    expect(r).toMatchObject({
      total: 69,
      costed: 2,
      enough: false,
      best: [],
      worst: [],
    });
    expect(r.coverage).toBeCloseTo(2 / 69, 6);
  });
  it("with 3 or more: top 3 / bottom 3, only costed dishes", () => {
    const dishes = [
      dish("A", 78),
      dish("B", 41),
      dish("C", 76),
      dish("D", 55),
      dish("E", 74),
      dish("F", 44),
      dish("Sin precio", null, "falta_precio", 9999),
      dish("Sin receta", null, "sin_receta", 9999),
    ];
    const r = marginRankings(dishes);
    expect(r.enough).toBe(true);
    expect(r.costed).toBe(6);
    expect(r.total).toBe(8);
    expect(r.best.map((d) => d.name)).toEqual(["A", "C", "E"]);
    expect(r.worst.map((d) => d.name)).toEqual(["B", "F", "D"]);
    for (const d of [...r.best, ...r.worst]) {
      expect(["Sin precio", "Sin receta"]).not.toContain(d.name);
    }
  });
  it("a dish with no price is never in a list and never shows $0 or 0%", () => {
    const r = marginRankings([
      dish("A", 70),
      dish("B", 60),
      dish("C", 50),
      dish("X", null, "falta_precio"),
      dish("Y", 0, "falta_precio"),
    ]);
    const names = [...r.best, ...r.worst].map((d) => d.name);
    expect(names).not.toContain("X");
    expect(names).not.toContain("Y"); // not approved: not ranked even if a stray 0 sneaks in
    expect(r.worst.every((d) => d.margin_pct > 0)).toBe(true);
  });
  it("AI estimates are marked «IA» and only enter when the constant says so", () => {
    const dishes = [
      dish("A", 80),
      dish("B", 70),
      dish("C", 60),
      dish("AI", 90, "estimado"),
    ];
    const off = marginRankings(dishes);
    expect(off.costed).toBe(3);
    expect(off.best.map((d) => d.name)).not.toContain("AI");
    const on = marginRankings(dishes, { includeEstimated: true });
    expect(on.costed).toBe(4);
    expect(on.best[0]).toMatchObject({ name: "AI", ai: true });
    expect(on.best.slice(1).every((d) => !d.ai)).toBe(true);
  });
  it("ties break by sales; nothing sold → no ranking", () => {
    const r = marginRankings([
      dish("A", 70, "aprobado", 10),
      dish("B", 70, "aprobado", 50),
      dish("C", 70, "aprobado", 30),
    ]);
    expect(r.best.map((d) => d.name)).toEqual(["B", "C", "A"]);
    expect(marginRankings([])).toMatchObject({
      total: 0,
      costed: 0,
      coverage: 0,
      enough: false,
    });
  });
});

// A tiny menu: three dishes, one with a variant per restaurant.
const data: ResumenData = {
  currency: "USD",
  first_day: "2026-07-01",
  last_day: "2026-07-31",
  dishes: [
    {
      id: "d1",
      name: "Uno",
      variants: [
        {
          key: "1",
          product_id: 1,
          locations: null,
          unit_cost: 4,
          covered: true,
          status: "aprobado",
        },
      ],
    },
    {
      id: "d2",
      name: "Dos",
      variants: [
        {
          key: "2@a",
          product_id: 2,
          locations: ["a"],
          unit_cost: 2,
          covered: true,
          status: "aprobado",
        },
        {
          key: "2@b",
          product_id: 2,
          locations: ["b"],
          unit_cost: null,
          covered: false,
          status: "falta_precio",
        },
      ],
    },
    {
      id: "d3",
      name: "Tres",
      variants: [
        {
          key: "3",
          product_id: 3,
          locations: null,
          unit_cost: null,
          covered: false,
          status: "sin_receta",
        },
      ],
    },
    {
      id: "d4",
      name: "Cuatro",
      variants: [
        {
          key: "4",
          product_id: 4,
          locations: null,
          unit_cost: 3,
          covered: false,
          status: "estimado",
        },
      ],
    },
  ],
  days: [
    { d: "2026-07-31", l: "a", p: 1, n: 100, u: 10 },
    { d: "2026-07-31", l: "a", p: 2, n: 50, u: 5 },
    { d: "2026-07-31", l: "b", p: 2, n: 50, u: 5 },
    { d: "2026-07-30", l: "a", p: 3, n: 40, u: 4 },
    { d: "2026-07-20", l: "a", p: 4, n: 60, u: 6 },
    { d: "2026-07-05", l: "a", p: 1, n: 100, u: 10 },
    { d: "2026-07-05", l: "a", p: 99, n: 999, u: 9 }, // not a dish (tips, excluded)
  ],
};

describe("computeResumen", () => {
  const month = computeResumen(data, resumenRange("month", "2026-07-31"));
  it("ranges: 7 días, the month of the last day, 90 días", () => {
    expect(resumenRange("7d", "2026-07-31")).toEqual({
      from: "2026-07-25",
      to: "2026-07-31",
    });
    expect(resumenRange("month", "2026-07-31")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(resumenRange("90d", "2026-07-31")).toEqual({
      from: "2026-05-03",
      to: "2026-07-31",
    });
    expect(monthLabel("2026-07-31")).toBe("Julio 2026");
  });
  it("food sales exclude products that are not dishes", () => {
    expect(month.food_sales).toBe(100 + 50 + 50 + 40 + 60 + 100);
  });
  it("KPIs count only covered (approved) variants: cost % and margin over the sales that have a cost", () => {
    // covered sales: Uno 200 (cost 80) + Dos@a 50 (cost 10) = 250, cost 90
    expect(month.kpis.food_cost_pct).toBe(36);
    expect(month.kpis.gross_margin).toBe(160);
    expect(month.kpis.coverage_pct).toBeCloseTo((250 / 400) * 100, 0);
  });
  it("a dish with a variant without price is Falta precio, not costed, never $0", () => {
    const dos = month.dishes.find((d) => d.name === "Dos")!;
    expect(dos.cost_status).toBe("falta_precio");
    const cuatro = month.dishes.find((d) => d.name === "Cuatro")!;
    expect(cuatro.cost_status).toBe("estimado");
    const tres = month.dishes.find((d) => d.name === "Tres")!;
    expect(tres).toMatchObject({ cost_status: "sin_receta", margin_pct: null });
  });
  it("the restaurant part of a variant takes its own sales", () => {
    const only = computeResumen(
      { ...data, days: data.days.filter((d) => d.l !== "b") },
      resumenRange("month", "2026-07-31")
    );
    expect(only.dishes.find((d) => d.name === "Dos")!.cost_status).toBe(
      "aprobado"
    );
  });
  it("changing the range recomputes: 7 días has fewer dishes and a different status mix", () => {
    const w = computeResumen(data, resumenRange("7d", "2026-07-31"));
    expect(w.dishes.map((d) => d.name).sort()).toEqual(["Dos", "Tres", "Uno"]);
    expect(w.kpis.dish_count).toBe(3);
    expect(w.counts.sin_receta.dishes).toBe(1);
    expect(w.counts.estimado.dishes).toBe(0); // Cuatro sold on the 20th
  });
  it("Top platos by sales with shares that come from the range; counts and shares for Pendientes", () => {
    expect(month.top[0]).toMatchObject({ name: "Uno", product_id: 1 });
    expect(month.top[0].share).toBeCloseTo(200 / 400, 6);
    // «Dos» is mixed (Dos@a approved 50, Dos@b without price 50): it counts
    // once and its share is only the non-approved half (50/400, not 100/400).
    expect(month.counts.falta_precio.dishes).toBe(1);
    expect(month.counts.falta_precio.share).toBeCloseTo(50 / 400, 6);
    expect(month.counts.estimado.dishes).toBe(1);
  });
  it("only two costed dishes: no ranking, coverage says 2 of N", () => {
    expect(month.ranking).toMatchObject({ costed: 1, total: 4, enough: false });
  });
  it("an empty range is empty, not zeros", () => {
    const e = computeResumen(data, { from: "2026-01-01", to: "2026-01-07" });
    expect(e.empty).toBe(true);
    expect(e.kpis.food_cost_pct).toBeNull();
    expect(e.kpis.gross_margin).toBeNull();
  });
  it("all costed: the 4th card turns into «bajo objetivo»", () => {
    const all = computeResumen(
      {
        ...data,
        dishes: data.dishes.slice(0, 1),
        days: data.days.filter((d) => d.p === 1),
      },
      resumenRange("month", "2026-07-31")
    );
    expect(all.kpis.all_costed).toBe(true);
    expect(all.kpis.low_margin_count).toBe(0);
  });
});

describe("buildResumenData", () => {
  it("keeps only dishes' products, sums per day/restaurant/product and sorts", () => {
    const d = buildResumenData({
      currency: "USD",
      products: [
        {
          date: "2026-07-02",
          location_id: "a",
          product_id: 1,
          category: "X",
          net: 10.004,
          units: 1,
        },
        {
          date: "2026-07-02",
          location_id: "a",
          product_id: 1,
          category: "Y",
          net: 5,
          units: 1,
        },
        {
          date: "2026-07-01",
          location_id: "a",
          product_id: 1,
          category: "X",
          net: 1,
          units: 1,
        },
        {
          date: "2026-07-01",
          location_id: "a",
          product_id: 50,
          category: "X",
          net: 99,
          units: 1,
        },
        {
          date: "2026-07-01",
          location_id: "a",
          product_id: null,
          category: "X",
          net: 99,
          units: 1,
        },
      ],
      menuDishes: [
        {
          id: "d",
          name: "D",
          variants: [
            {
              key: "1",
              odoo_product_id: 1,
              sales_scope: null,
              unit_cost: 2,
              covered: true,
              status: "aprobado",
            },
          ],
        },
      ] as never,
    });
    expect(d.days).toEqual([
      { d: "2026-07-01", l: "a", p: 1, n: 1, u: 1 },
      { d: "2026-07-02", l: "a", p: 1, n: 15, u: 2 },
    ]);
    expect(d.first_day).toBe("2026-07-01");
    expect(d.last_day).toBe("2026-07-02");
    expect(d.dishes[0].variants[0]).toMatchObject({
      product_id: 1,
      locations: null,
      unit_cost: 2,
      covered: true,
    });
  });
});
