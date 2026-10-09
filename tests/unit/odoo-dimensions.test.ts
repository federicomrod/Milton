import { describe, it, expect } from "vitest";
import {
  MIXED_PAYMENT_TYPE,
  mapChannelLabel,
  mapSalesChannel,
  mapProductCategories,
  resolvePaymentType,
  pickPresentFields,
  fieldNamesFromFieldsGet,
  channelSignalsFromOrder,
  summarizeDimensionBuckets,
  type CategoryNode,
} from "@/lib/restaurant/odoo/dimensions";
import {
  buildDimensionLookups,
  chunkIds,
  loadOdooDimensions,
  type ScopedOdooCall,
} from "@/lib/restaurant/odoo/dimension-fetch";
import { buildLiveOdooDimensionReport } from "@/lib/restaurant/odoo/audit";
import {
  normalizeMatchKey,
  transformOdooOrders,
  type CanonicalOdooSaleRow,
  type OdooPosOrderLineRaw,
  type OdooPosOrderRaw,
  type OdooSyncContext,
} from "@/lib/restaurant/odoo/sync";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";
import { OdooRpcError } from "@/lib/restaurant/odoo/client";
import type { XmlRpcValue } from "@/lib/restaurant/odoo/xmlrpc";

const paidOrder: OdooPosOrderRaw = {
  id: 101,
  state: "paid",
  date_order: "2026-07-01 18:00:00",
  pos_reference: "POS/0001",
  uuid: "order-uuid-1",
  session_id: [5, "Session 1"],
  config_id: [3, "Los Ranchos"],
  currency_id: [2, "USD"],
  company_id: [1, "Los Ranchos"],
};

function makeLine(
  overrides: Partial<OdooPosOrderLineRaw> = {}
): OdooPosOrderLineRaw {
  return {
    id: 501,
    order_id: [101, "Order 101"],
    product_id: [55, "Pupusa"],
    full_product_name: "Pupusa",
    qty: 2,
    price_unit: 3.5,
    price_subtotal: 7,
    price_subtotal_incl: 7,
    discount: 0,
    uuid: "line-uuid-1",
    company_id: [1, "Los Ranchos"],
    ...overrides,
  };
}

function baseCtx(overrides: Partial<OdooSyncContext> = {}): OdooSyncContext {
  return {
    companyId: "company-1",
    timezone: "America/El_Salvador",
    defaultCurrency: "USD",
    menuItemIndex: buildScopedNameIndex(
      [{ id: "menu-1", name: "Pupusa", scopeId: null }],
      normalizeMatchKey
    ),
    locationIndex: new Map([["losranchos", "location-1"]]),
    locationBrandIndex: new Map([["location-1", "brand-1"]]),
    ...overrides,
  };
}

function upsertBySourceLine(
  store: Map<string, CanonicalOdooSaleRow>,
  rows: CanonicalOdooSaleRow[]
) {
  for (const row of rows) {
    store.set(
      `${row.company_id}|${row.pos_source}|${row.external_line_id}`,
      row
    );
  }
}

describe("mapChannelLabel / mapSalesChannel", () => {
  it("maps Explorer vocabulary and keeps a readable unmatched label", () => {
    expect(mapChannelLabel("Dine In")).toBe("in_store");
    expect(mapChannelLabel("Takeaway")).toBe("takeaway");
    expect(mapChannelLabel("Uber Eats")).toBe("delivery");
    expect(mapChannelLabel("Website")).toBe("online");
    expect(mapChannelLabel("Terraza")).toBe("Terraza");
    expect(mapChannelLabel("")).toBeNull();
  });

  it("never defaults to in_store when nothing is known", () => {
    expect(mapSalesChannel({})).toEqual({ channel: null, source: null });
  });

  it("prefers a named preset over table_id", () => {
    expect(
      mapSalesChannel({
        presetName: "Delivery",
        hasTable: true,
        configName: "Los Ranchos",
      })
    ).toEqual({ channel: "delivery", source: "preset_id" });
  });

  it("uses an explicit takeaway boolean and does not guess from no-table", () => {
    expect(mapSalesChannel({ takeaway: true })).toEqual({
      channel: "takeaway",
      source: "takeaway",
    });
    expect(mapSalesChannel({ takeaway: false })).toEqual({
      channel: "in_store",
      source: "takeaway",
    });
    expect(mapSalesChannel({ hasTable: false })).toEqual({
      channel: null,
      source: null,
    });
  });

  it("treats a set table as dine-in and ignores a till name that is not a channel", () => {
    expect(mapSalesChannel({ hasTable: true })).toEqual({
      channel: "in_store",
      source: "table_id",
    });
    expect(mapSalesChannel({ configName: "Los Ranchos Barra" })).toEqual({
      channel: null,
      source: null,
    });
    expect(mapSalesChannel({ configName: "Delivery Till" })).toEqual({
      channel: "delivery",
      source: "config_id",
    });
  });

  it("reads only fields that fields_get said exist", () => {
    const order = {
      id: 1,
      takeaway: true,
      table_id: [9, "T1"],
      config_id: [3, "Delivery"],
    };
    expect(channelSignalsFromOrder(order, new Set(["table_id"]))).toEqual({
      presetName: null,
      orderType: null,
      serviceMode: null,
      takeaway: null,
      isTogo: null,
      deliveryProviderName: null,
      hasTable: true,
      configName: "Delivery",
    });
  });
});

