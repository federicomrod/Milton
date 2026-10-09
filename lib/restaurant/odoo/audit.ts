// lib/restaurant/odoo/audit.ts
//
// Pure grouping logic for the read-only Odoo audit
// (GET /api/restaurant/pos/odoo-audit): how do existing pos_source='odoo'
// pos_sales_items rows break down by Odoo company, and (when a range is
// requested) what channel / payment / category signals exist in Odoo.
// Aggregates only — no record payloads leave this module.

import {
  many2oneId,
  many2oneName,
  productCategorySourceFromRaw,
  summarizeChannelSignalFields,
  summarizeDimensionBuckets,
  type CategoryNode,
  type ChannelSignalFieldReport,
  type DimensionBucket,
} from "./dimensions";
import type { OdooPaymentRaw } from "./dimension-fetch";

export interface OdooAuditRow {
  id: string;
  order_id: string | null;
  sale_date: string;
  location_id: string | null;
  gross_revenue: number | string | null;
  source_metadata: Record<string, unknown> | null;
  sales_channel?: string | null;
  payment_type?: string | null;
  category?: string | null;
  sub_category?: string | null;
}

/** pos.config id -> its Odoo company, as returned by Odoo. */
export type OdooConfigCompanyMap = Map<number, { id: number; name: string }>;

export interface OdooAuditStoredDimensions {
  channels: DimensionBucket[];
  payment_types: DimensionBucket[];
  categories: DimensionBucket[];
  sub_categories: DimensionBucket[];
}

export interface OdooAuditCompanyGroup {
  odoo_company_id: number;
  name: string;
  selected: boolean;
  row_count: number;
  order_count: number;
  gross_revenue_sum: number;
  first_sale_date: string | null;
  last_sale_date: string | null;
  by_location_id: Record<string, number>;
  stored_dimensions: OdooAuditStoredDimensions;
}

export interface LiveOdooDimensionCompany {
  odoo_company_id: number;
  name: string;
  order_count: number;
  amount: number;
  channel_signals: ChannelSignalFieldReport[];
  mapped_channels: DimensionBucket[];
  payment_methods: DimensionBucket[];
  pos_categories: DimensionBucket[];
  product_categories: DimensionBucket[];
}

export interface LiveOdooDimensionReport {
  available_fields: {
    "pos.order": string[];
    "pos.payment": string[] | null;
    "product.product": string[] | null;
  };
  by_odoo_company: LiveOdooDimensionCompany[];
  multi_payment_rule: string;
  notes: string[];
  call_count: number;
}

export interface OdooAuditReport {
  generated_at: string;
  selected_company_ids: number[];
  range: { start_date: string; end_date: string } | null;
  by_odoo_company: OdooAuditCompanyGroup[];
  unverifiable: {
    row_count: number;
    reasons: { missing_config_id: number; config_not_found: number };
  };
  total_rows: number;
  odoo_dimensions: LiveOdooDimensionReport | null;
}

function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

type DimAcc = {
  value: string | null;
  orderId: string | null;
  amount: number;
};

type MutableGroup = OdooAuditCompanyGroup & {
  _orders: Set<string>;
  _channels: DimAcc[];
  _payments: DimAcc[];
  _categories: DimAcc[];
  _subCategories: DimAcc[];
};

