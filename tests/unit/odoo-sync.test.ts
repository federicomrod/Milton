import { describe, it, expect } from "vitest";
import {
  transformOdooOrders,
  parseOdooDatetimeToUtcIso,
  deriveLocalSaleDate,
  normalizeMatchKey,
  type OdooPosOrderRaw,
  type OdooPosOrderLineRaw,
  type OdooSyncContext,
} from "@/lib/restaurant/odoo/sync";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";

function baseCtx(overrides: Partial<OdooSyncContext> = {}): OdooSyncContext {
  return {
    companyId: "company-1",
    timezone: "America/Mexico_City",
    defaultCurrency: "MXN",
    // Legacy/unscoped fixture by default (brand_id null) — exercises the
    // fallback path, matching pre-multi-restaurant behavior when nothing
    // has a brand assigned yet.
    menuItemIndex: buildScopedNameIndex(
      [{ id: "menu-item-1", name: "BBQ Brisket Sandwich", scopeId: null }],
      normalizeMatchKey
    ),
    locationIndex: new Map([["romanorte", "location-1"]]),
    locationBrandIndex: new Map([["location-1", "brand-1"]]),
    ...overrides,
  };
}

const paidOrder: OdooPosOrderRaw = {
  id: 101,
  state: "paid",
  date_order: "2026-02-01 05:30:00", // UTC
  pos_reference: "Shop/0001",
  uuid: "order-uuid-1",
  session_id: [5, "Session 1"],
  config_id: [3, "Roma Norte"],
  currency_id: [10, "MXN"],
};

const draftOrder: OdooPosOrderRaw = {
  ...paidOrder,
  id: 102,
  state: "draft",
};

function makeLine(
  overrides: Partial<OdooPosOrderLineRaw> = {}
): OdooPosOrderLineRaw {
  return {
    id: 501,
    order_id: [101, "Order 101"],
    product_id: [55, "BBQ Brisket Sandwich"],
    full_product_name: "BBQ Brisket Sandwich",
    qty: 2,
    price_unit: 150,
    price_subtotal: 270, // 10% discount applied: 2*150*0.9 = 270
    price_subtotal_incl: 313.2, // + 16% tax on 270
    discount: 10,
    uuid: "line-uuid-1",
    ...overrides,
  };
}

describe("parseOdooDatetimeToUtcIso", () => {
  it("treats Odoo's naive datetime string as UTC", () => {
    expect(parseOdooDatetimeToUtcIso("2026-02-01 05:30:00")).toBe(
      "2026-02-01T05:30:00.000Z"
    );
  });

  it("throws on an unparseable string", () => {
    expect(() => parseOdooDatetimeToUtcIso("not-a-date")).toThrow();
  });
});

describe("deriveLocalSaleDate", () => {
  it("buckets a UTC instant into the previous local day when the local offset pushes it back", () => {
    // 05:30 UTC on Feb 1 is 23:30 on Jan 31 in America/Mexico_City (UTC-6, no DST since 2022).
    expect(
      deriveLocalSaleDate("2026-02-01T05:30:00.000Z", "America/Mexico_City")
    ).toBe("2026-01-31");
  });

  it("keeps the same calendar date in UTC", () => {
    expect(deriveLocalSaleDate("2026-02-01T05:30:00.000Z", "UTC")).toBe(
      "2026-02-01"
    );
  });
});

describe("normalizeMatchKey", () => {
  it("lowercases and strips spaces/underscores/dashes", () => {
    expect(normalizeMatchKey("BBQ Brisket Sandwich")).toBe(
      "bbqbrisketsandwich"
    );
    expect(normalizeMatchKey("Roma_Norte-2")).toBe("romanorte2");
  });
});

