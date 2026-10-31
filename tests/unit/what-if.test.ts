import { describe, expect, it } from "vitest";
import {
  computeRentabilidad,
  foodCostFromDishes,
} from "@/lib/restaurant/rentabilidad";
import {
  ZERO_SLIDERS,
  fixedRange,
  isZero,
  realResult,
  simulate,
} from "@/lib/restaurant/what-if";

const dailySales = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [
    `2026-10-${String(i + 1).padStart(2, "0")}`,
    2000 + (i % 7) * 300,
  ])
);
const dishes = [
  {
    odooProductId: 1,
    name: "PLATO 1",
    netSales: 40000,
    units: 400,
    unitCost: 31,
    inCogs: true,
    covered: true,
    excluded: false,
    status: "aprobado",
  },
];
const FULL = { planilla: 21400, alquiler: 6500, servicios: 3900, otros: 9800 };
function month(
  amounts: Record<
    "planilla" | "alquiler" | "servicios" | "otros",
    number | null
  > = FULL,
  impuestosPct: number | null = 13
) {
  return computeRentabilidad({
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales,
    food: { ...foodCostFromDishes(dishes), periodSales: 62000 },
    fixed: { amounts, impuestosPct },
    openWeekdays: null,
    openDays: 31,
  });
}

describe("what-if: reset", () => {
  it("all sliders at zero return the server figures exactly", () => {
    const m = month();
    expect(isZero(ZERO_SLIDERS)).toBe(true);
    expect(simulate(m, ZERO_SLIDERS)).toEqual(realResult(m));
    expect(simulate(m, ZERO_SLIDERS).profit).toBe(m.profit);
    expect(simulate(m, ZERO_SLIDERS).breakEven?.date).toBe(
      m.breakEvenDay?.date
    );
  });
  it("the daily formulas land on the same ganancia as the server (to the cent)", () => {
    const m = month();
    // A no-op that is not «zero»: +0% via a tiny float must not drift.
    const r = simulate(m, { pricePct: 0, customersPct: 0, fixedDelta: 1e-9 });
    expect(Math.abs((r.profit as number) - (m.profit as number))).toBeLessThan(
      0.02
    );
  });
  it("does not mutate the real month", () => {
    const m = month();
    const before = JSON.stringify(m);
    simulate(m, { pricePct: 5, customersPct: 10, fixedDelta: 900 });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("what-if: the three sliders", () => {
  const m = month();
  const real = m.profit as number;
  it("subir precios raises ganancia and does not move the food cost", () => {
    const r = simulate(m, { ...ZERO_SLIDERS, pricePct: 3 });
    expect(r.profit as number).toBeGreaterThan(real);
    // +3% on the month's sales, less the tax inside that extra: food stays.
    const extraSales = m.monthTotals.sales * 0.03;
    const extraTax = (extraSales * 0.13) / 1.13;
    expect(r.profit as number).toBeCloseTo(real + extraSales - extraTax, 1);
  });
  it("más clientes moves sales and food cost together", () => {
    const r = simulate(m, { ...ZERO_SLIDERS, customersPct: 10 });
    const extra =
      m.monthTotals.sales * 0.1 -
      (m.monthTotals.sales * 0.1 * 0.13) / 1.13 -
      m.monthTotals.food * 0.1;
    expect(r.profit as number).toBeCloseTo(real + extra, 1);
  });
  it("costos fijos moves ganancia by exactly the amount", () => {
    const r = simulate(m, { ...ZERO_SLIDERS, fixedDelta: 900 });
    expect(r.profit as number).toBeCloseTo(real - 900, 2);
    const down = simulate(m, { ...ZERO_SLIDERS, fixedDelta: -900 });
    expect(down.profit as number).toBeCloseTo(real + 900, 2);
  });
  it("more fixed costs push the break-even day later or out of the month", () => {
    const base = realResult(m).breakEven;
    const r = simulate(m, { ...ZERO_SLIDERS, fixedDelta: 5000 });
    if (base && r.breakEven)
      expect(r.breakEven.day).toBeGreaterThanOrEqual(base.day);
    else expect(r.breakEven).toBeNull();
  });
  it("better sales bring the break-even day earlier", () => {
    const base = realResult(m).breakEven!;
    const r = simulate(m, { ...ZERO_SLIDERS, pricePct: 10 });
    expect(r.breakEven!.day).toBeLessThanOrEqual(base.day);
  });
});

describe("what-if: Impuestos change the margin, never the fixed costs", () => {
  it("the same slider with a higher tax rate gives a lower ganancia; fixed stays", () => {
    const a = month(FULL, 0);
    const b = month(FULL, 13);
    const s = { ...ZERO_SLIDERS, pricePct: 5 };
    expect(simulate(b, s).profit as number).toBeLessThan(
      simulate(a, s).profit as number
    );
    expect(a.fixed.total).toBe(b.fixed.total);
    // The fixed-costs slider is unaffected by the tax rate.
    const f = { ...ZERO_SLIDERS, fixedDelta: 500 };
    const da = (simulate(a, f).profit as number) - (a.profit as number);
    const db = (simulate(b, f).profit as number) - (b.profit as number);
    expect(da).toBeCloseTo(-500, 2);
    expect(db).toBeCloseTo(-500, 2);
  });
});

describe("what-if: missing is never $0", () => {
  it("a missing fixed cost gives no result", () => {
    const m = month({ ...FULL, otros: null });
    const r = simulate(m, { ...ZERO_SLIDERS, pricePct: 3 });
    expect(r.profit).toBeNull();
    expect(r.breakEven).toBeNull();
    expect(fixedRange(m.fixed.total).max).toBe(500);
  });
});

describe("what-if: range and speed", () => {
  it("the fixed-cost slider spans ±25% in steps of 50 or 100", () => {
    const r = fixedRange(41600);
    expect(r).toEqual({ min: -10400, max: 10400, step: 100 });
    expect(fixedRange(1000)).toEqual({ min: -500, max: 500, step: 50 });
  });
  it("1,000 recalculations take far less than 100 ms", () => {
    const m = month();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++)
      simulate(m, {
        pricePct: i % 15,
        customersPct: (i % 40) - 20,
        fixedDelta: i,
      });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
