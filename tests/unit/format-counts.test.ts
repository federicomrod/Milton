import { describe, it, expect } from "vitest";
import {
  formatChipQuantity,
  formatCount,
} from "@/lib/restaurant/format-counts";

describe("formatCount", () => {
  it("locale-formats integers without a decimal", () => {
    expect(formatCount(1234)).toBe("1,234");
  });

  it("caps fractional units at two decimal places", () => {
    expect(formatCount(1.3333333)).toBe("1.33");
    expect(formatCount(12.5)).toBe("12.5");
  });

  it("never prints NaN or Infinity", () => {
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatChipQuantity", () => {
  it("labels a singular item", () => {
    expect(formatChipQuantity(1)).toBe("1 item");
  });

  it("labels a plural integer count", () => {
    expect(formatChipQuantity(1234)).toBe("1,234 items");
  });

  it("does not print a raw Odoo float on a chip", () => {
    expect(formatChipQuantity(2.333333333)).toBe("2.33 items");
    expect(formatChipQuantity(2.333333333)).not.toMatch(/2\.333333333/);
  });
});
