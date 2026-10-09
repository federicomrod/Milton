// lib/restaurant/odoo/dimension-fetch.ts
//
// Batched, read-only Odoo reads for channel / payment / category
// dimensions. Callers inject a scoped RPC (`fields_get` + `search_read`).
// Missing models or fields never fail the sync — that dimension stays
// empty and the note list explains why.

import { OdooRpcError } from "./client";
import { OdooCompanyScopeError } from "./scoped";
import {
  CATEGORY_NODE_FIELDS,
  CHANNEL_ORDER_FIELD_CANDIDATES,
  ORDER_AMOUNT_FIELD_CANDIDATES,
  PAYMENT_FIELD_CANDIDATES,
  PRODUCT_CATEGORY_FIELD_CANDIDATES,
  categoryNodeFromRaw,
  channelSignalsFromOrder,
  fieldNamesFromFieldsGet,
  many2oneId,
  many2oneName,
  mapProductCategories,
  mapSalesChannel,
  pickPresentFields,
  productCategorySourceFromRaw,
  resolvePaymentType,
  type CategoryNode,
  type PaymentLine,
} from "./dimensions";
import type { XmlRpcValue } from "./xmlrpc";

export const ODOO_ID_BATCH = 200;

export type ScopedOdooCall = (
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs?: Record<string, XmlRpcValue>
) => Promise<XmlRpcValue>;

export interface OdooPaymentRaw {
  id?: number;
  pos_order_id?: unknown;
  order_id?: unknown;
  payment_method_id?: unknown;
  amount?: unknown;
  company_id?: unknown;
}

export interface OdooDimensionLookups {
  channelByOrderId: Map<number, string | null>;
  channelSourceByOrderId: Map<number, string | null>;
  paymentByOrderId: Map<number, string | null>;
  categoryByProductId: Map<
    number,
    { category: string | null; sub_category: string | null }
  >;
}

export interface LoadedOdooDimensions {
  lookups: OdooDimensionLookups;
  availableOrderFields: Set<string>;
  availablePaymentFields: Set<string> | null;
  availableProductFields: Set<string> | null;
  payments: OdooPaymentRaw[];
  products: Record<string, unknown>[];
  posCategories: Map<number, CategoryNode>;
  productCategories: Map<number, CategoryNode>;
  notes: string[];
  callCount: number;
  /** True when pos.payment fields_get or search_read failed. */
  paymentReadFailed: boolean;
  /** True when product.product fields_get or search_read failed. */
  categoryReadFailed: boolean;
}

export function chunkIds(
  ids: number[],
  size: number = ODOO_ID_BATCH
): number[][] {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  const out: number[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    out.push(unique.slice(i, i + size));
  }
  return out;
}

function isSkippableOdooError(err: unknown): boolean {
  if (err instanceof OdooCompanyScopeError) return false;
  return err instanceof OdooRpcError || err instanceof Error;
}

export async function detectModelFields(
  call: ScopedOdooCall,
  model: string,
  stats?: { callCount: number }
): Promise<Set<string> | null> {
  try {
    if (stats) stats.callCount += 1;
    const result = await call(model, "fields_get", [], {
      attributes: ["string", "type"],
    });
    return fieldNamesFromFieldsGet(result);
  } catch (err) {
    if (!isSkippableOdooError(err)) throw err;
    return null;
  }
}

/**
 * Batched search_read. Returns null when any batch fails so callers can
 * refuse to overwrite stored payment / category values with null.
 */
async function searchReadBatched(
  call: ScopedOdooCall,
  model: string,
  domainField: string,
  ids: number[],
  fields: string[],
  stats: { callCount: number; notes: string[] }
): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunkIds(ids)) {
    try {
      stats.callCount += 1;
      const result = await call(
        model,
        "search_read",
        [[[domainField, "in", chunk]]],
        { fields }
      );
      if (Array.isArray(result)) {
        for (const row of result) {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            rows.push(row as Record<string, unknown>);
          }
        }
      }
    } catch (err) {
      if (!isSkippableOdooError(err)) throw err;
      stats.notes.push(
        `${model} search_read failed for ${domainField} batch of ${chunk.length}; existing stored values are kept`
      );
      return null;
    }
  }
  return rows;
}

export function stripFailedDimensionFields(
  row: object,
  flags: { paymentReadFailed: boolean; categoryReadFailed: boolean }
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row };
  if (flags.paymentReadFailed) {
    delete next.payment_type;
  }
  if (flags.categoryReadFailed) {
    delete next.category;
    delete next.sub_category;
  }
  return next;
}

