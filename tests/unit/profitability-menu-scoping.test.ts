import { describe, it, expect } from "vitest";
import {
  filterMenuItemsForSelection,
  type ProfitabilitySelection,
} from "@/lib/restaurant/profitability-server";

interface FakeMenuItem {
  id: string;
  name: string;
  brand_id: string | null;
}

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const MENU: FakeMenuItem[] = [
  { id: "item-a1", name: "A Brisket Taco", brand_id: BRAND_A },
  { id: "item-a2", name: "A Ribs Plate", brand_id: BRAND_A },
  { id: "item-b1", name: "B Poke Bowl", brand_id: BRAND_B },
  { id: "item-legacy", name: "Legacy Soda", brand_id: null },
];

describe("filterMenuItemsForSelection (Multi-Restaurant UX v1 — Phase 4 menu scoping)", () => {
  it("consolidated (no selection) returns every menu item, existing single-restaurant behavior preserved", () => {
    expect(filterMenuItemsForSelection(MENU, null)).toEqual(MENU);
    expect(filterMenuItemsForSelection(MENU, undefined)).toEqual(MENU);
  });

  it("Restaurant A selection includes only brand A items plus legacy (brand_id null) items", () => {
    const selected: ProfitabilitySelection = {
      locationId: "loc-a",
      brandId: BRAND_A,
    };
    const result = filterMenuItemsForSelection(MENU, selected);
    expect(result.map((m) => m.id).sort()).toEqual(
      ["item-a1", "item-a2", "item-legacy"].sort()
    );
  });

  it("Restaurant B selection includes only brand B items plus legacy items — never brand A's exclusive dishes", () => {
    const selected: ProfitabilitySelection = {
      locationId: "loc-b",
      brandId: BRAND_B,
    };
    const result = filterMenuItemsForSelection(MENU, selected);
    const ids = result.map((m) => m.id);
    expect(ids).toContain("item-b1");
    expect(ids).toContain("item-legacy");
    expect(ids).not.toContain("item-a1");
    expect(ids).not.toContain("item-a2");
  });

  it("a legacy (brand-less) selected location sees only brand-less items", () => {
    const selected: ProfitabilitySelection = {
      locationId: "loc-legacy",
      brandId: null,
    };
    const result = filterMenuItemsForSelection(MENU, selected);
    expect(result.map((m) => m.id)).toEqual(["item-legacy"]);
  });
});
