// Menú › Resumen must agree with Platos for dishes with some approved sizes.
// Invented data only.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ResumenCockpit } from "@/components/restaurant/recipes-costing/ResumenScreen";
import {
  computeResumen,
  resumenRange,
  type ResumenData,
  type ResumenVariant,
} from "@/lib/restaurant/menu-resumen";
import { menuDishKpis } from "@/lib/restaurant/costing/menu-summary";
import { rollupLeaves } from "@/lib/restaurant/costing/rollup";
import {
  countDishCoverage,
  dishCoverageLabel,
} from "@/lib/restaurant/costing/dish-coverage";

const v = (
  n: number,
  cost: number | null,
  status: ResumenVariant["status"]
): ResumenVariant => ({
  key: String(n),
  product_id: n,
  locations: null,
  unit_cost: cost,
  covered: status === "aprobado",
  status,
});

const data: ResumenData = {
  currency: "USD",
  first_day: "2026-07-01",
  last_day: "2026-07-31",
  dishes: [
    {
      id: "h",
      name: "Hamburguesa Ejemplo",
      variants: [
        v(1, 4, "aprobado"), // 6 oz
        v(2, 6, "aprobado"), // 8 oz
        v(3, null, "sin_receta"), // 10 oz
      ],
    },
    { id: "p", name: "Pasta Muestra", variants: [v(4, 3, "aprobado")] },
    { id: "s", name: "Sopa Ejemplo", variants: [v(5, null, "sin_receta")] },
  ],
  days: [
    { d: "2026-07-31", l: null, p: 1, n: 100, u: 10 },
    { d: "2026-07-31", l: null, p: 2, n: 100, u: 8 },
    { d: "2026-07-31", l: null, p: 3, n: 50, u: 4 },
    { d: "2026-07-31", l: null, p: 4, n: 100, u: 10 },
    { d: "2026-07-31", l: null, p: 5, n: 40, u: 4 },
  ],
};
const range = resumenRange("month", "2026-07-31");

describe("Resumen: dish with some approved sizes", () => {
  const view = computeResumen(data, range);
  const row = (n: string) => view.dishes.find((d) => d.name === n)!;

  it("the partial dish keeps the approved part's margin and «N de M tamaños»", () => {
    const h = row("Hamburguesa Ejemplo");
    expect(h.approved_count).toBe(2);
    expect(h.variant_count).toBe(3);
    // approved part: sales 200, cost 40 + 48 = 88 -> 56%
    expect(h.approved_margin_pct).toBeCloseTo(56, 6);
    const html = renderToString(
      createElement(ResumenCockpit, {
        view,
        money: (n: number) => `$${n}`,
      } as never)
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("56% · 2 de 3 tamaños");
  });

  it("a dish with no costed variant shows «margen —»", () => {
    const s = row("Sopa Ejemplo");
    expect(s.approved_margin_pct).toBeNull();
    expect(s.margin_pct).toBeNull();
  });

  it("covered/partial counts equal the Platos loader's for the same fixture", () => {
    expect(view.kpis.covered_dishes).toBe(2);
    expect(view.kpis.partial_dishes).toBe(1);
    expect(view.kpis.dish_count).toBe(3);
    const menuDishes = view.dishes.map((d) => ({
      cost_status: d.cost_status,
      approved_count: d.approved_count,
      variant_count: d.variant_count,
    }));
    const platos = menuDishKpis({
      totals: {
        food_cost_pct: null,
        gross_margin: null,
        coverage_pct: 0,
        problem_count: 0,
      },
      menu_dishes: menuDishes,
    } as never);
    expect(platos.covered_dishes).toBe(view.kpis.covered_dishes);
    expect(platos.partial_dishes).toBe(view.kpis.partial_dishes);
    expect(platos.dish_count).toBe(view.kpis.dish_count);
  });

  it("KPIs still use only covered, approved variant sales", () => {
    // covered: 100+100+100 = 300 sales, cost 40+48+30 = 118
    expect(view.kpis.food_cost_pct).toBeCloseTo((118 / 300) * 100, 1);
    expect(view.kpis.gross_margin).toBe(182);
    expect(view.kpis.coverage_pct).toBeCloseTo((300 / 390) * 100, 0);
  });
});

describe("dish-coverage", () => {
  it("counts a dish with at least one approved variant; partial separately", () => {
    const leaf = (st: "aprobado" | "sin_receta") => ({
      key: st,
      units: 1,
      net_sales: 10,
      cost_total: st === "aprobado" ? 3 : null,
      covered: st === "aprobado",
      status: st,
    });
    const nodes = [
      [leaf("aprobado")],
      [leaf("aprobado"), leaf("sin_receta")],
      [leaf("sin_receta")],
    ].map((l) => rollupLeaves(l));
    const c = countDishCoverage(nodes);
    expect(c).toEqual({ covered: 2, partial: 1, total: 3 });
    expect(dishCoverageLabel(c)).toBe("2 de 3 platos costeados");
  });
});