function paymentOrderId(
  payment: OdooPaymentRaw,
  available: Set<string>
): number | null {
  if (available.has("pos_order_id")) return many2oneId(payment.pos_order_id);
  if (available.has("order_id")) return many2oneId(payment.order_id);
  return many2oneId(payment.pos_order_id) ?? many2oneId(payment.order_id);
}

function emptyLookups(): OdooDimensionLookups {
  return {
    channelByOrderId: new Map(),
    channelSourceByOrderId: new Map(),
    paymentByOrderId: new Map(),
    categoryByProductId: new Map(),
  };
}

export function buildDimensionLookups(input: {
  orders: Record<string, unknown>[];
  payments: OdooPaymentRaw[];
  products: Record<string, unknown>[];
  posCategories: Map<number, CategoryNode>;
  productCategories: Map<number, CategoryNode>;
  availableOrderFields: Set<string>;
  availablePaymentFields: Set<string> | null;
  availableProductFields: Set<string> | null;
}): OdooDimensionLookups {
  const lookups = emptyLookups();

  for (const order of input.orders) {
    if (typeof order.id !== "number") continue;
    const mapped = mapSalesChannel(
      channelSignalsFromOrder(order, input.availableOrderFields)
    );
    lookups.channelByOrderId.set(order.id, mapped.channel);
    lookups.channelSourceByOrderId.set(order.id, mapped.source);
  }

  if (input.availablePaymentFields) {
    const byOrder = new Map<number, PaymentLine[]>();
    for (const payment of input.payments) {
      const orderId = paymentOrderId(payment, input.availablePaymentFields);
      if (orderId === null) continue;
      const amount =
        typeof payment.amount === "number" ? payment.amount : Number.NaN;
      const list = byOrder.get(orderId) ?? [];
      list.push({
        methodName: many2oneName(payment.payment_method_id),
        amount,
      });
      byOrder.set(orderId, list);
    }
    for (const [orderId, lines] of byOrder) {
      lookups.paymentByOrderId.set(orderId, resolvePaymentType(lines));
    }
  }

  if (input.availableProductFields) {
    for (const product of input.products) {
      if (typeof product.id !== "number") continue;
      lookups.categoryByProductId.set(
        product.id,
        mapProductCategories(
          productCategorySourceFromRaw(product, input.availableProductFields),
          input.posCategories,
          input.productCategories
        )
      );
    }
  }

  return lookups;
}

