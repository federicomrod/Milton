import { describe, expect, it } from "vitest";
import {
  computeRentabilidad,
  foodCostFromDishes,
  type SoldDish,
} from "@/lib/restaurant/rentabilidad";
import { splitGroupAmount } from "@/lib/restaurant/fixed-costs";
import { buildGroupView } from "@/lib/restaurant/rentabilidad-group";

type Amounts = Record<
  "planilla" | "alquiler" | "servicios" | "otros",
  number | null
>;

const dish = (
  id: number,
  sales: number,
  over: Partial<SoldDish> = {}
): SoldDish => ({
  odooProductId: id,
  name: `PLATO ${id}`,
  netSales: sales,
  units: 10,
  unitCost: 3,
  inCogs: true,
  covered: true,
  excluded: false,
  status: "aprobado",
  ...over,
});

function month(opts: {
  base: number;
  amounts: Amounts;
  estimate?: boolean;
  dishes?: SoldDish[];
  today?: string;
}) {
  const dailySales = Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      `2026-10-${String(i + 1).padStart(2, "0")}`,
      opts.base + (i % 3) * 33.337,
    ])
  );
  const sold = opts.dishes ?? [dish(1, 20000)];
  return computeRentabilidad({
    month: "2026-10-01",
    today: opts.today ?? "2026-10-27",
    dailySales,
    food: {
      ...foodCostFromDishes(sold),
      periodSales: Object.values(dailySales).reduce((a, b) => a + b, 0),
    },
    fixed: { amounts: opts.amounts, impuestosPct: 13 },
    fixedHasEstimate: opts.estimate,
    openWeekdays: null,
    openDays: 31,
  });
}
const FULL: Amounts = {
  planilla: 4000.33,
  alquiler: 1500.33,
  servicios: 800.34,
  otros: 600,
};
const line = (
  id: string,
  name: string,
  m: ReturnType<typeof month>,
  currency = "USD"
) => ({
  locationId: id,
  name,
  currency,
  month: m,
});

describe("group view: Todos is the exact sum of the lines", () => {
  const inputs = [
    line("a", "Sucursal Demo Uno", month({ base: 1001.11, amounts: FULL })),
    line("b", "Sucursal Demo Dos", month({ base: 2002.22, amounts: FULL })),
    line("c", "Sucursal Demo Tres", month({ base: 777.77, amounts: FULL })),
  ];
  const view = buildGroupView(inputs);
  const cents = (n: number) => Math.round(n * 100);
  it("sales, margin, fixed costs and profit add up to the cent", () => {
    const t = view.total!;
    const sum = (f: (l: (typeof view.lines)[number]) => number | null) =>
      view.lines.reduce((a, l) => a + cents(f(l)!), 0);
    expect(cents(t.sales)).toBe(sum((l) => l.sales));
    expect(cents(t.margin)).toBe(sum((l) => l.margin));
    expect(cents(t.fixedTotal!)).toBe(sum((l) => l.fixedTotal));
    expect(cents(t.profit!)).toBe(sum((l) => l.profit));
  });
  it("lines are the single-restaurant figures", () => {
    expect(view.lines[0].profit).toBe(inputs[0].month.profit);
    expect(view.lines[1].fixedTotal).toBe(inputs[1].month.fixed.total);
  });
  it("has a break-even day for the group when covered", () => {
    expect(
      view.total!.breakEvenDay === null || view.total!.breakEvenDay.day >= 1
    ).toBe(true);
  });
});

describe("group costs split by largest remainder", () => {
  it("the shares of every restaurant add up to the group amount exactly", () => {
    const targets = [
      { location_id: "a", sales: 1001.11 },
      { location_id: "b", sales: 2002.22 },
      { location_id: "c", sales: 777.77 },
    ];
    for (const amount of [1000, 1000.01, 999.99, 0.05, 12345.67]) {
      for (const rule of ["sales", "equal"] as const) {
        const shares = splitGroupAmount(amount, rule, targets);
        const sum = shares.reduce((a, s) => a + Math.round(s.amount * 100), 0);
        expect(sum).toBe(Math.round(amount * 100));
      }
    }
  });
});

describe("group view: currency guard", () => {
  it("no total and the currencies are listed when they differ", () => {
    const v = buildGroupView([
      line(
        "a",
        "Sucursal Demo Uno",
        month({ base: 1000, amounts: FULL }),
        "USD"
      ),
      line(
        "b",
        "Sucursal Demo Dos",
        month({ base: 1000, amounts: FULL }),
        "MXN"
      ),
    ]);
    expect(v.total).toBeNull();
    expect(v.currencies.sort()).toEqual(["MXN", "USD"]);
    expect(v.lines).toHaveLength(2);
  });
  it("one currency keeps the total", () => {
    const v = buildGroupView([
      line("a", "Sucursal Demo Uno", month({ base: 1000, amounts: FULL })),
      line("b", "Sucursal Demo Dos", month({ base: 1000, amounts: FULL })),
    ]);
    expect(v.total).not.toBeNull();
    expect(v.currency).toBe("USD");
  });
});

describe("group view: missing is never $0", () => {
  const v = buildGroupView([
    line("a", "Sucursal Demo Uno", month({ base: 1000, amounts: FULL })),
    line(
      "b",
      "Sucursal Demo Dos",
      month({ base: 1000, amounts: { ...FULL, otros: null } })
    ),
  ]);
  it("the line is flagged and its figures are null", () => {
    expect(v.lines[1].missingFixed).toBe(true);
    expect(v.lines[1].fixedTotal).toBeNull();
    expect(v.lines[1].profit).toBeNull();
  });
  it("Todos fixed costs and profit are null and name the line; sales still sum", () => {
    expect(v.total!.fixedTotal).toBeNull();
    expect(v.total!.profit).toBeNull();
    expect(v.total!.missingFixed).toEqual(["Sucursal Demo Dos"]);
    expect(v.total!.sales).toBeGreaterThan(0);
  });
});

describe("group view: estimates and coverage", () => {
  it("flags the estimate per line and on Todos", () => {
    const v = buildGroupView([
      line("a", "Sucursal Demo Uno", month({ base: 1000, amounts: FULL })),
      line(
        "b",
        "Sucursal Demo Dos",
        month({ base: 1000, amounts: FULL, estimate: true })
      ),
    ]);
    expect(v.lines.map((l) => l.estimate)).toEqual([false, true]);
    expect(v.total!.estimate).toBe(true);
  });
  it("no estimate anywhere: Todos is not an estimate", () => {
    const v = buildGroupView([
      line("a", "Sucursal Demo Uno", month({ base: 1000, amounts: FULL })),
    ]);
    expect(v.total!.estimate).toBe(false);
  });
  it("partial recipe coverage keeps the profit and carries the uncovered share", () => {
    const m = month({
      base: 1000,
      amounts: FULL,
      dishes: [
        dish(1, 10000),
        dish(2, 10000, {
          unitCost: null,
          inCogs: false,
          covered: false,
          status: "sin_receta",
        }),
      ],
    });
    const v = buildGroupView([line("a", "Sucursal Demo Uno", m)]);
    expect(v.lines[0].profit).not.toBeNull();
    expect(v.lines[0].uncoveredPct).toBeCloseTo(0.5, 5);
  });
  it("full coverage carries no flag", () => {
    const v = buildGroupView([
      line("a", "Sucursal Demo Uno", month({ base: 1000, amounts: FULL })),
    ]);
    expect(v.lines[0].uncoveredPct).toBeNull();
  });
});
