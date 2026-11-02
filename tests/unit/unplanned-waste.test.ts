// #408 · unplanned waste: valuation at the day's cost, drafts vs confirmed,
// missing values, the projection and the October sample. Demo data only.
import { describe, expect, it } from "vitest";
import {
  plannedWaste,
  planVsReported,
  projectMonthWaste,
  summarizeWaste,
  valueWasteLine,
} from "@/lib/restaurant/unplanned-waste";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import {
  computeRentabilidad,
  type RentabilidadInput,
} from "@/lib/restaurant/rentabilidad";
import { parseWasteDrafts } from "@/lib/restaurant/waste-drafts";

describe("valuation at the day's cost", () => {
  const base = {
    quantity: 2,
    unit: "kg",
    priceUnit: "kg",
    ownLossPct: null,
    bufferPct: 5,
  };
  it("uses the price of THAT day: a later price does not change it", () => {
    const monday = valueWasteLine({ ...base, price: 10 });
    const friday = valueWasteLine({ ...base, price: 14 });
    expect(monday?.value).toBeCloseTo(21, 9); // 2 kg × $10 × 1.05
    expect(friday?.value).toBeCloseTo(29.4, 9);
  });
  it("goes through the editor's effective cost (own yield, else buffer)", () => {
    const own = valueWasteLine({ ...base, price: 10, ownLossPct: 20 });
    const e = effectiveLineCost({
      amount: 20,
      kind: "ingredient",
      ownYieldLossPct: 20,
      insideMeasuredPrep: false,
      bufferPct: 5,
    });
    expect(own?.value).toBe(e.effective);
  });
  it("converts the written unit to the price unit", () => {
    const g = valueWasteLine({ ...base, price: 10, quantity: 500, unit: "g" });
    expect(g?.value).toBeCloseTo(5.25, 9);
  });
  it("no quantity, no price, price ≤ 0 or no conversion: no value, never 0", () => {
    expect(valueWasteLine({ ...base, price: 10, quantity: null })).toBeNull();
    expect(valueWasteLine({ ...base, price: null })).toBeNull();
    expect(valueWasteLine({ ...base, price: 0 })).toBeNull();
    expect(valueWasteLine({ ...base, price: -2 })).toBeNull();
    expect(valueWasteLine({ ...base, price: 10, unit: "l" })).toBeNull();
  });
});

describe("drafts vs confirmed", () => {
  it("AI drafts count for nothing until a manager confirms", () => {
    const s = summarizeWaste([
      { status: "draft", value: 500 },
      { status: "draft", value: null },
      { status: "confirmed", value: 12.5 },
    ]);
    expect(s).toEqual({ amount: 12.5, counted: 1, missing: 0, drafts: 2 });
  });
  it("a confirmed line without a value is counted and flagged, not added as 0", () => {
    const s = summarizeWaste([
      { status: "confirmed", value: 40 },
      { status: "confirmed", value: null },
      { status: "confirmed", value: 0 },
    ]);
    expect(s.counted).toBe(3);
    expect(s.missing).toBe(2);
    expect(s.amount).toBe(40);
  });
});

describe("the AI only drafts (item, quantity, unit)", () => {
  it("keeps what is valid and invents nothing", () => {
    const out = parseWasteDrafts({
      items: [
        { item: " Tomate demo ", quantity: 3, unit: "kg" },
        { item: "Leche demo", quantity: "n/a", unit: "litros" },
        { item: "", quantity: 2, unit: "kg" },
        { item: "Pan demo", quantity: -1, unit: "x?" },
        null,
      ],
    });
    expect(out).toEqual([
      { item: "Tomate demo", quantity: 3, unit: "kg" },
      { item: "Leche demo", quantity: null, unit: expect.anything() },
      { item: "Pan demo", quantity: null, unit: null },
    ]);
    expect(parseWasteDrafts("nope")).toEqual([]);
  });
});

describe("projection", () => {
  it("daily average × days of the month", () => {
    expect(projectMonthWaste(828, 26, 31)).toBe(987.23);
    expect(projectMonthWaste(100, 0, 31)).toBeNull();
  });
});

describe("the sample case", () => {
  const SALES = [
    2280, 2790, 3430, 2520, 1660, 1760, 2000, 2350, 2730, 3310, 2510, 1540,
    1780, 2260, 2210, 2820, 3420, 2890, 1670, 1770, 2310, 2180, 3120, 3240,
    2550, 1550,
  ];
  const dailySales = Object.fromEntries(
    SALES.map((s, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, s])
  );
  const total = SALES.reduce((a, b) => a + b, 0);
  const input: RentabilidadInput = {
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales,
    food: {
      cogs: total * 0.31,
      periodSales: total,
      foodSales: total,
      coveredSales: total,
      uncovered: [],
    },
    unplannedWaste: 828,
    waste: { available: true, counted: 14, missing: 0 },
    wastePlan: planVsReported({ purchases: 8716, planned: 523, reported: 828 }),
    fixed: {
      amounts: {
        planilla: 21400,
        alquiler: 6500,
        servicios: 3900,
        otros: 9800,
      },
      impuestosPct: 0,
    },
    openWeekdays: null,
    openDays: 31,
  };

  it("$828 over 26 days → $987 projected, 1,3% of sales", () => {
    const r = computeRentabilidad(input);
    expect(Math.round(r.monthTotals.waste)).toBe(987);
    expect((r.wastePctOfSales ?? 0) * 100).toBeCloseTo(1.3, 1);
    expect(r.wasteAvailable).toBe(true);
  });
  it("9,5% of purchase cost reported; planned vs reported difference", () => {
    const p = planVsReported({ purchases: 8716, planned: 523, reported: 828 });
    expect(p?.reportedPct).toBe(9.5);
    expect(p?.plannedPct).toBe(6);
    expect(p?.difference).toBe(305);
  });
  it("planned waste is each purchase × its loss %", () => {
    expect(
      plannedWaste([
        { cost: 100, lossPct: 10 },
        { cost: 200, lossPct: 5 },
        { cost: 0, lossPct: 50 },
      ])
    ).toBe(20);
  });
  it("without confirmed lines the line is «⚑ Falta» (not available), not $0", () => {
    const none = computeRentabilidad({
      ...input,
      unplannedWaste: 0,
      waste: { available: true, counted: 0, missing: 0 },
    });
    expect(none.wasteAvailable).toBe(false);
    const noTable = computeRentabilidad({
      ...input,
      unplannedWaste: 0,
      waste: { available: false, counted: 0, missing: 0 },
    });
    expect(noTable.wasteAvailable).toBe(false);
  });
  it("lines without a value are counted and carried to the page", () => {
    const r = computeRentabilidad({
      ...input,
      waste: { available: true, counted: 14, missing: 3 },
    });
    expect(r.wasteMissing).toBe(3);
  });
});
