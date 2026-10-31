import { describe, expect, it } from "vitest";
import {
  computeRentabilidad,
  foodCostFromDishes,
} from "@/lib/restaurant/rentabilidad";
import {
  realResult,
  sameValues,
  simulate,
  whatIfBase,
  whatIfContext,
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
function month(
  amounts: Record<
    "planilla" | "alquiler" | "servicios" | "otros",
    number | null
  >,
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
const FULL = { planilla: 21400, alquiler: 6500, servicios: 3900, otros: 9800 };

describe("what-if: reset", () => {
  it("the starting values reproduce the server figures exactly", () => {
    const m = month(FULL);
    const base = whatIfBase(m);
    const r = simulate(base, whatIfContext(m), { month: m });
    expect(r.profit).toBe(m.profit);
    expect(r.breakEvenPerDay).toBe(m.breakEvenPerDay);
    expect(r).toEqual(realResult(m));
  });
  it("without the shortcut, the formulas land on the same figures (to the cent)", () => {
    const m = month(FULL);
    const r = simulate(whatIfBase(m), whatIfContext(m));
    expect(r.profit).toBe(m.profit);
    expect(r.breakEvenPerDay).toBe(m.breakEvenPerDay);
  });
  it("after changes, going back to the base values is the real result again", () => {
    const m = month(FULL);
    const base = whatIfBase(m);
    const moved = { ...base, sales: base.sales * 1.2 };
    expect(sameValues(moved, base)).toBe(false);
    expect(simulate(moved, whatIfContext(m), { month: m }).profit).not.toBe(
      m.profit
    );
    expect(simulate(base, whatIfContext(m), { month: m }).profit).toBe(
      m.profit
    );
  });
  it("does not mutate the real month", () => {
    const m = month(FULL);
    const before = JSON.stringify(m);
    const base = whatIfBase(m);
    base.amounts.alquiler = 1;
    simulate({ ...base, sales: 1 }, whatIfContext(m), { month: m });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("what-if: Impuestos", () => {
  const m = month(FULL, 0);
  const ctx = whatIfContext(m);
  const base = whatIfBase(m);
  it("lower the contribution margin, never the fixed costs", () => {
    const a = simulate(base, ctx);
    const b = simulate({ ...base, impuestosPct: 13 }, ctx);
    expect(b.fixedTotal).toBe(a.fixedTotal);
    expect(b.marginPct!).toBeLessThan(a.marginPct!);
    // Ventas × tasa ÷ (1 + tasa) comes out of the margin once.
    const tax = (base.sales * 0.13) / 1.13;
    expect(b.impuestos).toBeCloseTo(tax, 6);
    expect(b.profit!).toBeCloseTo(a.profit! - tax, 1);
  });
  it("raise the break-even per day", () => {
    const a = simulate(base, ctx);
    const b = simulate({ ...base, impuestosPct: 13 }, ctx);
    expect(b.breakEvenPerDay!).toBeGreaterThan(a.breakEvenPerDay!);
  });
});

describe("what-if: break-even and ganancia", () => {
  const m = month(FULL);
  const ctx = whatIfContext(m);
  const base = whatIfBase(m);
  it("break-even = fixed ÷ (margin % × open days)", () => {
    const r = simulate(
      { ...base, amounts: { ...base.amounts, alquiler: 8500 } },
      ctx
    );
    const fixed = 21400 + 8500 + 3900 + 9800;
    expect(r.fixedTotal).toBe(fixed);
    expect(r.breakEvenPerDay).toBeCloseTo(fixed / (r.marginPct! * 31), 2);
  });
  it("more sales or a lower food cost % raise ganancia", () => {
    const real = simulate(base, ctx).profit!;
    expect(
      simulate({ ...base, sales: base.sales + 5000 }, ctx).profit!
    ).toBeGreaterThan(real);
    expect(
      simulate({ ...base, foodPct: base.foodPct! - 5 }, ctx).profit!
    ).toBeGreaterThan(real);
  });
  it("a loss stays a negative number", () => {
    const r = simulate({ ...base, sales: 1000 }, ctx);
    expect(r.profit!).toBeLessThan(0);
  });
});

describe("what-if: missing is never $0", () => {
  it("a missing fixed cost gives null, not a number", () => {
    const m = month({ ...FULL, otros: null });
    const r = simulate(whatIfBase(m), whatIfContext(m), { month: m });
    expect(r.fixedTotal).toBeNull();
    expect(r.profit).toBeNull();
    expect(r.breakEvenPerDay).toBeNull();
  });
  it("typing the missing cost fills it in", () => {
    const m = month({ ...FULL, otros: null });
    const base = whatIfBase(m);
    const r = simulate(
      { ...base, amounts: { ...base.amounts, otros: 9800 } },
      whatIfContext(m)
    );
    expect(r.profit).not.toBeNull();
  });
  it("no sales gives no food cost % and no result", () => {
    const m = computeRentabilidad({
      month: "2026-09-01",
      today: "2026-10-27",
      dailySales: {},
      food: { ...foodCostFromDishes([]), periodSales: 0 },
      fixed: { amounts: FULL, impuestosPct: 13 },
      openWeekdays: null,
      openDays: 30,
    });
    const base = whatIfBase(m);
    expect(base.foodPct).toBeNull();
    const r = simulate(base, whatIfContext(m), { month: m });
    expect(r.profit).toBeNull();
    expect(r.breakEvenPerDay).toBeNull();
  });
});

describe("what-if: speed", () => {
  it("1,000 recalculations take far less than 100 ms in total", () => {
    const m = month(FULL);
    const base = whatIfBase(m);
    const ctx = whatIfContext(m);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++)
      simulate({ ...base, sales: base.sales + i }, ctx, { month: m });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
