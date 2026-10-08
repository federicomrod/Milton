import { describe, it, expect } from "vitest";
import {
  transformOdooOrders,
  type OdooPosOrderRaw,
  type OdooPosOrderLineRaw,
} from "@/lib/restaurant/odoo/sync";
import { buildNameIndex } from "@/lib/restaurant/pos-import";
import type { ScopedNameIndex } from "@/lib/restaurant/scoped-matching";

// Tests for Odoo company → location mapping during sync.

describe("Odoo sync with company-to-location mapping", () => {
  const companyId = "milton-company-123";
  const timezone = "America/Mexico_City";

  const order1: OdooPosOrderRaw = {
    id: 1,
    state: "paid",
    date_order: "2025-01-15 14:30:00",
    pos_reference: "Order/0001",
    uuid: "uuid-1",
    session_id: [10, "Session 1"],
    config_id: [100, "Caja principal"],
    currency_id: [1, "MXN"],
    company_id: [7, "Restaurant A"],
  };

  const order2: OdooPosOrderRaw = {
    id: 2,
    state: "paid",
    date_order: "2025-01-15 15:00:00",
    pos_reference: "Order/0002",
    uuid: "uuid-2",
    session_id: [11, "Session 2"],
    config_id: [101, "Caja secundaria"],
    currency_id: [1, "MXN"],
    company_id: [9, "Restaurant B"],
  };

  const line1: OdooPosOrderLineRaw = {
    id: 101,
    order_id: [1, "Order/0001"],
    product_id: [200, "Taco"],
    full_product_name: "Taco",
    qty: 2,
    price_unit: 50,
    price_subtotal: 100,
    price_subtotal_incl: 116,
    discount: 0,
    uuid: "line-uuid-1",
    company_id: [7, "Restaurant A"],
  };

  const line2: OdooPosOrderLineRaw = {
    id: 102,
    order_id: [2, "Order/0002"],
    product_id: [201, "Burrito"],
    full_product_name: "Burrito",
    qty: 1,
    price_unit: 80,
    price_subtotal: 80,
    price_subtotal_incl: 92.8,
    discount: 0,
    uuid: "line-uuid-2",
    company_id: [9, "Restaurant B"],
  };

  it("maps orders to the correct location by company_id", () => {
    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Caja principal" },
      { id: "loc-b", name: "Caja secundaria" },
    ]);
    const companyLocationMap = new Map<number, string>([
      [7, "loc-a"], // Company 7 → Location A
      [9, "loc-b"], // Company 9 → Location B
    ]);

    const menuItemIndex: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows, skipped } = transformOdooOrders(
      [order1, order2],
      [line1, line2],
      {
        companyId,
        timezone,
        defaultCurrency: "MXN",
        menuItemIndex,
        locationIndex,
        locationBrandIndex: new Map([
          ["loc-a", null],
          ["loc-b", null],
        ]),
        companyLocationMap,
      }
    );

    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(2);

    // Line from company 7 lands on loc-a
    const row1 = rows.find((r) => r.order_id === "1");
    expect(row1).toBeDefined();
    expect(row1!.location_id).toBe("loc-a");

    // Line from company 9 lands on loc-b
    const row2 = rows.find((r) => r.order_id === "2");
    expect(row2).toBeDefined();
    expect(row2!.location_id).toBe("loc-b");
  });

  it("skips orders when till-name location conflicts with mapping", () => {
    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Caja principal" },
      { id: "loc-b", name: "Caja secundaria" },
    ]);
    // Company 7's till name "Caja principal" resolves to loc-a,
    // but mapping points company 7 to loc-b → conflict, should skip.
    const companyLocationMap = new Map<number, string>([
      [7, "loc-b"], // Company 7 → Location B (but till name resolves to loc-a)
      [9, "loc-b"], // Company 9 → Location B (till name "Caja secundaria" also points to loc-b, no conflict)
    ]);

    const menuItemIndex2: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows, skipped } = transformOdooOrders(
      [order1, order2],
      [line1, line2],
      {
        companyId,
        timezone,
        defaultCurrency: "MXN",
        menuItemIndex: menuItemIndex2,
        locationIndex,
        locationBrandIndex: new Map([
          ["loc-a", null],
          ["loc-b", null],
        ]),
        companyLocationMap,
      }
    );

    // Order 1 should be skipped due to location conflict
    expect(skipped.length).toBeGreaterThan(0);
    const skippedLine1 = skipped.find((s) => s.line_id === 101);
    expect(skippedLine1).toBeDefined();
    expect(skippedLine1!.reason).toContain("conflicts with mapped location");

    // Order 2 should succeed (both till name and mapping point to loc-b)
    const row2 = rows.find((r) => r.order_id === "2");
    expect(row2).toBeDefined();
    expect(row2!.location_id).toBe("loc-b");
  });

  it("uses mapping even when till name is not found", () => {
    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Other Till" },
      { id: "loc-b", name: "Different Till" },
    ]);
    const companyLocationMap = new Map<number, string>([
      [7, "loc-a"],
      [9, "loc-b"],
    ]);

    const menuItemIndex3: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows, skipped } = transformOdooOrders(
      [order1, order2],
      [line1, line2],
      {
        companyId,
        timezone,
        defaultCurrency: "MXN",
        menuItemIndex: menuItemIndex3,
        locationIndex,
        locationBrandIndex: new Map([
          ["loc-a", null],
          ["loc-b", null],
        ]),
        companyLocationMap,
      }
    );

    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(2);

    // Orders still get correct location from mapping despite unmatched till names
    const row1 = rows.find((r) => r.order_id === "1");
    expect(row1!.location_id).toBe("loc-a");

    const row2 = rows.find((r) => r.order_id === "2");
    expect(row2!.location_id).toBe("loc-b");
  });

  it("falls back to till-name matching when no mapping exists", () => {
    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Caja principal" },
    ]);
    // No mapping provided
    const companyLocationMap = new Map<number, string>();

    const menuItemIndex: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows } = transformOdooOrders([order1], [line1], {
      companyId,
      timezone,
      defaultCurrency: "MXN",
      menuItemIndex,
      locationIndex,
      locationBrandIndex: new Map([["loc-a", null]]),
      companyLocationMap,
    });

    expect(rows).toHaveLength(1);
    // Falls back to till-name match
    expect(rows[0].location_id).toBe("loc-a");
  });
});
