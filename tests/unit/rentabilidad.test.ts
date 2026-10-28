import { describe, expect, it } from "vitest";
import {
  businessToday,
  comparisonChips,
  computeRentabilidad,
  foodCostFromDishes,
  miltonFindings,
  realOnly,
  type FoodCostInput,
  type RentabilidadInput,
  type SoldDish,
} from "@/lib/restaurant/rentabilidad";
import { openDaysInMonth } from "@/lib/restaurant/fixed-costs";

// Made-up October 2026 sample. 1 Oct 2026 is a Thursday; "yesterday" = 26 Oct.
const SALES = [
  2280, 2790, 3430, 2520, 1660, 1760, 2000, 2350, 2730, 3310, 2510, 1540, 1780,
  2260, 2210, 2820, 3420, 2890, 1670, 1770, 2310, 2180, 3120, 3240, 2550, 1550,
];
const MONTH = "2026-10-01";
const TODAY = "2026-10-27";
const dailySales = Object.fromEntries(
  SALES.map((s, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, s])
);
const ACTUAL_TOTAL = SALES.reduce((a, b) => a + b, 0);

const food = (coverage = 1): FoodCostInput => ({
  cogs: ACTUAL_TOTAL * 0.31,
  periodSales: ACTUAL_TOTAL,
  foodSales: ACTUAL_TOTAL,
  coveredSales: ACTUAL_TOTAL * coverage,
  uncovered: [],
});

const fixed = (impuestosPct: number | null = 0) => ({
  amounts: {
    planilla: 21400 as number | null,
    alquiler: 6500 as number | null,
    servicios: 3900 as number | null,
    otros: 9800 as number | null,
  },
  impuestosPct,
});

function sample(over: Partial<RentabilidadInput> = {}) {
  return computeRentabilidad({
    month: MONTH,
    today: TODAY,
    dailySales,
    food: food(),
    unplannedWaste: 828,
    fixed: fixed(0),
    openWeekdays: null,
    openDays: 31,
    ...over,
  });
}

describe("Rentabilidad: the October sample", () => {
  const r = sample();

  it("projects days 27–31 with the same weekday of the last 4 weeks", () => {
    const projected = r.days
      .filter((d) => d.projected)
      .map((d) => Math.round(d.sales));
    expect(projected).toEqual([1770, 2190, 2255, 2865, 3350]);
    expect(Math.round(r.monthTotals.sales)).toBe(75080);
    expect(Math.round(r.monthTotals.food)).toBe(23275);
    expect(Math.round(r.monthTotals.waste)).toBe(987);
    expect(Math.round(r.monthTotals.margin)).toBe(50818);
    expect((r.monthTotals.marginPct ?? 0) * 100).toBeCloseTo(67.7, 1);
  });

  it("Ganancia hasta ayer, proyección, venta de equilibrio, costo primo", () => {
    expect(r.profitToDate).toBeCloseTo(800.5, 1);
    expect(Math.round(r.profitToDate ?? 0)).toBe(801);
    expect(Math.round(r.profit ?? 0)).toBe(9218);
    expect((r.profitPct ?? 0) * 100).toBeCloseTo(12.3, 1);
    expect(Math.round(r.breakEvenPerDay ?? 0)).toBe(1983);
    expect(((r.costoPrimo ?? 0) * 100).toFixed(1)).toBe("60.8");
  });

  it("día de equilibrio is Monday 26 (day 25 is still $237 short)", () => {
    expect(r.breakEvenDay).toEqual({
      date: "2026-10-26",
      day: 26,
      projected: false,
    });
    const d25 = r.days.find((d) => d.date === "2026-10-25")!;
    expect(41600 - d25.cumMargin).toBeCloseTo(237.2, 1);
  });

  it("vendes $2,410 en promedio and the weekday averages", () => {
    expect(Math.round(r.avgSalesPerDay ?? 0)).toBe(2410);
    const avg = (w: number) => Math.round(r.weekdayAverages[w - 1].avg ?? 0);
    expect(avg(1)).toBe(1605); // lunes
    expect(avg(2)).toBe(1770); // martes
    expect(avg(6)).toBe(3350); // sábado
  });

  it("cada $100 adds to exactly 100", () => {
    const parts = r.cada100!;
    expect(parts.map((p) => [p.key, p.pct])).toEqual([
      ["comida", 31],
      ["merma", 1.3],
      ["planilla", 28.5],
      ["alquiler", 8.7],
      ["servicios", 5.2],
      ["otros", 13],
      ["ganancia", 12.3],
    ]);
    const sum = parts.reduce((s, p) => s + Math.round(p.pct * 10), 0);
    expect(sum).toBe(1000);
  });

  it("Impuestos 0%: no Impuestos part in cada $100", () => {
    expect(r.cada100!.some((p) => p.key === "impuestos")).toBe(false);
    expect(r.monthTotals.impuestos).toBe(0);
  });

  it("projection is labelled by day and a closed month has none", () => {
    expect(r.projection).not.toBeNull();
    const closed = sample({ today: "2026-11-02", unplannedWaste: 828 });
    expect(closed.projection).toBeNull();
    expect(closed.isCurrentMonth).toBe(false);
    expect(closed.days.every((d) => !d.projected)).toBe(true);
    expect(closed.days).toHaveLength(31); // every day is actual: none is invented
    expect(closed.days.slice(26).every((d) => d.sales === 0)).toBe(true);
  });
});

