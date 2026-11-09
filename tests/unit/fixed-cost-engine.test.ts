// The ONE financial engine for fixed costs (lib/restaurant/fixed-cost-engine.ts).
// Pure and synthetic: complete / partial / unavailable, confirmed zero, missing
// is never 0, tax source, and parity between Costos and Rentabilidad.
import { describe, expect, it } from "vitest";
import {
  computeFixedFigures,
  missingCategories,
} from "@/lib/restaurant/fixed-cost-engine";
import {
  breakEvenPerDay,
  effectiveFixedCosts,
} from "@/lib/restaurant/fixed-costs";
import { figuresOf } from "@/lib/restaurant/fixed-cost-clusters";
import { computeRentabilidad } from "@/lib/restaurant/rentabilidad";

const MONTH = "2026-10-01";
const margin = { sales: 100000, foodCost: 30000 };
const amounts = (o: Partial<Record<string, number | null>> = {}) => ({
  planilla: 20000,
  alquiler: 7000,
  servicios: 2450,
  otros: 500,
  ...o,
});
const run = (
  a: Record<string, number | null>,
  over: Partial<Parameters<typeof computeFixedFigures>[0]> = {}
) =>
  computeFixedFigures({
    month: MONTH,
    costs: { amounts: a as never, impuestosPct: 10 },
    taxSource: "local",
    margin,
    openDays: 30,
    ...over,
  });

describe("status contract", () => {
  it("complete: all four categories, a margin, open days and a tax rate", () => {
    const f = run(amounts());
    expect(f.status).toBe("complete");
    expect(f.missing).toEqual([]);
    const cm = (100000 - (100000 * 0.1) / 1.1 - 30000) / 100000;
    expect(f.breakEven).toBeCloseTo(29950 / (cm * 30), 2);
    expect(f.confirmed).toBe(5);
    expect(f.totalCategories).toBe(5);
  });

  it("partial: the known categories give a number and the gaps are named; a gap is never 0", () => {
    const f = run(amounts({ servicios: null, otros: null }));
    expect(f.status).toBe("partial");
    expect(f.total).toBe(27000);
    expect(missingCategories(f)).toEqual(["servicios", "otros"]);
    expect(f.breakEven).not.toBeNull();
    expect(f.confirmed).toBe(3); // planilla, alquiler + the tax rate
  });

  it("a confirmed 0 is a figure, not a gap", () => {
    const f = run(amounts({ otros: 0 }));
    expect(f.status).toBe("complete");
    expect(f.known).toContain("otros");
  });

  it("unavailable: nothing known → no number (never 0)", () => {
    const f = run({
      planilla: null,
      alquiler: null,
      servicios: null,
      otros: null,
    });
    expect(f.status).toBe("unavailable");
    expect(f.breakEven).toBeNull();
    expect(f.total).toBeNull();
  });

  it("unavailable: no sales, a non-positive margin, or no open days say why (no divide by zero)", () => {
    expect(run(amounts(), { margin: null })).toMatchObject({
      status: "unavailable",
      breakEven: null,
    });
    expect(run(amounts(), { margin: null }).missing).toContainEqual({
      kind: "margin",
      reason: "no_sales",
    });
    const loss = run(amounts(), { margin: { sales: 100, foodCost: 200 } });
    expect(loss.status).toBe("unavailable");
    expect(loss.missing).toContainEqual({
      kind: "margin",
      reason: "not_positive",
    });
    const closed = run(amounts(), { openDays: 0 });
    expect(closed.breakEven).toBeNull();
    expect(closed.missing).toContainEqual({ kind: "open_days" });
  });

  it("a missing tax rate is NOT guessed: the figure is partial and says the tax is missing", () => {
    const f = computeFixedFigures({
      month: MONTH,
      costs: { amounts: amounts() as never, impuestosPct: null },
      taxSource: null,
      margin,
      openDays: 30,
    });
    expect(f.status).toBe("partial");
    expect(f.missing).toEqual([{ kind: "tax" }]);
    expect(f.tax).toEqual({ kind: "missing" });
    expect(f.confirmed).toBe(4);
  });
});

describe("tax source: local override versus inherited group rate, never silently merged", () => {
  const base = { amounts: amounts() as never };
  it("labels the source and the month, and keeps 13% and 15% apart", () => {
    const local = computeFixedFigures({
      month: "2026-10-01",
      costs: { ...base, impuestosPct: 13 },
      taxSource: "local",
      margin,
      openDays: 30,
    });
    const group = computeFixedFigures({
      month: "2026-11-01",
      costs: { ...base, impuestosPct: 15 },
      taxSource: "group",
      margin,
      openDays: 30,
    });
    expect(local.tax).toEqual({ kind: "local", month: "2026-10-01", rate: 13 });
    expect(group.tax).toEqual({ kind: "group", month: "2026-11-01", rate: 15 });
    expect(group.breakEven!).toBeGreaterThan(local.breakEven!);
  });
});

