// Lines the kitchen could only half read are kept (never dropped) and marked:
// «Sin precio» for a missing price, «Falta» for a missing quantity or unit.
import { describe, expect, it } from "vitest";
import {
  clearMissing,
  encodeMissing,
  parseMissing,
} from "@/lib/restaurant/invoice-missing";
import { buildInvoiceLineSummaries } from "@/lib/restaurant/invoice-list-preview";

describe("the «[falta:…]» marker", () => {
  it("round-trips and ignores anything else in the notes", () => {
    expect(encodeMissing([])).toBeNull();
    expect(encodeMissing(["unit", "quantity"])).toBe("[falta:cantidad,unidad]");
    expect(parseMissing("[falta:cantidad,unidad]")).toEqual([
      "quantity",
      "unit",
    ]);
    expect(parseMissing("nota del gerente [falta:unidad]")).toEqual(["unit"]);
    expect(parseMissing("[falta:otra]")).toEqual([]);
    expect(parseMissing(null)).toEqual([]);
    expect(parseMissing(42)).toEqual([]);
  });

  it("filling a field removes only that field and keeps the manager's own note", () => {
    expect(clearMissing("[falta:cantidad,unidad]", ["quantity"])).toBe(
      "[falta:unidad]"
    );
    expect(clearMissing("[falta:cantidad,unidad]", ["quantity", "unit"])).toBe(
      null
    );
    expect(clearMissing("revisar con Luis [falta:unidad]", ["unit"])).toBe(
      "revisar con Luis"
    );
    expect(clearMissing(null, ["unit"])).toBeNull();
  });
});

describe("the Total column of a kitchen draft", () => {
  const row = (over: Record<string, unknown>) => ({
    invoice_id: "i1",
    match_status: "unmatched",
    review_status: "pending",
    description: "pan",
    ...over,
  });
  const amounts = (rows: Record<string, unknown>[]) =>
    buildInvoiceLineSummaries(["i1"], rows as never, new Map()).get("i1")!
      .amounts;

  it("is the sum of quantity × price when every line has both", () => {
    expect(
      amounts([
        row({ id: "a", quantity: 3, unit_cost: 2, line_total: 6 }),
        row({ id: "b", quantity: 2, unit_cost: 0.75, line_total: 1.5 }),
      ])
    ).toEqual({ total: 7.5, priced: true });
  });

  it("has no total when a quantity is missing (price said), and says a price exists", () => {
    expect(
      amounts([
        row({
          id: "a",
          quantity: 1,
          unit_cost: 2,
          line_total: 2,
          notes: "[falta:cantidad,unidad]",
        }),
      ])
    ).toEqual({ total: null, priced: true });
  });

  it("is «Sin precio» (no total, nothing priced) when no line has a price", () => {
    expect(
      amounts([
        row({ id: "a", quantity: 1, unit_cost: null, line_total: 0 }),
        row({ id: "b", quantity: 3, unit_cost: null, line_total: 0 }),
      ])
    ).toEqual({ total: null, priced: false });
  });

  it("one unknown line makes the whole total unknown (never a partial sum)", () => {
    expect(
      amounts([
        row({ id: "a", quantity: 3, unit_cost: 2, line_total: 6 }),
        row({ id: "b", quantity: 1, unit_cost: null, line_total: 0 }),
      ])
    ).toEqual({ total: null, priced: true });
  });

  it("the preview carries what is missing, for «Falta»", () => {
    const entry = buildInvoiceLineSummaries(
      ["i1"],
      [
        row({
          id: "a",
          quantity: 1,
          unit: "unidad",
          unit_cost: null,
          line_total: 0,
          notes: "[falta:cantidad,unidad]",
        }),
      ] as never,
      new Map()
    ).get("i1")!;
    expect(entry.preview[0].missing).toEqual(["quantity", "unit"]);
  });
});