describe("Planilla %", () => {
  it("is planilla ÷ the month's Ventas", () => {
    const r = sample();
    expect(r.planillaPct).toBeCloseTo(21400 / r.monthTotals.sales, 8);
    expect(((r.planillaPct ?? 0) * 100).toFixed(1)).toBe("28.5");
  });
  it("is null (never 0%) without planilla or without sales", () => {
    const f = fixed(0);
    f.amounts.planilla = null;
    expect(sample({ fixed: f }).planillaPct).toBeNull();
    expect(
      sample({ dailySales: {}, today: "2026-11-05" }).planillaPct
    ).toBeNull();
  });
});

describe("Impuestos is a rate, subtracted once", () => {
  it("13% rate: tax = Ventas × r ÷ (1 + r), fixed costs stay $41,600", () => {
    const base = sample();
    const taxed = sample({ fixed: fixed(13) });
    const ventas = taxed.monthTotals.sales;
    expect(taxed.monthTotals.impuestos).toBeCloseTo((ventas * 0.13) / 1.13, 6);
    expect(taxed.fixed.total).toBe(41600);
    // margin % drops by 11.5 points (13% of the price-with-tax is 11.5% of sales)
    expect(
      ((base.monthTotals.marginPct ?? 0) - (taxed.monthTotals.marginPct ?? 0)) *
        100
    ).toBeCloseTo(11.5, 1);
    expect(taxed.profit!).toBeLessThan(base.profit!);
    expect(taxed.breakEvenPerDay!).toBeGreaterThan(base.breakEvenPerDay!);
    expect(taxed.impuestosUndefined).toBe(false);
    expect(taxed.cada100!.some((p) => p.key === "impuestos")).toBe(true);
    expect(taxed.cada100!.reduce((s, p) => s + Math.round(p.pct * 10), 0)).toBe(
      1000
    );
  });

  it("no rate: calculated with 0% and flagged", () => {
    const r = sample({ fixed: fixed(null) });
    expect(r.impuestosUndefined).toBe(true);
    expect(r.monthTotals.impuestos).toBe(0);
  });
});