describe("one function everywhere (parity)", () => {
  it("the engine equals the approved formula when complete", () => {
    const c = effectiveFixedCosts(
      [
        { category: "planilla", amount: 20000, pct_of_sales: null },
        { category: "alquiler", amount: 7000, pct_of_sales: null },
        { category: "servicios", amount: 2450, pct_of_sales: null },
        { category: "otros", amount: 500, pct_of_sales: null },
        { category: "impuestos", amount: null, pct_of_sales: 10 },
      ],
      {},
      null
    );
    const old = breakEvenPerDay({
      amounts: c.amounts,
      impuestosPct: c.impuestosPct,
      margin,
      openDays: 30,
    });
    const f = computeFixedFigures({
      month: MONTH,
      costs: c,
      taxSource: "local",
      margin,
      openDays: 30,
    });
    expect(f.breakEven).toBeCloseTo(old as number, 2);
  });

  it("the Costos preview (figuresOf) and the server engine agree for the same confirmed inputs", () => {
    const clusters = {
      planilla: { value: 20000, source: "upload", label: null },
      alquiler: { value: 7000, source: "upload", label: null },
      impuestos: { value: 10, source: "manual", label: null },
    };
    const preview = figuresOf({
      clusters,
      groupShares: { servicios: 2450 },
      groupImpuestosPct: null,
      margin,
      openDays: 30,
      month: MONTH,
    });
    const server = computeFixedFigures({
      month: MONTH,
      costs: effectiveFixedCosts(
        [
          { category: "planilla", amount: 20000, pct_of_sales: null },
          { category: "alquiler", amount: 7000, pct_of_sales: null },
          { category: "impuestos", amount: null, pct_of_sales: 10 },
        ],
        { servicios: 2450 },
        null
      ),
      taxSource: "local",
      margin,
      openDays: 30,
    });
    expect(preview.breakEven).toBe(server.breakEven);
    expect(preview.engine.status).toBe(server.status);
    expect(preview.engine.missing).toEqual(server.missing);
  });

  it("Rentabilidad's month carries the same engine result, and its complete figure equals Costos'", () => {
    const costs = effectiveFixedCosts(
      [
        { category: "planilla", amount: 20000, pct_of_sales: null },
        { category: "alquiler", amount: 7000, pct_of_sales: null },
        { category: "servicios", amount: 2450, pct_of_sales: null },
        { category: "otros", amount: 500, pct_of_sales: null },
        { category: "impuestos", amount: null, pct_of_sales: 10 },
      ],
      {},
      null
    );
    const dailySales: Record<string, number> = {};
    for (let d = 1; d <= 31; d++)
      dailySales[`2026-10-${String(d).padStart(2, "0")}`] = 100000 / 31;
    const r = computeRentabilidad({
      month: MONTH,
      today: "2026-11-02",
      dailySales,
      food: {
        cogs: 30000,
        periodSales: 100000,
        coveredSales: 100000,
        foodSales: 100000,
        uncovered: [],
      } as never,
      fixed: costs,
      fixedTaxSource: "local",
      openWeekdays: null,
      openDays: 31,
    } as never);
    expect(r.figures.status).toBe("complete");
    expect(r.breakEvenPerDay).toBe(
      Math.round(r.figures.breakEven! * 100) / 100
    );
  });

  it("incomplete inputs: Rentabilidad keeps the complete figure null and exposes the labelled partial one", () => {
    const costs = effectiveFixedCosts(
      [{ category: "planilla", amount: 20000, pct_of_sales: null }],
      {},
      null
    );
    const dailySales: Record<string, number> = {};
    for (let d = 1; d <= 31; d++)
      dailySales[`2026-10-${String(d).padStart(2, "0")}`] = 100000 / 31;
    const r = computeRentabilidad({
      month: MONTH,
      today: "2026-11-02",
      dailySales,
      food: {
        cogs: 30000,
        periodSales: 100000,
        coveredSales: 100000,
        foodSales: 100000,
        uncovered: [],
      } as never,
      fixed: costs,
      openWeekdays: null,
      openDays: 31,
    } as never);
    expect(r.breakEvenPerDay).toBeNull();
    expect(r.figures.status).toBe("partial");
    expect(r.figures.breakEven).not.toBeNull();
    expect(missingCategories(r.figures)).toEqual([
      "alquiler",
      "servicios",
      "otros",
      "impuestos",
    ]);
  });
});
