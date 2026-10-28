// Rentabilidad + Costos fijos, Fase 1a (#397/#398). Synthetic data only.

import { describe, expect, it } from "vitest";
import {
  breakEvenPerDay,
  contributionMarginPct,
  effectiveFixedCosts,
  fixedCostCompleteness,
  openDaysInMonth,
  planRepeat,
  splitGroupAmount,
  splitLargestRemainder,
  validateLine,
  lineKey,
  type FixedCostLine,
} from "@/lib/restaurant/fixed-costs";
import { parseTyped } from "@/components/restaurant/costs/FixedCostsTab";

const LOC_A = "11111111-1111-4111-8111-111111111111";
const LOC_B = "22222222-2222-4222-8222-222222222222";
const LOC_C = "33333333-3333-4333-8333-333333333333";

const line = (over: Partial<FixedCostLine>): FixedCostLine => ({
  location_id: LOC_A,
  month: "2026-02-01",
  category: "alquiler",
  label: null,
  amount: 1000,
  pct_of_sales: null,
  currency: "USD",
  source: "manual",
  status: "confirmed",
  repeats: true,
  split_rule: null,
  ...over,
});

/** The DB rule: one row per (scope, month, category), never overwritten. */
function applyRepeat(
  rows: FixedCostLine[],
  source: FixedCostLine[],
  month: string
): FixedCostLine[] {
  return [...rows, ...planRepeat(source, rows, month)];
}

describe("monthly repeat", () => {
  const feb = [
    line({ category: "alquiler", amount: 2500 }),
    line({ category: "planilla", amount: 9000, repeats: false }),
    line({ category: "impuestos", amount: null, pct_of_sales: 13 }),
    line({
      location_id: null,
      category: "servicios",
      amount: 300,
      split_rule: "equal",
    }),
  ];

  it("copies only repeats=true lines into the next month", () => {
    const created = planRepeat(feb, [], "2026-03-01");
    expect(created.map((l) => l.category).sort()).toEqual([
      "alquiler",
      "impuestos",
      "servicios",
    ]);
    expect(created.every((l) => l.month === "2026-03-01")).toBe(true);
    expect(created.every((l) => l.source === "repeat")).toBe(true);
  });

  it("running it twice gives the same rows as once", () => {
    const once = applyRepeat([], feb, "2026-03-01");
    const twice = applyRepeat(once, feb, "2026-03-01");
    expect(twice).toEqual(once);
    expect(new Set(twice.map(lineKey)).size).toBe(twice.length);
  });

  it("never overwrites a value already in the month (a typed 0 included)", () => {
    const existing = [
      line({
        month: "2026-03-01",
        category: "alquiler",
        amount: 0,
        source: "manual",
      }),
    ];
    const rows = applyRepeat(existing, feb, "2026-03-01");
    const alquiler = rows.filter((l) => l.category === "alquiler");
    expect(alquiler).toHaveLength(1);
    expect(alquiler[0].amount).toBe(0);
    expect(alquiler[0].source).toBe("manual");
  });
});

describe("repeat after the user clears a line", () => {
  it("a line deleted in the month is not copied back", () => {
    const feb = [line({ category: "alquiler", amount: 2500 })];
    // Month M: repeat fills it, the user deletes it (history keeps a row).
    const filled = applyRepeat([], feb, "2026-03-01");
    expect(filled).toHaveLength(1);
    const touched = new Set(filled.map(lineKey));
    const afterDelete: FixedCostLine[] = [];
    expect(planRepeat(feb, afterDelete, "2026-03-01", touched)).toEqual([]);
    // Without the history it would come back (the bug).
    expect(planRepeat(feb, afterDelete, "2026-03-01")).toHaveLength(1);
  });

  it("other keys still repeat", () => {
    const feb = [
      line({ category: "alquiler", amount: 2500 }),
      line({ category: "servicios", amount: 300 }),
    ];
    const touched = new Set([
      lineKey({
        location_id: LOC_A,
        month: "2026-03-01",
        category: "alquiler",
      }),
    ]);
    const created = planRepeat(feb, [], "2026-03-01", touched);
    expect(created.map((l) => l.category)).toEqual(["servicios"]);
  });
});