describe("resolvePaymentType — multi-payment rule", () => {
  it("returns the only named method", () => {
    expect(
      resolvePaymentType([
        { methodName: "Cash", amount: 10 },
        { methodName: "Cash", amount: 2 },
      ])
    ).toBe("Cash");
  });

  it("picks the method with the largest summed amount", () => {
    expect(
      resolvePaymentType([
        { methodName: "Cash", amount: 3 },
        { methodName: "Card", amount: 20 },
        { methodName: "Cash", amount: 1 },
      ])
    ).toBe("Card");
  });

  it("returns Mixed when two methods tie for the largest amount", () => {
    expect(
      resolvePaymentType([
        { methodName: "Cash", amount: 10 },
        { methodName: "Card", amount: 10 },
      ])
    ).toBe(MIXED_PAYMENT_TYPE);
  });

  it("returns null when no usable payment name exists", () => {
    expect(resolvePaymentType([])).toBeNull();
    expect(resolvePaymentType([{ methodName: null, amount: 5 }])).toBeNull();
  });
});

describe("mapProductCategories", () => {
  const pos = new Map<number, CategoryNode>([
    [10, { id: 10, name: "Food", parentId: null }],
    [11, { id: 11, name: "Tacos", parentId: 10 }],
  ]);
  const product = new Map<number, CategoryNode>([
    [3, { id: 3, name: "All", parentId: null }],
    [4, { id: 4, name: "Beverages", parentId: 3 }],
  ]);

  it("prefers a POS category and splits parent / child", () => {
    expect(
      mapProductCategories(
        { posCateg: { id: 11, name: "Tacos" } },
        pos,
        product
      )
    ).toEqual({ category: "Food", sub_category: "Tacos" });
  });

  it("falls back to product.category when POS category is absent", () => {
    expect(
      mapProductCategories(
        { productCateg: { id: 4, name: "Beverages" } },
        pos,
        product
      )
    ).toEqual({ category: "All", sub_category: "Beverages" });
  });

  it("leaves both null when nothing is known", () => {
    expect(mapProductCategories({}, pos, product)).toEqual({
      category: null,
      sub_category: null,
    });
  });
});

describe("fields_get helpers", () => {
  it("picks only fields that exist", () => {
    expect(
      pickPresentFields(new Set(["table_id", "name"]), [
        "preset_id",
        "table_id",
        "takeaway",
      ])
    ).toEqual(["table_id"]);
    expect(pickPresentFields(null, ["table_id"])).toEqual([]);
  });

  it("reads field names from a fields_get struct and rejects a list", () => {
    expect(
      fieldNamesFromFieldsGet({ table_id: { type: "many2one" }, qty: {} })
    ).toEqual(new Set(["table_id", "qty"]));
    expect(fieldNamesFromFieldsGet([])).toBeNull();
  });
});

