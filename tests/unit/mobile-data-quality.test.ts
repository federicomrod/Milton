import { describe, expect, it } from "vitest";
import { dataReasons } from "@/lib/restaurant/mobile-manager/data-quality";
import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";

const month = (over: Record<string, unknown> = {}) =>
  ({
    hasData: true,
    monthTotals: { sales: 1000, food: 300 },
    cada100: null,
    coverage: {
      pct: 0.8,
      uncoveredPct: 0.2,
      coveredMarginPct: 0.7,
      uncovered: [],
    },
    fixed: {
      total: 400,
      missing: [],
      amounts: { planilla: 100, alquiler: 100, servicios: 100, otros: 100 },
      missingAmounts: [],
    },
    ...over,
  }) as unknown as RentabilidadMonth;

describe("dataReasons", () => {
  it("nothing sold yet: no_sales, no percentage, fixed costs reported separately", () => {
    const r = dataReasons(
      month({
        hasData: false,
        monthTotals: { sales: 0, food: 0 },
        coverage: {
          pct: 0,
          uncoveredPct: 0,
          coveredMarginPct: null,
          uncovered: [],
        },
        fixed: {
          total: null,
          missing: ["planilla"],
          amounts: {
            planilla: null,
            alquiler: null,
            servicios: null,
            otros: null,
          },
          missingAmounts: [],
        },
      })
    );
    expect(r.hasSales).toBe(false);
    expect(r.foodCost).toMatchObject({
      status: "no_sales",
      pct: null,
      coveredPct: null,
      uncoveredPct: null,
    });
    expect(r.fixed).toEqual({
      loaded: false,
      complete: false,
      missing: ["planilla"],
    });
  });

  it("sales but no dish has a costed recipe: no_costed_dishes (not 0 %), with what is missing", () => {
    const r = dataReasons(
      month({
        coverage: {
          pct: 0,
          uncoveredPct: 1,
          coveredMarginPct: null,
          uncovered: [
            { reason: "sin_receta" },
            { reason: "borrador" },
            { reason: "sin_precio" },
            { reason: "sin_precio" },
          ],
        },
      })
    );
    expect(r.foodCost.status).toBe("no_costed_dishes");
    expect(r.foodCost.pct).toBeNull();
    expect(r.foodCost.uncoveredDishes).toBe(4);
    expect(r.foodCost.uncoveredByReason).toEqual({
      sinReceta: 1,
      borrador: 1,
      sinPrecio: 2,
    });
  });

  it("food cost: the web's De cada $100 share wins; without it, food ÷ sales", () => {
    expect(
      dataReasons(month({ cada100: [{ key: "comida", pct: 31.4 }] })).foodCost
        .pct
    ).toBe(31.4);
    expect(dataReasons(month()).foodCost.pct).toBe(30);
    expect(dataReasons(month()).foodCost.coveredPct).toBe(0.8);
  });

  it("fixed costs: loaded / complete / which are missing", () => {
    const partial = dataReasons(
      month({
        fixed: {
          total: null,
          missing: ["alquiler", "impuestos"],
          amounts: {
            planilla: 5,
            alquiler: null,
            servicios: null,
            otros: null,
          },
          missingAmounts: [],
        },
      })
    );
    expect(partial.fixed).toEqual({
      loaded: true,
      complete: false,
      missing: ["alquiler", "impuestos"],
    });
    expect(dataReasons(month()).fixed).toEqual({
      loaded: true,
      complete: true,
      missing: [],
    });
  });

  it("tolerates a coverage whose dishes carry no reason (counted, in no bucket)", () => {
    const r = dataReasons(
      month({
        coverage: {
          pct: 0.5,
          uncoveredPct: 0.5,
          coveredMarginPct: null,
          uncovered: [{ name: "x" }],
        },
      })
    );
    expect(r.foodCost.uncoveredDishes).toBe(1);
    expect(r.foodCost.uncoveredByReason).toEqual({
      sinReceta: 0,
      borrador: 0,
      sinPrecio: 0,
    });
  });
});
