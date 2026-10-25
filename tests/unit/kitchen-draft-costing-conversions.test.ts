import { describe, expect, it } from "vitest";
import { computeDraftCost } from "@/lib/restaurant/kitchen-draft-costing";

const TOMATE = "ing-tomate";
const prices = new Map([[TOMATE, { unit_cost: 0.1, unit: "oz" }]]);
const lines = [
  {
    key: "l1",
    ingredient_id: TOMATE,
    name: "Tomate",
    total_quantity: 6,
    unit: "unidad",
  },
];

describe("a unit with an ingredient conversion is costed", () => {
  it("«1 unidad = 4 oz» at $0.10/oz: 6 unidad cost 6 × 4 × 0.10", () => {
    const cost = computeDraftCost(
      lines,
      prices,
      4,
      null,
      new Map([[TOMATE, [{ from_unit: "unidad", to_unit: "oz", factor: 4 }]]])
    );
    expect(cost.lines[0].reason).toBe("ok");
    expect(cost.lines[0].line_cost).toBeCloseTo(2.4, 10);
    expect(cost.complete).toBe(true);
    expect(cost.unconverted_count).toBe(0);
  });
  it("the inverse direction (1 oz = 0.25 unidad) works too", () => {
    const cost = computeDraftCost(
      lines,
      prices,
      4,
      null,
      new Map([
        [TOMATE, [{ from_unit: "oz", to_unit: "unidad", factor: 0.25 }]],
      ])
    );
    expect(cost.lines[0].line_cost).toBeCloseTo(2.4, 10);
  });
});

describe("no conversion: uncosted, never $0, the recipe is partial", () => {
  it("reason «conversion», no line cost, no total", () => {
    const cost = computeDraftCost(lines, prices, 4, null);
    expect(cost.lines[0].reason).toBe("conversion");
    expect(cost.lines[0].line_cost).toBeNull();
    expect(cost.complete).toBe(false);
    expect(cost.total).toBeNull();
    expect(cost.unconverted_count).toBe(1);
    expect(cost.unpriced_count).toBe(0);
    expect(cost.missing).toEqual(["Tomate"]);
  });
  it("another ingredient's conversion is not used", () => {
    const cost = computeDraftCost(
      lines,
      prices,
      4,
      null,
      new Map([["other", [{ from_unit: "unidad", to_unit: "oz", factor: 4 }]]])
    );
    expect(cost.lines[0].line_cost).toBeNull();
  });
});
