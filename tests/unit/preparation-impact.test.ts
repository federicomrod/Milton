import { describe, expect, it } from "vitest";
import {
  impactLabel,
  preparationImpact,
} from "@/lib/restaurant/recipe-costing/preparation-impact";

describe("preparationImpact", () => {
  it("counts dishes and their sales, through nested preparations, once each", () => {
    const impact = preparationImpact({
      totalNetSales: 1000,
      dishes: [
        {
          odoo_product_id: 1,
          net_sales: 300,
          component_ids: ["convoy", "salsa"],
        },
        { odoo_product_id: 2, net_sales: 200, component_ids: ["convoy"] },
        { odoo_product_id: 3, net_sales: 100, component_ids: [] },
      ],
      children: new Map([
        ["convoy", ["salsa", "caldo"]],
        ["caldo", ["salsa"]],
      ]),
    });
    expect(impact.get("convoy")).toEqual({
      dishes: 2,
      net_sales: 500,
      share_pct: 50,
    });
    // Dish 1 uses salsa directly and through convoy: counted once.
    expect(impact.get("salsa")).toEqual({
      dishes: 2,
      net_sales: 500,
      share_pct: 50,
    });
    expect(impact.get("caldo")).toEqual({
      dishes: 2,
      net_sales: 500,
      share_pct: 50,
    });
    expect(impact.has("unused")).toBe(false);
  });

  it("survives a loop in the data without spinning", () => {
    const impact = preparationImpact({
      totalNetSales: 100,
      dishes: [{ odoo_product_id: 1, net_sales: 100, component_ids: ["a"] }],
      children: new Map([
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
    });
    expect(impact.get("b")?.dishes).toBe(1);
  });

  it("speaks Spanish", () => {
    expect(impactLabel({ dishes: 7, net_sales: 240, share_pct: 24 })).toBe(
      "Desbloquea 7 platos · 24% de ventas"
    );
    expect(impactLabel({ dishes: 1, net_sales: 5, share_pct: 0.5 })).toContain(
      "1 plato ·"
    );
    expect(impactLabel(undefined)).toBe("Ningún plato vendido la usa");
  });
});
