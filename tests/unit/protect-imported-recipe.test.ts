import { describe, expect, it } from "vitest";
import {
  handmadeSourcePatch,
  isImportProtectedSource,
  MANUAL_RECIPE_SOURCE,
  shouldApplyWorkbookMismatch,
} from "@/lib/restaurant/protect-imported-recipe";
import {
  decideWorkbookCostMatch,
  workbookCostsMatch,
} from "@/lib/restaurant/cost-workbook/variance";

describe("protect imported recipes after a hand edit", () => {
  it("treats anything other than import as protected", () => {
    expect(isImportProtectedSource("import")).toBe(false);
    expect(isImportProtectedSource("manual")).toBe(true);
    expect(isImportProtectedSource(null)).toBe(true);
    expect(handmadeSourcePatch()).toEqual({
      source_type: MANUAL_RECIPE_SOURCE,
      workbook_cost_match: null,
      workbook_computed_cost: null,
      workbook_variance_amount: null,
      workbook_variance_pct: null,
    });
  });

  it("skips the Excel mismatch rule unless the recipe is still an import", () => {
    expect(
      shouldApplyWorkbookMismatch({
        source_type: "import",
        workbook_cost_match: "mismatch",
      })
    ).toBe(true);
    expect(
      shouldApplyWorkbookMismatch({
        source_type: "manual",
        workbook_cost_match: "mismatch",
      })
    ).toBe(false);
    expect(
      shouldApplyWorkbookMismatch({
        source_type: "import",
        workbook_cost_match: "match",
      })
    ).toBe(false);
  });
});

describe("workbook cost match tolerance", () => {
  it("matches within $0.05 or 2%", () => {
    expect(workbookCostsMatch(1, 1.05)).toBe(true);
    expect(workbookCostsMatch(1, 1.06)).toBe(false);
    expect(workbookCostsMatch(10, 10.2)).toBe(true);
    expect(workbookCostsMatch(10, 10.3)).toBe(false);
    expect(decideWorkbookCostMatch(2, null)).toBe("mismatch");
    expect(decideWorkbookCostMatch(null, 2)).toBeNull();
    expect(decideWorkbookCostMatch(0.15, 0.15)).toBe("match");
  });
});