export async function loadOdooDimensions(
  call: ScopedOdooCall,
  orders: Record<string, unknown>[],
  productIds: number[]
): Promise<LoadedOdooDimensions> {
  const stats = { callCount: 0, notes: [] as string[] };
  const availableOrderFields =
    (await detectModelFields(call, "pos.order", stats)) ?? new Set<string>();
  const availablePaymentFields = await detectModelFields(
    call,
    "pos.payment",
    stats
  );
  const availableProductFields = await detectModelFields(
    call,
    "product.product",
    stats
  );

  if (
    pickPresentFields(availableOrderFields, CHANNEL_ORDER_FIELD_CANDIDATES)
      .length === 0
  ) {
    stats.notes.push(
      "pos.order has no known channel fields (preset / takeaway / table / order type / delivery provider)"
    );
  }

  const payments: OdooPaymentRaw[] = [];
  let paymentReadFailed = false;
  if (availablePaymentFields) {
    const paymentFields = pickPresentFields(
      availablePaymentFields,
      PAYMENT_FIELD_CANDIDATES
    );
    const orderLink = paymentFields.includes("pos_order_id")
      ? "pos_order_id"
      : paymentFields.includes("order_id")
        ? "order_id"
        : null;
    if (!orderLink || !paymentFields.includes("payment_method_id")) {
      stats.notes.push(
        "pos.payment is missing pos_order_id/order_id or payment_method_id"
      );
    } else {
      const fetched = await searchReadBatched(
        call,
        "pos.payment",
        orderLink,
        orders
          .map((o) => o.id)
          .filter((id): id is number => typeof id === "number"),
        paymentFields,
        stats
      );
      if (fetched === null) {
        paymentReadFailed = true;
      } else {
        payments.push(...(fetched as OdooPaymentRaw[]));
      }
    }
  } else {
    paymentReadFailed = true;
    stats.notes.push("pos.payment fields_get failed or the model is absent");
  }

  const products: Record<string, unknown>[] = [];
  let posCategories = new Map<number, CategoryNode>();
  let productCategories = new Map<number, CategoryNode>();
  let categoryReadFailed = false;
  if (availableProductFields) {
    const productFields = [
      "id",
      ...pickPresentFields(
        availableProductFields,
        PRODUCT_CATEGORY_FIELD_CANDIDATES
      ),
    ];
    const hasAnyCategory =
      productFields.includes("categ_id") ||
      productFields.includes("pos_categ_id") ||
      productFields.includes("pos_categ_ids");
    if (!hasAnyCategory) {
      stats.notes.push(
        "product.product has neither POS category nor product category fields"
      );
    } else {
      const fetchedProducts = await searchReadBatched(
        call,
        "product.product",
        "id",
        productIds,
        productFields,
        stats
      );
      if (fetchedProducts === null) {
        categoryReadFailed = true;
      } else {
        products.push(...fetchedProducts);
      }

      const posIds = new Set<number>();
      const prodCategIds = new Set<number>();
      for (const product of products) {
        const src = productCategorySourceFromRaw(
          product,
          availableProductFields
        );
        for (const id of src.posCategIds ?? []) posIds.add(id);
        if (src.posCateg) posIds.add(src.posCateg.id);
        if (src.productCateg) prodCategIds.add(src.productCateg.id);
      }

      if (posIds.size > 0) {
        const posFieldsAvail = await detectModelFields(
          call,
          "pos.category",
          stats
        );
        if (posFieldsAvail) {
          const fields = [
            "id",
            ...pickPresentFields(posFieldsAvail, CATEGORY_NODE_FIELDS),
          ];
          const rows = await searchReadBatched(
            call,
            "pos.category",
            "id",
            [...posIds],
            fields,
            stats
          );
          posCategories = nodesFromRows(rows ?? []);
          const parentIds = parentIdsMissing(posCategories);
          if (parentIds.length > 0) {
            const parents = await searchReadBatched(
              call,
              "pos.category",
              "id",
              parentIds,
              fields,
              stats
            );
            for (const node of nodesFromRows(parents ?? []).values()) {
              posCategories.set(node.id, node);
            }
          }
        } else {
          stats.notes.push(
            "pos.category is absent; POS category names come from the product many2one only"
          );
        }
      }

      if (prodCategIds.size > 0) {
        const prodFieldsAvail = await detectModelFields(
          call,
          "product.category",
          stats
        );
        if (prodFieldsAvail) {
          const fields = [
            "id",
            ...pickPresentFields(prodFieldsAvail, CATEGORY_NODE_FIELDS),
          ];
          const rows = await searchReadBatched(
            call,
            "product.category",
            "id",
            [...prodCategIds],
            fields,
            stats
          );
          productCategories = nodesFromRows(rows ?? []);
          const parentIds = parentIdsMissing(productCategories);
          if (parentIds.length > 0) {
            const parents = await searchReadBatched(
              call,
              "product.category",
              "id",
              parentIds,
              fields,
              stats
            );
            for (const node of nodesFromRows(parents ?? []).values()) {
              productCategories.set(node.id, node);
            }
          }
        }
      }
    }
  } else {
    categoryReadFailed = true;
    stats.notes.push(
      "product.product fields_get failed or the model is absent"
    );
  }

  const lookups = buildDimensionLookups({
    orders,
    payments,
    products,
    posCategories,
    productCategories,
    availableOrderFields,
    availablePaymentFields,
    availableProductFields,
  });

  return {
    lookups,
    availableOrderFields,
    availablePaymentFields,
    availableProductFields,
    payments,
    products,
    posCategories,
    productCategories,
    notes: stats.notes,
    callCount: stats.callCount,
    paymentReadFailed,
    categoryReadFailed,
  };
}

function nodesFromRows(
  rows: Record<string, unknown>[]
): Map<number, CategoryNode> {
  const map = new Map<number, CategoryNode>();
  for (const row of rows) {
    const node = categoryNodeFromRaw(row);
    if (node) map.set(node.id, node);
  }
  return map;
}

function parentIdsMissing(nodes: Map<number, CategoryNode>): number[] {
  const missing: number[] = [];
  for (const node of nodes.values()) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      missing.push(node.parentId);
    }
  }
  return missing;
}

export function optionalOrderFields(available: Set<string>): string[] {
  return pickPresentFields(available, [
    ...CHANNEL_ORDER_FIELD_CANDIDATES,
    ...ORDER_AMOUNT_FIELD_CANDIDATES,
  ]);
}