describe("transformOdooOrders — dimension mapping and re-sync", () => {
  it("leaves dimensions null when lookups are missing (never guessed)", () => {
    const { rows } = transformOdooOrders([paidOrder], [makeLine()], baseCtx());
    expect(rows[0].sales_channel).toBeNull();
    expect(rows[0].payment_type).toBeNull();
    expect(rows[0].category).toBeNull();
    expect(rows[0].sub_category).toBeNull();
    expect(rows[0].gross_revenue).toBe(7);
  });

  it("writes mapped channel, payment and category onto the canonical row", () => {
    const { rows } = transformOdooOrders(
      [paidOrder],
      [makeLine()],
      baseCtx({
        channelByOrderId: new Map([[101, "in_store"]]),
        channelSourceByOrderId: new Map([[101, "table_id"]]),
        paymentByOrderId: new Map([[101, "Cash"]]),
        categoryByProductId: new Map([
          [55, { category: "Food", sub_category: "Pupusas" }],
        ]),
      })
    );
    expect(rows[0].sales_channel).toBe("in_store");
    expect(rows[0].payment_type).toBe("Cash");
    expect(rows[0].category).toBe("Food");
    expect(rows[0].sub_category).toBe("Pupusas");
    expect(rows[0].source_metadata.sales_channel_source).toBe("table_id");
    expect(rows[0].gross_revenue).toBe(7);
  });

  it("re-sync of the same line updates dimensions without duplicating or changing revenue", () => {
    const store = new Map<string, CanonicalOdooSaleRow>();
    const first = transformOdooOrders([paidOrder], [makeLine()], baseCtx());
    upsertBySourceLine(store, first.rows);
    expect(store.size).toBe(1);
    expect([...store.values()][0].sales_channel).toBeNull();

    const second = transformOdooOrders(
      [paidOrder],
      [makeLine()],
      baseCtx({
        channelByOrderId: new Map([[101, "takeaway"]]),
        paymentByOrderId: new Map([[101, "Card"]]),
        categoryByProductId: new Map([
          [55, { category: "Food", sub_category: null }],
        ]),
      })
    );
    upsertBySourceLine(store, second.rows);
    expect(store.size).toBe(1);
    const row = [...store.values()][0];
    expect(row.external_line_id).toBe("501");
    expect(row.sales_channel).toBe("takeaway");
    expect(row.payment_type).toBe("Card");
    expect(row.category).toBe("Food");
    expect(row.gross_revenue).toBe(first.rows[0].gross_revenue);
    expect(row.net_revenue).toBe(first.rows[0].net_revenue);
  });
});

describe("buildDimensionLookups + loadOdooDimensions", () => {
  it("maps a fixture order from payments and product categories", () => {
    const lookups = buildDimensionLookups({
      orders: [
        {
          id: 101,
          company_id: [1, "Los Ranchos"],
          config_id: [3, "Los Ranchos"],
          table_id: [8, "Mesa 4"],
        },
      ],
      payments: [
        {
          pos_order_id: [101, "o"],
          payment_method_id: [1, "Cash"],
          amount: 4,
        },
        {
          pos_order_id: [101, "o"],
          payment_method_id: [2, "Card"],
          amount: 3,
        },
      ],
      products: [
        {
          id: 55,
          pos_categ_id: [11, "Tacos"],
          categ_id: [4, "Beverages"],
        },
      ],
      posCategories: new Map([
        [10, { id: 10, name: "Food", parentId: null }],
        [11, { id: 11, name: "Tacos", parentId: 10 }],
      ]),
      productCategories: new Map(),
      availableOrderFields: new Set(["table_id", "config_id"]),
      availablePaymentFields: new Set([
        "pos_order_id",
        "payment_method_id",
        "amount",
      ]),
      availableProductFields: new Set(["pos_categ_id", "categ_id"]),
    });
    expect(lookups.channelByOrderId.get(101)).toBe("in_store");
    expect(lookups.paymentByOrderId.get(101)).toBe("Cash");
    expect(lookups.categoryByProductId.get(55)).toEqual({
      category: "Food",
      sub_category: "Tacos",
    });
  });

  it("chunks ids and never issues a per-order domain", () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("skips missing models from fields_get without guessing fields", async () => {
    const calls: string[] = [];
    const call: ScopedOdooCall = async (model, method) => {
      calls.push(`${model}.${method}`);
      throw new OdooRpcError(`Object ${model} doesn't exist`, 1);
    };
    const loaded = await loadOdooDimensions(call, [{ id: 1 }], [55]);
    expect(loaded.lookups.paymentByOrderId.size).toBe(0);
    expect(loaded.lookups.categoryByProductId.size).toBe(0);
    expect(loaded.notes.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.endsWith(".fields_get"))).toBe(true);
  });

  it("batches payment reads by order id", async () => {
    const paymentDomains: unknown[] = [];
    const call: ScopedOdooCall = async (model, method, args) => {
      if (method === "fields_get") {
        const fields: Record<string, XmlRpcValue> =
          model === "pos.order"
            ? {
                table_id: { type: "many2one" },
                config_id: { type: "many2one" },
              }
            : model === "pos.payment"
              ? {
                  pos_order_id: { type: "many2one" },
                  payment_method_id: { type: "many2one" },
                  amount: { type: "float" },
                  company_id: { type: "many2one" },
                }
              : model === "product.product"
                ? { categ_id: { type: "many2one" } }
                : {};
        if (Object.keys(fields).length === 0) {
          throw new OdooRpcError("missing", 1);
        }
        return fields;
      }
      if (model === "pos.payment") {
        paymentDomains.push(args[0]);
        return [];
      }
      return [];
    };
    const orders = Array.from({ length: 201 }, (_, i) => ({ id: i + 1 }));
    await loadOdooDimensions(call, orders, []);
    expect(paymentDomains).toHaveLength(2);
    const first = paymentDomains[0] as unknown[];
    expect(JSON.stringify(first)).toContain("pos_order_id");
    expect(JSON.stringify(first)).toContain("in");
  });
});