export function buildOdooAuditReport(
  rows: OdooAuditRow[],
  configCompanyMap: OdooConfigCompanyMap,
  selectedIds: number[] | null | undefined,
  now: Date = new Date(),
  range: { start_date: string; end_date: string } | null = null,
  odooDimensions: LiveOdooDimensionReport | null = null
): OdooAuditReport {
  const selected = new Set(selectedIds ?? []);
  const groups = new Map<number, MutableGroup>();
  const reasons = { missing_config_id: 0, config_not_found: 0 };

  for (const row of rows) {
    const meta = row.source_metadata ?? {};
    // Rows written after this change record their Odoo company directly.
    let companyId = asInt(meta.odoo_company_id);
    let name =
      typeof meta.odoo_company_name === "string" ? meta.odoo_company_name : "";
    if (companyId === null) {
      const configId = asInt(meta.config_id);
      if (configId === null) {
        reasons.missing_config_id++;
        continue;
      }
      const company = configCompanyMap.get(configId);
      if (!company) {
        reasons.config_not_found++;
        continue;
      }
      companyId = company.id;
      name = company.name;
    }

    let g = groups.get(companyId);
    if (!g) {
      g = {
        odoo_company_id: companyId,
        name,
        selected: selected.has(companyId),
        row_count: 0,
        order_count: 0,
        gross_revenue_sum: 0,
        first_sale_date: null,
        last_sale_date: null,
        by_location_id: {},
        stored_dimensions: {
          channels: [],
          payment_types: [],
          categories: [],
          sub_categories: [],
        },
        _orders: new Set<string>(),
        _channels: [],
        _payments: [],
        _categories: [],
        _subCategories: [],
      };
      groups.set(companyId, g);
    }
    if (!g.name && name) g.name = name;
    g.row_count++;
    if (row.order_id) g._orders.add(row.order_id);
    const amount = Number(row.gross_revenue ?? 0) || 0;
    g.gross_revenue_sum += amount;
    if (!g.first_sale_date || row.sale_date < g.first_sale_date) {
      g.first_sale_date = row.sale_date;
    }
    if (!g.last_sale_date || row.sale_date > g.last_sale_date) {
      g.last_sale_date = row.sale_date;
    }
    const locKey = row.location_id ?? "null";
    g.by_location_id[locKey] = (g.by_location_id[locKey] ?? 0) + 1;
    const dim = {
      orderId: row.order_id,
      amount,
    };
    g._channels.push({ ...dim, value: row.sales_channel ?? null });
    g._payments.push({ ...dim, value: row.payment_type ?? null });
    g._categories.push({ ...dim, value: row.category ?? null });
    g._subCategories.push({ ...dim, value: row.sub_category ?? null });
  }

  const by_odoo_company = Array.from(groups.values())
    .sort((a, b) => a.odoo_company_id - b.odoo_company_id)
    .map(
      ({
        _orders,
        _channels,
        _payments,
        _categories,
        _subCategories,
        ...g
      }) => ({
        ...g,
        order_count: _orders.size,
        gross_revenue_sum: Math.round(g.gross_revenue_sum * 100) / 100,
        stored_dimensions: {
          channels: summarizeDimensionBuckets(_channels),
          payment_types: summarizeDimensionBuckets(_payments),
          categories: summarizeDimensionBuckets(_categories),
          sub_categories: summarizeDimensionBuckets(_subCategories),
        },
      })
    );

  return {
    generated_at: now.toISOString(),
    selected_company_ids: Array.from(selected),
    range,
    by_odoo_company,
    unverifiable: {
      row_count: reasons.missing_config_id + reasons.config_not_found,
      reasons,
    },
    total_rows: rows.length,
    odoo_dimensions: odooDimensions,
  };
}

const MULTI_PAYMENT_RULE =
  "Largest summed pos.payment amount per method name wins; Mixed on a tie";

