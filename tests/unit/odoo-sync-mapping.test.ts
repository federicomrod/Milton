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

  it("resolves identical till names via mapping (the main use case)", () => {
    // Two companies with identical till name 'Caja principal' but different config_ids
    const order7: OdooPosOrderRaw = {
      id: 701,
      state: "paid",
      date_order: "2025-01-15 14:00:00",
      pos_reference: "Order/0701",
      uuid: "uuid-701",
      session_id: [10, "Session 1"],
      config_id: [100, "Caja principal"],
      currency_id: [1, "MXN"],
      company_id: [7, "Restaurant A"],
    };

    const order9: OdooPosOrderRaw = {
      id: 901,
      state: "paid",
      date_order: "2025-01-15 15:00:00",
      pos_reference: "Order/0901",
      uuid: "uuid-901",
      session_id: [11, "Session 2"],
      config_id: [101, "Caja principal"],
      currency_id: [1, "MXN"],
      company_id: [9, "Restaurant B"],
    };

    const line7: OdooPosOrderLineRaw = {
      id: 7001,
      order_id: [701, "Order/0701"],
      product_id: [200, "Taco"],
      full_product_name: "Taco",
      qty: 1,
      price_unit: 50,
      price_subtotal: 50,
      price_subtotal_incl: 58,
      discount: 0,
      uuid: "line-uuid-7001",
      company_id: [7, "Restaurant A"],
    };

    const line9: OdooPosOrderLineRaw = {
      id: 9001,
      order_id: [901, "Order/0901"],
      product_id: [201, "Burrito"],
      full_product_name: "Burrito",
      qty: 1,
      price_unit: 80,
      price_subtotal: 80,
      price_subtotal_incl: 92.8,
      discount: 0,
      uuid: "line-uuid-9001",
      company_id: [9, "Restaurant B"],
    };

    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Restaurante A" },
      { id: "loc-b", name: "Restaurante B" },
    ]);

    const companyLocationMap = new Map<number, string>([
      [7, "loc-a"],
      [9, "loc-b"],
    ]);

    const menuItemIndex: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows, skipped } = transformOdooOrders(
      [order7, order9],
      [line7, line9],
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

    // Company 7's line lands on loc-a (via mapping, not till name)
    const row7 = rows.find((r) => r.order_id === "701");
    expect(row7).toBeDefined();
    expect(row7!.location_id).toBe("loc-a");

    // Company 9's line lands on loc-b (via mapping, not till name)
    const row9 = rows.find((r) => r.order_id === "901");
    expect(row9).toBeDefined();
    expect(row9!.location_id).toBe("loc-b");
  });

  it("skips when one Milton location is named after the till and mapping points elsewhere", () => {
    // One location is named 'Caja principal' (matches the till name)
    // but company 9 is mapped to loc-b. This creates a conflict.
    const order7: OdooPosOrderRaw = {
      id: 702,
      state: "paid",
      date_order: "2025-01-15 14:00:00",
      pos_reference: "Order/0702",
      uuid: "uuid-702",
      session_id: [10, "Session 1"],
      config_id: [100, "Caja principal"],
      currency_id: [1, "MXN"],
      company_id: [7, "Restaurant A"],
    };

    const order9: OdooPosOrderRaw = {
      id: 902,
      state: "paid",
      date_order: "2025-01-15 15:00:00",
      pos_reference: "Order/0902",
      uuid: "uuid-902",
      session_id: [11, "Session 2"],
      config_id: [101, "Caja principal"],
      currency_id: [1, "MXN"],
      company_id: [9, "Restaurant B"],
    };

    const line7: OdooPosOrderLineRaw = {
      id: 7002,
      order_id: [702, "Order/0702"],
      product_id: [200, "Taco"],
      full_product_name: "Taco",
      qty: 1,
      price_unit: 50,
      price_subtotal: 50,
      price_subtotal_incl: 58,
      discount: 0,
      uuid: "line-uuid-7002",
      company_id: [7, "Restaurant A"],
    };

    const line9: OdooPosOrderLineRaw = {
      id: 9002,
      order_id: [902, "Order/0902"],
      product_id: [201, "Burrito"],
      full_product_name: "Burrito",
      qty: 1,
      price_unit: 80,
      price_subtotal: 80,
      price_subtotal_incl: 92.8,
      discount: 0,
      uuid: "line-uuid-9002",
      company_id: [9, "Restaurant B"],
    };

    // loc-a is named 'Caja principal' (matches till name)
    const locationIndex = buildNameIndex([
      { id: "loc-a", name: "Caja principal" },
      { id: "loc-b", name: "Restaurante B" },
    ]);

    const companyLocationMap = new Map<number, string>([
      [7, "loc-a"], // Company 7 → loc-a (till name also resolves to loc-a, no conflict)
      [9, "loc-b"], // Company 9 → loc-b (but till name 'Caja principal' resolves to loc-a, CONFLICT)
    ]);

    const menuItemIndex: ScopedNameIndex = {
      unscoped: new Map(),
      byScope: new Map(),
    };

    const { rows, skipped } = transformOdooOrders(
      [order7, order9],
      [line7, line9],
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

    // Company 7's line succeeds (both till name and mapping point to loc-a)
    const row7 = rows.find((r) => r.order_id === "702");
    expect(row7).toBeDefined();
    expect(row7!.location_id).toBe("loc-a");

    // Company 9's line is skipped (conflict: till name → loc-a, mapping → loc-b)
    expect(skipped.length).toBeGreaterThan(0);
    const skipped9 = skipped.find((s) => s.line_id === 9002);
    expect(skipped9).toBeDefined();
    expect(skipped9!.reason).toContain("conflicts with mapped location");
  });
});