describe("live dimension audit", () => {
  it("reports per-company channel signals, payments and categories", () => {
    const report = buildLiveOdooDimensionReport({
      orders: [
        {
          id: 101,
          company_id: [1, "Los Ranchos"],
          table_id: [8, "Mesa 4"],
          amount_total: 12,
        },
        {
          id: 202,
          company_id: [2, "Lavara"],
          table_id: false,
          amount_total: 8,
        },
      ],
      payments: [
        {
          pos_order_id: [101, "o"],
          payment_method_id: [1, "Cash"],
          amount: 12,
          company_id: [1, "Los Ranchos"],
        },
      ],
      products: [{ id: 55, pos_categ_id: [11, "Tacos"], categ_id: [9, "All"] }],
      availableOrderFields: new Set(["table_id", "amount_total"]),
      availablePaymentFields: new Set([
        "pos_order_id",
        "payment_method_id",
        "amount",
        "company_id",
      ]),
      availableProductFields: new Set(["pos_categ_id", "categ_id"]),
      channelByOrderId: new Map([
        [101, "in_store"],
        [202, null],
      ]),
      paymentByOrderId: new Map([[101, "Cash"]]),
      categoryByProductId: new Map([
        [55, { category: "Food", sub_category: "Tacos" }],
      ]),
      posCategories: new Map([[11, { id: 11, name: "Tacos", parentId: 10 }]]),
      lineProductByOrderId: new Map([[101, [55]]]),
      notes: [],
      callCount: 4,
    });
    expect(report.multi_payment_rule).toMatch(/largest/i);
    expect(report.by_odoo_company).toHaveLength(2);
    const ranchos = report.by_odoo_company[0];
    expect(ranchos.name).toBe("Los Ranchos");
    expect(ranchos.mapped_channels[0].value).toBe("in_store");
    expect(ranchos.payment_methods[0].value).toBe("Cash");
    expect(ranchos.pos_categories[0].value).toBe("Tacos");
    expect(
      ranchos.channel_signals.find((s) => s.field === "table_id")?.present
    ).toBe(true);
    expect(
      ranchos.channel_signals.find((s) => s.field === "preset_id")?.present
    ).toBe(false);
  });
});

describe("summarizeDimensionBuckets", () => {
  it("counts distinct orders and rounds amounts", () => {
    expect(
      summarizeDimensionBuckets([
        { value: "Cash", orderId: 1, amount: 10.555 },
        { value: "Cash", orderId: 1, amount: 0.001 },
        { value: "Card", orderId: 2, amount: 3 },
      ])
    ).toEqual([
      { value: "Cash", order_count: 1, amount: 10.56, row_count: 2 },
      { value: "Card", order_count: 1, amount: 3, row_count: 1 },
    ]);
  });
});
