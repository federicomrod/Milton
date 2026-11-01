// History derived from the rows, and the one-factor effective cost.
import { describe, expect, it } from "vitest";
import {
  buildHistory,
  defaultBufferPct,
  yieldAt,
  type HistoryRow,
  type IngredientYieldRow,
} from "@/lib/restaurant/yield-buffer";
import { currentYield } from "@/lib/restaurant/ingredient-yield-view";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";

const h = (
  id: string,
  pct: number,
  from: string,
  created: string,
  by: string | null = "u1"
): HistoryRow => ({
  id,
  pct,
  effective_from: from,
  created_at: created,
  created_by: by,
});

describe("buildHistory", () => {
  const rows = [
    h("1", 8, "2026-11-03", "2026-11-03T10:00:00Z"), // desde hoy
    h("2", 6, "2026-09-15", "2026-11-10T10:00:00Z"), // retroactivo
    h("3", 12, "2026-11-20", "2026-11-20T09:00:00Z", null), // desde hoy
  ];
  const out = buildHistory(rows, defaultBufferPct);
  it("is newest first and says desde hoy / retroactivo from the rows", () => {
    expect(out.map((e) => e.id)).toEqual(["3", "2", "1"]);
    expect(out.map((e) => e.kind)).toEqual(["today", "retroactive", "today"]);
  });
  it("shows old → new, the old of the first row being the read-time default", () => {
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId["1"].oldPct).toBe(5); // default after the cutover
    expect(byId["1"].newPct).toBe(8);
    expect(byId["2"].oldPct).toBe(0); // 2026-09-15: default before the cutover
    expect(byId["2"].newPct).toBe(6);
    expect(byId["3"].oldPct).toBe(6); // the retroactive row is in force on Nov 20
    expect(byId["3"].newPct).toBe(12);
  });
  it("without a default the first old is null (a yield: no value, never 0)", () => {
    const y = buildHistory([h("a", 20, "2026-11-03", "2026-11-03T10:00:00Z")]);
    expect(y[0].oldPct).toBeNull();
    expect(y[0].userId).toBe("u1");
  });
  it("is read-only: the input rows are untouched", () => {
    const before = JSON.stringify(rows);
    buildHistory(rows, defaultBufferPct);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("yields follow the same rule", () => {
  const y = (
    id: string,
    pct: number,
    from: string,
    created: string,
    status: "draft" | "approved" = "approved"
  ): IngredientYieldRow => ({
    id,
    ingredient_id: "ing",
    loss_pct: pct,
    source: "manual",
    status,
    effective_from: from,
    created_at: created,
  });
  it("only approved rows count; the newest created that applies wins", () => {
    const rows = [
      y("a", 10, "2026-01-01", "2026-01-01T00:00:00Z"),
      y("b", 30, "2026-02-01", "2026-02-01T00:00:00Z", "draft"),
      y("c", 20, "2026-01-01", "2026-11-10T00:00:00Z"), // retroactive
    ];
    expect(yieldAt(rows, "ing", "2026-06-01")?.lossPct).toBe(20);
    expect(yieldAt(rows, "other", "2026-06-01")).toBeNull();
  });
  it("currentYield is null with no history (no yield set, not 0)", () => {
    expect(currentYield([], "2026-11-05")).toBeNull();
    const hist = buildHistory([
      h("a", 15, "2026-11-03", "2026-11-03T10:00:00Z"),
    ]);
    expect(currentYield(hist, "2026-11-05")).toBe(15);
    expect(currentYield(hist, "2026-11-02")).toBeNull();
  });
});

describe("effectiveLineCost: one factor per line", () => {
  const base = {
    kind: "ingredient" as const,
    ownYieldLossPct: null,
    insideMeasuredPrep: false,
    bufferPct: 5,
  };
  it("the worked example: $3.39 at full precision, rounded only at the total", () => {
    const brisket = effectiveLineCost({
      ...base,
      amount: 0.2 * 10,
      ownYieldLossPct: 35,
    });
    const rice = effectiveLineCost({ ...base, amount: 0.15 * 2 });
    expect(brisket.factor).toBe("own_yield");
    expect(brisket.effective).toBeCloseTo(3.0769, 4);
    expect(rice.factor).toBe("kitchen_buffer");
    expect(rice.effective).toBeCloseTo(0.315, 6);
    const total = (brisket.effective as number) + (rice.effective as number);
    expect(total.toFixed(2)).toBe("3.39");
  });
  it("own yield first, even inside a measured preparation and with a buffer", () => {
    const r = effectiveLineCost({
      ...base,
      amount: 10,
      ownYieldLossPct: 20,
      insideMeasuredPrep: true,
    });
    expect(r).toMatchObject({ factor: "own_yield", pct: 20 });
    expect(r.effective).toBeCloseTo(12.5, 10);
  });
  it("a measured preparation: no buffer", () => {
    expect(
      effectiveLineCost({ ...base, amount: 10, insideMeasuredPrep: true })
    ).toEqual({
      effective: 10,
      factor: "measured_prep",
      pct: null,
    });
  });
  it("otherwise the kitchen buffer, once", () => {
    expect(effectiveLineCost({ ...base, amount: 10 })).toEqual({
      effective: 10.5,
      factor: "kitchen_buffer",
      pct: 5,
    });
    expect(
      effectiveLineCost({ ...base, amount: 10, bufferPct: 0 }).effective
    ).toBe(10);
  });
  it("preparations, own-cost lines and missing prices are not adjusted", () => {
    expect(
      effectiveLineCost({ ...base, kind: "component", amount: 10 }).factor
    ).toBe("none");
    expect(
      effectiveLineCost({ ...base, amount: 10, ownCost: true }).effective
    ).toBe(10);
    expect(effectiveLineCost({ ...base, amount: null })).toEqual({
      effective: null,
      factor: "none",
      pct: null,
    });
  });
});