describe("Missing fixed costs", () => {
  it("one missing category: no profit, no break-even, list returned", () => {
    const f = fixed(0);
    f.amounts.servicios = null;
    const r = sample({ fixed: f });
    expect(r.profit).toBeNull();
    expect(r.profitToDate).toBeNull();
    expect(r.breakEvenPerDay).toBeNull();
    expect(r.breakEvenDay).toBeNull();
    expect(r.cada100).toBeNull();
    expect(r.costoPrimo).not.toBeNull(); // planilla is filled
    expect(r.fixed.missingAmounts).toEqual(["servicios"]);
    expect(r.fixed.total).toBeNull();
  });

  it("a typed 0 counts as filled", () => {
    const f = fixed(0);
    f.amounts.otros = 0;
    const r = sample({ fixed: f });
    expect(r.fixed.missingAmounts).toEqual([]);
    expect(r.fixed.total).toBe(31800);
    expect(r.profit).not.toBeNull();
  });
});

describe("Coverage (no gap-fill)", () => {
  const dish = (
    id: number,
    sales: number,
    over: Partial<SoldDish> = {}
  ): SoldDish => ({
    odooProductId: id,
    name: `PLATO ${id}`,
    netSales: sales,
    units: sales / 100,
    unitCost: 31,
    inCogs: true,
    covered: true,
    excluded: false,
    status: "aprobado",
    ...over,
  });

  it("70% covered: food cost only from covered platos, profit still returned", () => {
    const dishes = [
      dish(1, 7000),
      dish(2, 2000, {
        unitCost: null,
        inCogs: false,
        covered: false,
        status: "sin_receta",
      }),
      dish(3, 1000, {
        unitCost: null,
        inCogs: false,
        covered: false,
        status: "borrador",
      }),
    ];
    const f = foodCostFromDishes(dishes);
    expect(f.cogs).toBe(2170); // 70 units × $31, nothing for the other 30%
    expect(f.coveredSales).toBe(7000);
    const r = sample({
      food: f,
      dailySales: { "2026-10-01": 10000 },
      today: "2026-10-02",
      unplannedWaste: 0,
    });
    expect(r.coverage.pct).toBeCloseTo(0.7, 6);
    expect(r.coverage.uncoveredPct).toBeCloseTo(0.3, 6);
    expect(r.profit).not.toBeNull();
    expect(r.coverage.uncovered.map((u) => u.odooProductId)).toEqual([2, 3]);
    expect(r.coverage.uncovered[0].share).toBeCloseTo(0.2, 6);
    expect(r.coverage.uncovered[0].name).toBe("Plato 2");
    expect(r.coverage.uncovered[1].hasDraft).toBe(true);
    expect(r.coverage.uncovered[0].hasDraft).toBe(false);
    expect(r.coverage.coveredMarginPct).toBeCloseTo((7000 - 2170) / 7000, 6);
  });

  it("40% covered: profit still returned with the flag data", () => {
    const f = foodCostFromDishes([
      dish(1, 4000),
      dish(2, 6000, {
        unitCost: null,
        inCogs: false,
        covered: false,
        status: "sin_receta",
      }),
    ]);
    const r = sample({
      food: f,
      dailySales: { "2026-10-01": 10000 },
      today: "2026-10-02",
      unplannedWaste: 0,
    });
    expect(r.coverage.pct).toBeCloseTo(0.4, 6);
    expect(r.profit).not.toBeNull();
    expect(r.coverage.uncovered).toHaveLength(1);
  });

  it("a dish with no price is «Sin precio», uncovered, never $0 of cost", () => {
    const f = foodCostFromDishes([
      dish(1, 5000),
      dish(2, 5000, {
        unitCost: null,
        inCogs: false,
        covered: false,
        status: "falta_precio",
      }),
    ]);
    expect(f.uncovered[0].reason).toBe("sin_precio");
    expect(f.cogs).toBe(1550); // only dish 1: 50 units × $31
  });

  it("a borrador dish is uncovered and adds no cost", () => {
    const f = foodCostFromDishes([
      dish(1, 5000, {
        unitCost: 20,
        inCogs: false,
        covered: false,
        status: "borrador",
      }),
    ]);
    expect(f.cogs).toBe(0);
    expect(f.uncovered[0].reason).toBe("borrador");
  });

  it("excluded products are in neither side of the coverage", () => {
    const f = foodCostFromDishes([
      dish(1, 9000),
      dish(2, 1000, { excluded: true, covered: false, inCogs: false }),
    ]);
    expect(f.foodSales).toBe(9000);
    expect(f.uncovered).toHaveLength(0);
  });
});

