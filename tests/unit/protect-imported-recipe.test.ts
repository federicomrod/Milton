import { describe, expect, it } from "vitest";
import {
  handmadeSourcePatch,
  isImportProtectedSource,
  MANUAL_RECIPE_SOURCE,
} from "@/lib/restaurant/protect-imported-recipe";
import {
  decideWorkbookCostMatch,
  workbookCostsMatch,
} from "@/lib/restaurant/cost-workbook";

describe("protect imported recipes after a hand edit", () => {
  it("treats anything other than import as protected", () => {
    expect(isImportProtectedSource("import")).toBe(false);
    expect(isImportProtectedSource("manual")).toBe(true);
    expect(isImportProtectedSource(null)).toBe(true);
    expect(handmadeSourcePatch()).toEqual({
      source_type: MANUAL_RECIPE_SOURCE,
    });
  });
});

describe("workbook cost match tolerance", () => {
  it("matches within $0.01 or 1%", () => {
    expect(workbookCostsMatch(1, 1.01)).toBe(true);
    expect(workbookCostsMatch(1, 1.03)).toBe(false);
    expect(workbookCostsMatch(10, 10.1)).toBe(true);
    expect(workbookCostsMatch(10, 10.2)).toBe(false);
    expect(decideWorkbookCostMatch(2, null)).toBe("mismatch");
    expect(decideWorkbookCostMatch(null, 2)).toBeNull();
    expect(decideWorkbookCostMatch(0.15, 0.15)).toBe("match");
  });
});
