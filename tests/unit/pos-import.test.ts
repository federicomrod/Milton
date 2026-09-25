import { describe, it, expect } from "vitest";
import {
  normalizeRevelPOSRow,
  buildNameIndex,
  normalizeHeader,
  type NormalizeContext,
} from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";

const COLUMNS: Record<string, string> = {
  establishment: "Establishment_Name",
  order_number: "Order_Number",
  order_date: "Order_Date",
  product_name: "Product_Name",
  product_quantity: "Product_Quantity",
  gross_item: "Gross_Item_Total",
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    Establishment_Name: "Location A",
    Order_Number: "ORD-1",
    Order_Date: "2026-02-01",
    Product_Name: "Coke",
    Product_Quantity: 2,
    Gross_Item_Total: 60,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    company_id: "company-1",
    source_type: "csv",
    currency: "MXN",
    locationIndex: buildNameIndex([
      { id: "location-a", name: "Location A" },
      { id: "location-b", name: "Location B" },
    ]),
    locationBrandIndex: new Map([
      ["location-a", "brand-a"],
      ["location-b", "brand-b"],
    ]),
    menuItemIndex: buildScopedNameIndex(
      [
        { id: "coke-brand-a", name: "Coke", scopeId: "brand-a" },
        { id: "coke-brand-b", name: "Coke", scopeId: "brand-b" },
      ],
      normalizeHeader
    ),
    columns: COLUMNS,
    ...overrides,
  };
}

describe("normalizeRevelPOSRow — multi-brand matching (Multi-Restaurant v1)", () => {
  it("matches Coke sold at Location A to Brand A's Coke menu item", () => {
    const res = normalizeRevelPOSRow(makeRow(), 0, baseCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.location_id).toBe("location-a");
    expect(res.insert.menu_item_id).toBe("coke-brand-a");
  });

  it("matches Coke sold at Location B to Brand B's Coke menu item — no cross-brand leakage", () => {
    const res = normalizeRevelPOSRow(
      makeRow({ Establishment_Name: "Location B" }),
      0,
      baseCtx()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.location_id).toBe("location-b");
    expect(res.insert.menu_item_id).toBe("coke-brand-b");
    expect(res.insert.menu_item_id).not.toBe("coke-brand-a");
  });

  it("both locations' Coke rows coexist correctly when processed together", () => {
    const ctx = baseCtx();
    const resA = normalizeRevelPOSRow(makeRow({ Order_Number: "A-1" }), 0, ctx);
    const resB = normalizeRevelPOSRow(
      makeRow({ Order_Number: "B-1", Establishment_Name: "Location B" }),
      1,
      ctx
    );
    expect(resA.ok && resA.insert.menu_item_id).toBe("coke-brand-a");
    expect(resB.ok && resB.insert.menu_item_id).toBe("coke-brand-b");
  });

  it("never guesses a brand when the establishment doesn't resolve to a known location", () => {
    const res = normalizeRevelPOSRow(
      makeRow({ Establishment_Name: "Unknown Spot" }),
      0,
      baseCtx()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.location_id).toBeNull();
    // No unscoped "Coke" exists in this fixture, so it's correctly
    // unmatched rather than guessed into either brand.
    expect(res.insert.menu_item_id).toBeNull();
  });

  it("legacy/company-wide behavior is intact: an unscoped menu item still matches when no brand applies", () => {
    const ctx = baseCtx({
      menuItemIndex: buildScopedNameIndex(
        [{ id: "legacy-water", name: "Water", scopeId: null }],
        normalizeHeader
      ),
    });
    const res = normalizeRevelPOSRow(
      makeRow({ Establishment_Name: "Unknown Spot", Product_Name: "Water" }),
      0,
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.menu_item_id).toBe("legacy-water");
  });

  it("single-restaurant behavior is unchanged: one location, one unscoped menu, matches exactly as before", () => {
    const ctx: NormalizeContext = {
      company_id: "company-1",
      source_type: "csv",
      currency: "MXN",
      locationIndex: buildNameIndex([{ id: "loc-1", name: "Main" }]),
      locationBrandIndex: new Map([["loc-1", null]]),
      menuItemIndex: buildScopedNameIndex(
        [{ id: "burger-1", name: "Burger", scopeId: null }],
        normalizeHeader
      ),
      columns: COLUMNS,
    };
    const res = normalizeRevelPOSRow(
      makeRow({ Establishment_Name: "Main", Product_Name: "Burger" }),
      0,
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.location_id).toBe("loc-1");
    expect(res.insert.menu_item_id).toBe("burger-1");
  });
});
