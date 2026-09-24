import { describe, it, expect } from "vitest";
import {
  normalizeConceptType,
  normalizeLocationCountBucket,
  normalizePosSystemChoice,
  normalizePriorities,
  currencyForCountry,
  MAX_PRIORITIES,
} from "@/lib/restaurant/onboarding-copy";

describe("normalizeConceptType", () => {
  it("passes through a valid concept type", () => {
    expect(normalizeConceptType("bakery")).toBe("bakery");
  });

  it("rejects an unknown value", () => {
    expect(normalizeConceptType("food_truck")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeConceptType(123)).toBeNull();
    expect(normalizeConceptType(null)).toBeNull();
    expect(normalizeConceptType(undefined)).toBeNull();
    expect(normalizeConceptType(["restaurant"])).toBeNull();
  });
});

describe("normalizeLocationCountBucket", () => {
  it("passes through each valid bucket", () => {
    expect(normalizeLocationCountBucket("1")).toBe("1");
    expect(normalizeLocationCountBucket("2-3")).toBe("2-3");
    expect(normalizeLocationCountBucket("4-10")).toBe("4-10");
    expect(normalizeLocationCountBucket("10+")).toBe("10+");
  });

  it("rejects an unknown value", () => {
    expect(normalizeLocationCountBucket("100+")).toBeNull();
    expect(normalizeLocationCountBucket("")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeLocationCountBucket(2)).toBeNull();
    expect(normalizeLocationCountBucket(undefined)).toBeNull();
  });
});

describe("normalizePosSystemChoice", () => {
  it("passes through a valid POS choice", () => {
    expect(normalizePosSystemChoice("odoo")).toBe("odoo");
    expect(normalizePosSystemChoice("unknown")).toBe("unknown");
  });

  it("rejects an unknown value", () => {
    expect(normalizePosSystemChoice("clover")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizePosSystemChoice(null)).toBeNull();
    expect(normalizePosSystemChoice({})).toBeNull();
  });
});

describe("normalizePriorities", () => {
  it("passes through a valid list under the cap", () => {
    expect(normalizePriorities(["margins", "food_cost"])).toEqual([
      "margins",
      "food_cost",
    ]);
  });

  it("caps at MAX_PRIORITIES, keeping the first valid entries in order", () => {
    const result = normalizePriorities([
      "margins",
      "food_cost",
      "sales",
      "inventory",
      "waste",
    ]);
    expect(result).toHaveLength(MAX_PRIORITIES);
    expect(result).toEqual(["margins", "food_cost", "sales"]);
  });

  it("drops duplicate entries without consuming a cap slot on the repeat", () => {
    const result = normalizePriorities([
      "margins",
      "margins",
      "food_cost",
      "sales",
    ]);
    expect(result).toEqual(["margins", "food_cost", "sales"]);
  });

  it("silently filters out unknown values, keeping only valid ones", () => {
    expect(normalizePriorities(["margins", "bogus", "sales"])).toEqual([
      "margins",
      "sales",
    ]);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizePriorities(null)).toEqual([]);
    expect(normalizePriorities(undefined)).toEqual([]);
    expect(normalizePriorities("margins")).toEqual([]);
    expect(normalizePriorities({ margins: true })).toEqual([]);
  });

  it("returns an empty array for an empty array input", () => {
    expect(normalizePriorities([])).toEqual([]);
  });

  it("ignores non-string entries mixed into the array", () => {
    expect(normalizePriorities(["margins", 42, null, "sales"])).toEqual([
      "margins",
      "sales",
    ]);
  });
});

describe("currencyForCountry", () => {
  it("resolves a known country to its currency", () => {
    expect(currencyForCountry("MX")).toBe("MXN");
    expect(currencyForCountry("US")).toBe("USD");
  });

  it("falls back to USD for an unknown code", () => {
    expect(currencyForCountry("ZZ")).toBe("USD");
  });
});