describe("group split, largest remainder", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it("splits $100.00 three ways to the cent", () => {
    const parts = splitLargestRemainder(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(sum(parts)).toBe(10000);
  });

  it("equal rule adds up to the total", () => {
    const shares = splitGroupAmount(100, "equal", [
      { location_id: LOC_A, sales: 5 },
      { location_id: LOC_B, sales: 900 },
      { location_id: LOC_C, sales: null },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(Math.round(sum(shares.map((s) => s.amount)) * 100)).toBe(10000);
  });

  it("sales rule weighs by sales and adds up to the total", () => {
    const shares = splitGroupAmount(100, "sales", [
      { location_id: LOC_A, sales: 1000 },
      { location_id: LOC_B, sales: 2000 },
      { location_id: LOC_C, sales: 4000 },
    ]);
    expect(Math.round(sum(shares.map((s) => s.amount)) * 100)).toBe(10000);
    expect(shares[2].amount).toBeGreaterThan(shares[1].amount);
    expect(shares[1].amount).toBeGreaterThan(shares[0].amount);
  });

  it("sales rule with no sales anywhere falls back to equal", () => {
    const shares = splitGroupAmount(10, "sales", [
      { location_id: LOC_A, sales: null },
      { location_id: LOC_B, sales: 0 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([5, 5]);
  });
});

describe("validateLine", () => {
  const base = { month: "2026-03", location_id: LOC_A };
  it("impuestos stores a % and no amount", () => {
    const r = validateLine({ ...base, category: "impuestos", value: "13" });
    expect(r.ok && r.value).toMatchObject({ amount: null, pct_of_sales: 13 });
  });
  it("other categories store an amount and no %", () => {
    const r = validateLine({ ...base, category: "alquiler", value: 2500 });
    expect(r.ok && r.value).toMatchObject({ amount: 2500, pct_of_sales: null });
  });
  it("a typed 0 is stored as 0; an empty field is not a line", () => {
    const zero = validateLine({ ...base, category: "otros", value: 0 });
    expect(zero.ok && zero.value.amount).toBe(0);
    expect(validateLine({ ...base, category: "otros", value: "" }).ok).toBe(
      false
    );
    expect(validateLine({ ...base, category: "otros", value: null }).ok).toBe(
      false
    );
  });
  it("rejects a % over 100 and negatives", () => {
    expect(
      validateLine({ ...base, category: "impuestos", value: 101 }).ok
    ).toBe(false);
    expect(validateLine({ ...base, category: "planilla", value: -1 }).ok).toBe(
      false
    );
  });
});

describe("completeness", () => {
  it("a typed 0 counts as filled; empty is missing, never 0", () => {
    const costs = effectiveFixedCosts([
      { category: "planilla", amount: 0, pct_of_sales: null },
      { category: "alquiler", amount: 2500, pct_of_sales: null },
    ]);
    expect(costs.amounts.planilla).toBe(0);
    expect(costs.amounts.servicios).toBeNull();
    const c = fixedCostCompleteness(costs);
    expect(c.complete).toBe(false);
    expect(c.missingAmounts).toEqual(["servicios", "otros"]);
    expect(c.missing).toEqual(["servicios", "otros", "impuestos"]);
  });
  it("adds the group share to a restaurant's own line", () => {
    const costs = effectiveFixedCosts(
      [{ category: "servicios", amount: 100, pct_of_sales: null }],
      { servicios: 33.34, otros: 10 }
    );
    expect(costs.amounts.servicios).toBe(133.34);
    expect(costs.amounts.otros).toBe(10);
  });
});

describe("break-even", () => {
  // Sample: fixed $41,600; sales $75,080; margin before fixed costs $50,818
  // (67.68%) → food cost $24,262; 31 open days.
  const margin = { sales: 75080, foodCost: 24262 };
  const amounts = {
    planilla: 25000,
    alquiler: 9000,
    servicios: 5000,
    otros: 2600,
  };

  it("gives $1,983 al día with Impuestos 0%", () => {
    expect(contributionMarginPct(margin, 0)).toBeCloseTo(0.6768, 3);
    const be = breakEvenPerDay({
      amounts,
      impuestosPct: 0,
      margin,
      openDays: 31,
    });
    expect(Math.round(be as number)).toBe(1983);
  });

  it("Impuestos 13% lowers the margin, so the break-even is higher", () => {
    const be0 = breakEvenPerDay({
      amounts,
      impuestosPct: 0,
      margin,
      openDays: 31,
    }) as number;
    const be13 = breakEvenPerDay({
      amounts,
      impuestosPct: 13,
      margin,
      openDays: 31,
    }) as number;
    const cm13 = (75080 - 24262 - 0.13 * 75080) / 75080;
    expect(contributionMarginPct(margin, 13)).toBeCloseTo(cm13, 10);
    expect(be13).toBeCloseTo(41600 / (cm13 * 31), 6);
    expect(be13).toBeGreaterThan(be0);
  });

  it("Impuestos is never added to the fixed costs", () => {
    const be13 = breakEvenPerDay({
      amounts,
      impuestosPct: 13,
      margin,
      openDays: 31,
    }) as number;
    // Treating 13 as a fixed amount would barely move it; as a % it moves it a lot.
    const wrong = (41600 + 13) / (contributionMarginPct(margin, 0)! * 31);
    expect(be13).toBeGreaterThan(wrong * 1.1);
  });

  it("returns null (not 0) when any of the 4 categories is missing", () => {
    for (const cat of Object.keys(amounts) as Array<keyof typeof amounts>) {
      expect(
        breakEvenPerDay({
          amounts: { ...amounts, [cat]: null },
          impuestosPct: 0,
          margin,
          openDays: 31,
        })
      ).toBeNull();
    }
  });

  it("a typed 0 counts as filled", () => {
    const be = breakEvenPerDay({
      amounts: { ...amounts, otros: 0 },
      impuestosPct: 0,
      margin,
      openDays: 31,
    });
    expect(be).not.toBeNull();
    expect(be as number).toBeLessThan(1983);
  });

  it("no margin or no open days → null", () => {
    expect(
      breakEvenPerDay({ amounts, impuestosPct: 0, margin: null, openDays: 31 })
    ).toBeNull();
    expect(
      breakEvenPerDay({ amounts, impuestosPct: 0, margin, openDays: 0 })
    ).toBeNull();
    expect(
      breakEvenPerDay({
        amounts,
        impuestosPct: 0,
        margin: { sales: 0, foodCost: 0 },
        openDays: 31,
      })
    ).toBeNull();
  });

  it("open days: all days without shifts, else the shifts' weekdays", () => {
    expect(openDaysInMonth("2026-03-01", null)).toBe(31);
    expect(openDaysInMonth("2026-03-01", [])).toBe(31);
    // March 2026 starts on a Sunday: Mondays are 2, 9, 16, 23, 30.
    expect(openDaysInMonth("2026-03-01", [[1]])).toBe(5);
    expect(openDaysInMonth("2026-03-01", [[1], [1, 7]])).toBe(10);
  });

  it("recomputes fast enough to run on every keystroke", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++)
      breakEvenPerDay({ amounts, impuestosPct: i % 20, margin, openDays: 31 });
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("typed field", () => {
  it("empty is null (missing); 0 is 0", () => {
    expect(parseTyped("")).toBeNull();
    expect(parseTyped("  ")).toBeNull();
    expect(parseTyped("0")).toBe(0);
    expect(parseTyped("1,250.5")).toBe(1250.5);
    expect(parseTyped("abc")).toBeNull();
  });
});
