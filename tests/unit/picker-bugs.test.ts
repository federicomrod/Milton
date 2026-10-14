// R1-10 Step 0: the two picker bugs. Synthetic data.

import { describe, expect, it } from "vitest";
import {
  pickerUnit,
  unitsLike,
} from "@/lib/restaurant/recipe-costing/picker-units";
import { carryTypedPrice } from "@/lib/restaurant/recipe-import/typed-price";

const lomo = { kind: "ingredient", id: "i1", unit: "lb" };
const huevo = { kind: "ingredient", id: "i2", unit: "unit" };

describe("(a) the picker uses the unit it shows", () => {
  it("uses a unit changed on the highlighted row even if no row was clicked", () => {
    // Before: add() ignored this and used the item's first unit.
    expect(pickerUnit(lomo, { key: "ingredient:i1", unit: "lb" })).toBe("lb");
    expect(pickerUnit(lomo, null)).toBe(unitsLike("lb")[0]);
  });

  it("resets to a valid unit when the highlighted item changes", () => {
    const choice = { key: "ingredient:i1", unit: "kg" };
    expect(pickerUnit(huevo, choice)).toBe("unit");
    expect(pickerUnit(null, choice)).toBe("unit");
  });
});

describe("(b) a hand-typed line price survives a unit change on re-import", () => {
  it("keeps it in the same unit", () => {
    expect(carryTypedPrice({ unit: "oz", unit_cost: 0.5 }, "oz")).toEqual({
      kind: "kept",
      unit_cost: 0.5,
    });
  });

  it("converts it to another unit of the same kind (oz → lb)", () => {
    const r = carryTypedPrice({ unit: "oz", unit_cost: 0.5 }, "lb");
    expect(r.kind).toBe("converted");
    if (r.kind === "converted") expect(r.unit_cost).toBeCloseTo(8, 6);
  });

  it("reports a price it cannot convert instead of dropping it silently", () => {
    expect(carryTypedPrice({ unit: "lb", unit_cost: 6 }, "unit")).toEqual({
      kind: "not_carried",
    });
  });
});