export function buildLiveOdooDimensionReport(input: {
  orders: Record<string, unknown>[];
  payments: OdooPaymentRaw[];
  products: Record<string, unknown>[];
  availableOrderFields: Set<string>;
  availablePaymentFields: Set<string> | null;
  availableProductFields: Set<string> | null;
  channelByOrderId: Map<number, string | null>;
  paymentByOrderId: Map<number, string | null>;
  categoryByProductId: Map<
    number,
    { category: string | null; sub_category: string | null }
  >;
  posCategories: Map<number, CategoryNode>;
  /**
   * POS lines for category buckets. Amounts must be line-level
   * (price_subtotal_incl), not the full order total — otherwise every
   * category on a multi-category order is credited the whole ticket.
   */
  lineItemsByOrderId: Map<number, Array<{ productId: number; amount: number }>>;
  notes: string[];
  callCount: number;
}): LiveOdooDimensionReport {
  const groups = new Map<
    number,
    {
      name: string;
      orders: Record<string, unknown>[];
      amount: number;
    }
  >();

  for (const order of input.orders) {
    const companyId = many2oneId(order.company_id);
    if (companyId === null) continue;
    let g = groups.get(companyId);
    if (!g) {
      g = {
        name: many2oneName(order.company_id) ?? "",
        orders: [],
        amount: 0,
      };
      groups.set(companyId, g);
    }
    g.orders.push(order);
    const total =
      typeof order.amount_total === "number"
        ? order.amount_total
        : typeof order.amount_paid === "number"
          ? order.amount_paid
          : 0;
    g.amount += Number.isFinite(total) ? total : 0;
  }

  const orderCompany = new Map<number, number>();
  for (const [companyId, g] of groups) {
    for (const order of g.orders) {
      if (typeof order.id === "number") orderCompany.set(order.id, companyId);
    }
  }

  const paymentsByCompany = new Map<
    number,
    Array<{ value: string | null; orderId: number | null; amount: number }>
  >();
  for (const payment of input.payments) {
    const orderId =
      many2oneId(payment.pos_order_id) ?? many2oneId(payment.order_id);
    const companyId =
      many2oneId(payment.company_id) ??
      (orderId !== null ? (orderCompany.get(orderId) ?? null) : null);
    if (companyId === null) continue;
    const list = paymentsByCompany.get(companyId) ?? [];
    list.push({
      value: many2oneName(payment.payment_method_id),
      orderId,
      amount: typeof payment.amount === "number" ? payment.amount : 0,
    });
    paymentsByCompany.set(companyId, list);
  }

  const by_odoo_company = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([odoo_company_id, g]) => {
      const mapped = g.orders.map((order) => {
        const id = typeof order.id === "number" ? order.id : null;
        const amount =
          typeof order.amount_total === "number"
            ? order.amount_total
            : typeof order.amount_paid === "number"
              ? order.amount_paid
              : 0;
        return {
          order,
          orderId: id,
          amount: Number.isFinite(amount) ? amount : 0,
          channel:
            id !== null ? (input.channelByOrderId.get(id) ?? null) : null,
          payment:
            id !== null ? (input.paymentByOrderId.get(id) ?? null) : null,
        };
      });

      const posCatItems: Array<{
        value: string | null;
        orderId: number | null;
        amount: number;
      }> = [];
      const prodCatItems: typeof posCatItems = [];
      const productById = new Map<number, Record<string, unknown>>();
      for (const product of input.products) {
        if (typeof product.id === "number")
          productById.set(product.id, product);
      }
      for (const row of mapped) {
        if (row.orderId === null) continue;
        const lineItems = input.lineItemsByOrderId.get(row.orderId) ?? [];
        for (const line of lineItems) {
          const lineAmount = Number.isFinite(line.amount) ? line.amount : 0;
          const product = productById.get(line.productId);
          if (product && input.availableProductFields) {
            const src = productCategorySourceFromRaw(
              product,
              input.availableProductFields
            );
            const posName =
              src.posCateg?.name ||
              (src.posCategIds ?? [])
                .map((id) => input.posCategories.get(id)?.name)
                .find((name) => !!name) ||
              null;
            posCatItems.push({
              value: posName,
              orderId: row.orderId,
              amount: lineAmount,
            });
            prodCatItems.push({
              value: src.productCateg?.name ?? null,
              orderId: row.orderId,
              amount: lineAmount,
            });
          } else {
            const cats = input.categoryByProductId.get(line.productId);
            posCatItems.push({
              value: cats?.category ?? null,
              orderId: row.orderId,
              amount: lineAmount,
            });
          }
        }
      }

      return {
        odoo_company_id,
        name: g.name,
        order_count: g.orders.length,
        amount: Math.round(g.amount * 100) / 100,
        channel_signals: summarizeChannelSignalFields(
          g.orders.map((order) => ({
            order,
            amount:
              typeof order.amount_total === "number"
                ? order.amount_total
                : typeof order.amount_paid === "number"
                  ? order.amount_paid
                  : 0,
          })),
          input.availableOrderFields
        ),
        mapped_channels: summarizeDimensionBuckets(
          mapped.map((row) => ({
            value: row.channel,
            orderId: row.orderId,
            amount: row.amount,
          }))
        ),
        payment_methods: summarizeDimensionBuckets(
          paymentsByCompany.get(odoo_company_id) ??
            mapped.map((row) => ({
              value: row.payment,
              orderId: row.orderId,
              amount: row.amount,
            }))
        ),
        pos_categories: summarizeDimensionBuckets(posCatItems),
        product_categories: summarizeDimensionBuckets(prodCatItems),
      };
    });

  return {
    available_fields: {
      "pos.order": [...input.availableOrderFields].sort(),
      "pos.payment": input.availablePaymentFields
        ? [...input.availablePaymentFields].sort()
        : null,
      "product.product": input.availableProductFields
        ? [...input.availableProductFields].sort()
        : null,
    },
    by_odoo_company,
    multi_payment_rule: MULTI_PAYMENT_RULE,
    notes: input.notes,
    call_count: input.callCount,
  };
}