describe("Ganancia real vs estimada", () => {
  it("all real → real; an estimated fixed line → estimada", () => {
    expect(sample().basis).toBe("real");
    expect(sample({ fixedHasEstimate: true }).basis).toBe("estimada");
  });

  it("the real-only accessor and the chips never return an estimated value", () => {
    const real = sample();
    const est = sample({ fixedHasEstimate: true });
    expect(realOnly(real)?.profit).toBeCloseTo(real.profit!, 6);
    expect(realOnly(est)).toBeNull();
    const prev = computeRentabilidad({
      month: "2026-09-01",
      today: TODAY,
      dailySales: { "2026-09-01": 81224 },
      food: {
        ...food(),
        cogs: 20000,
        periodSales: 81224,
        foodSales: 81224,
        coveredSales: 81224,
      },
      fixed: fixed(0),
      openWeekdays: null,
      openDays: 30,
    });
    expect(comparisonChips(real, prev)).not.toBeNull();
    expect(comparisonChips(est, prev)).toBeNull();
    expect(comparisonChips(real, { ...prev, basis: "estimada" })).toBeNull();
    expect(comparisonChips(real, null)).toBeNull();
  });
});

describe("Open days", () => {
  it("a month with no shifts uses every day; 6 open days use the shift weekdays", () => {
    expect(openDaysInMonth(MONTH, null)).toBe(31);
    expect(openDaysInMonth(MONTH, [[1, 2, 3, 4, 5, 6]])).toBe(27); // Oct 2026: 4 Sundays
    const six = sample({ openWeekdays: [1, 2, 3, 4, 5, 6], openDays: 27 });
    expect(six.openDays).toBe(27);
    // Sunday 25 would have been closed: nothing is projected on a closed weekday
    const closedSunday = sample({
      today: "2026-10-20",
      openWeekdays: [1, 2, 3, 4, 5, 6],
      openDays: 27,
    });
    const sundays = closedSunday.days.filter(
      (d) => d.weekday === 7 && d.projected
    );
    expect(sundays.every((d) => d.sales === 0)).toBe(true);
  });
});

describe("Findings and business day", () => {
  it("weekdays below the daily break-even and the one that pays", () => {
    const f = miltonFindings(sample());
    expect(f).toHaveLength(1);
    expect(f[0].weekdays).toContain(1); // lunes avg 1605 < 1983
    expect(f[0].payerWeekday).toBe(6); // sábado
  });

  it("the business date is yesterday before the cutoff", () => {
    const now = new Date("2026-10-27T05:30:00Z"); // 23:30 on the 26th in Mexico City (UTC-6)
    expect(businessToday(now, "America/Mexico_City", 0)).toBe("2026-10-26");
    const early = new Date("2026-10-27T08:30:00Z"); // 02:30 on the 27th
    expect(businessToday(early, "America/Mexico_City", 240)).toBe("2026-10-26");
    expect(businessToday(early, "America/Mexico_City", 0)).toBe("2026-10-27");
  });
});

describe("Performance", () => {
  it("computing 12 months from already-loaded data takes milliseconds", () => {
    const started = Date.now();
    for (let i = 1; i <= 12; i++) {
      const month = `2025-${String(i).padStart(2, "0")}-01`;
      computeRentabilidad({
        month,
        today: "2026-10-27",
        dailySales: dailySales,
        food: food(),
        fixed: fixed(0),
        openWeekdays: null,
        openDays: 30,
      });
    }
    expect(Date.now() - started).toBeLessThan(200);
  });
});