describe("transformOdooOrders", () => {
  it("produces one canonical row per line for a completed order, with computed discount/tax", () => {
    const { rows, skipped } = transformOdooOrders(
      [paidOrder],
      [makeLine()],
      baseCtx()
    );
    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.company_id).toBe("company-1");
    expect(row.order_id).toBe("101");
    expect(row.check_id).toBe("101");
    expect(row.external_line_id).toBe("501");
    expect(row.raw_item_name).toBe("BBQ Brisket Sandwich");
    expect(row.menu_item_id).toBe("menu-item-1");
    expect(row.location_id).toBe("location-1");
    expect(row.quantity).toBe(2);
    expect(row.unit_price).toBe(150);
    expect(row.gross_revenue).toBe(313.2);
    expect(row.net_revenue).toBe(270);
    // discount_amount = price_unit*qty - price_subtotal = 300 - 270 = 30
    expect(row.discount_amount).toBe(30);
    // tax_amount = price_subtotal_incl - price_subtotal = 313.2 - 270 = 43.2
    expect(row.tax_amount).toBeCloseTo(43.2, 5);
    expect(row.currency).toBe("MXN");
    expect(row.sales_channel).toBeNull();
    expect(row.source_type).toBe("api");
    expect(row.pos_source).toBe("odoo");
    expect(row.order_placed_at).toBe("2026-02-01T05:30:00.000Z");
    expect(row.sale_date).toBe("2026-01-31"); // local bucketing, see deriveLocalSaleDate test
    expect(row.source_metadata).toMatchObject({
      order_pos_reference: "Shop/0001",
      order_uuid: "order-uuid-1",
      line_uuid: "line-uuid-1",
      session_id: 5,
      config_id: 3,
      config_name: "Roma Norte",
      product_id: 55,
      state: "paid",
    });
  });

  it("skips lines belonging to a non-completed order, with a reason, rather than silently dropping them", () => {
    const { rows, skipped } = transformOdooOrders(
      [draftOrder],
      [makeLine({ order_id: [102, "Order 102"] })],
      baseCtx()
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/completed state/i);
    expect(skipped[0].order_id).toBe(102);
  });

  it("preserves a sale whose product has no menu_item mapping — never drops it", () => {
    const { rows } = transformOdooOrders(
      [paidOrder],
      [makeLine({ full_product_name: "Mystery Special" })],
      baseCtx()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].menu_item_id).toBeNull();
    expect(rows[0].raw_item_name).toBe("Mystery Special");
  });

  it("leaves location_id null when the pos.config name has no match", () => {
    const { rows } = transformOdooOrders(
      [{ ...paidOrder, config_id: [9, "Unknown Terminal"] }],
      [makeLine()],
      baseCtx()
    );
    expect(rows[0].location_id).toBeNull();
  });

  it("falls back to the context default currency when currency_id is false", () => {
    const { rows } = transformOdooOrders(
      [{ ...paidOrder, currency_id: false }],
      [makeLine()],
      baseCtx({ defaultCurrency: "USD" })
    );
    expect(rows[0].currency).toBe("USD");
  });

  it("skips a line with a non-finite critical field instead of inserting bad data", () => {
    const { rows, skipped } = transformOdooOrders(
      [paidOrder],
      [makeLine({ qty: Number.NaN })],
      baseCtx()
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/non-finite/i);
  });

  it("skips a line whose order_id reference is missing", () => {
    const { rows, skipped } = transformOdooOrders(
      [paidOrder],
      [makeLine({ order_id: false })],
      baseCtx()
    );
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/no order_id/i);
  });
});

describe("transformOdooOrders — multi-brand matching (Multi-Restaurant v1)", () => {
  // Two brands under one company, each with its own "Coke" menu item and
  // its own location/pos.config.
  const menuItemIndex = buildScopedNameIndex(
    [
      { id: "coke-brand-a", name: "Coke", scopeId: "brand-a" },
      { id: "coke-brand-b", name: "Coke", scopeId: "brand-b" },
    ],
    normalizeMatchKey
  );
  const locationIndex = new Map([
    ["locationa", "location-a"],
    ["locationb", "location-b"],
  ]);
  const locationBrandIndex = new Map([
    ["location-a", "brand-a"],
    ["location-b", "brand-b"],
  ]);
  const ctx = baseCtx({ menuItemIndex, locationIndex, locationBrandIndex });

  const orderA: OdooPosOrderRaw = {
    ...paidOrder,
    id: 201,
    config_id: [11, "Location A"],
  };
  const orderB: OdooPosOrderRaw = {
    ...paidOrder,
    id: 202,
    config_id: [12, "Location B"],
  };

  it("matches Coke sold at Location A to Brand A's Coke menu item", () => {
    const { rows } = transformOdooOrders(
      [orderA],
      [makeLine({ id: 901, order_id: [201, "o"], full_product_name: "Coke" })],
      ctx
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].location_id).toBe("location-a");
    expect(rows[0].menu_item_id).toBe("coke-brand-a");
  });

  it("matches Coke sold at Location B to Brand B's Coke menu item — no cross-brand leakage", () => {
    const { rows } = transformOdooOrders(
      [orderB],
      [makeLine({ id: 902, order_id: [202, "o"], full_product_name: "Coke" })],
      ctx
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].location_id).toBe("location-b");
    expect(rows[0].menu_item_id).toBe("coke-brand-b");
    expect(rows[0].menu_item_id).not.toBe("coke-brand-a");
  });

  it("both locations' Coke sales coexist correctly in the same sync batch", () => {
    const { rows } = transformOdooOrders(
      [orderA, orderB],
      [
        makeLine({ id: 901, order_id: [201, "o"], full_product_name: "Coke" }),
        makeLine({ id: 902, order_id: [202, "o"], full_product_name: "Coke" }),
      ],
      ctx
    );
    expect(rows).toHaveLength(2);
    const byLine = new Map(rows.map((r) => [r.external_line_id, r]));
    expect(byLine.get("901")?.menu_item_id).toBe("coke-brand-a");
    expect(byLine.get("902")?.menu_item_id).toBe("coke-brand-b");
  });

  it("never guesses a brand when the location doesn't resolve — falls back to unscoped only", () => {
    const unresolvedOrder: OdooPosOrderRaw = {
      ...paidOrder,
      id: 203,
      config_id: [99, "Unknown Terminal"],
    };
    const { rows } = transformOdooOrders(
      [unresolvedOrder],
      [
        makeLine({
          id: 903,
          order_id: [203, "o"],
          full_product_name: "Coke",
        }),
      ],
      ctx
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].location_id).toBeNull();
    // Neither brand's Coke is guessed — there is no unscoped "Coke" in
    // this fixture's index, so it's correctly unmatched.
    expect(rows[0].menu_item_id).toBeNull();
  });
});
