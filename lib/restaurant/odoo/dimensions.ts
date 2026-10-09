// lib/restaurant/odoo/dimensions.ts
//
// Pure Odoo → Milton dimension mapping (sales_channel, payment_type,
// category / sub_category). No I/O. Unknown stays null — never guessed.
//
// Channel vocabulary (matches RestaurantSalesExplorer CHANNEL_LABELS):
//   in_store → Eat In, takeaway → To Go, delivery → Delivery, online → Online
// A dedicated Odoo label that does not match the vocabulary is stored as
// the readable name. Till / pos.config names are used only when they map
// to that vocabulary (a till named "Los Ranchos" is not a channel).
//
// Multi-payment rule: group pos.payment rows by method name and sum
// amounts. One method → that name. Several → the method with the largest
// summed amount. A tie for largest → "Mixed". No usable name → null.

import type { OdooMany2one } from "./sync";

export const MIXED_PAYMENT_TYPE = "Mixed";

export const CHANNEL_VOCABULARY = [
  "in_store",
  "takeaway",
  "delivery",
  "online",
] as const;
export type ChannelVocabulary = (typeof CHANNEL_VOCABULARY)[number];

export function isChannelVocabulary(
  value: string | null | undefined
): value is ChannelVocabulary {
  return (
    value === "in_store" ||
    value === "takeaway" ||
    value === "delivery" ||
    value === "online"
  );
}

export const CHANNEL_ORDER_FIELD_CANDIDATES = [
  "preset_id",
  "table_id",
  "takeaway",
  "take_away",
  "is_togo",
  "is_takeaway",
  "service_mode",
  "order_type",
  "order_type_id",
  "sh_order_type_id",
  "delivery_provider_id",
] as const;

/**
 * Floor-name keywords for sales_channel when Odoo has no usable
 * order-type signal. Matching is case- and accent-insensitive against
 * the floor name (restaurant.table display prefix before the comma,
 * e.g. "LLEVAR, 4" → "LLEVAR"). Extend per client as new floor names
 * show up; do not guess from a missing table.
 */
export const TABLE_FLOOR_CHANNEL_KEYWORDS = {
  takeaway: ["llevar", "para llevar", "takeaway", "to go"],
  delivery: ["domicilio", "delivery", "express"],
} as const;

/** Synthetic audit field: floor name derived from table_id display. */
export const TABLE_FLOOR_SIGNAL_FIELD = "table_floor";

/** Case/accent fold used by floor-name and channel-label matching. */
export function foldLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "LOS RANCHOS, 5" → "LOS RANCHOS"; no comma → the whole display name. */
export function tableFloorNameFromDisplay(
  display: string | null | undefined
): string | null {
  const label = (display ?? "").trim();
  if (!label) return null;
  const comma = label.indexOf(",");
  if (comma === -1) return label;
  const prefix = label.slice(0, comma).trim();
  return prefix || label;
}

/**
 * Map a table floor name onto the Explorer vocabulary. A recognised
 * to-go / delivery keyword wins; any other non-empty floor is in_store.
 * Empty / missing → null (never guessed).
 */
export function mapFloorNameToChannel(
  floorName: string | null | undefined
): ChannelVocabulary | null {
  if (!floorName?.trim()) return null;
  const key = foldLabel(floorName);
  if (!key) return null;
  for (const kw of TABLE_FLOOR_CHANNEL_KEYWORDS.delivery) {
    if (key === kw || key.includes(kw)) return "delivery";
  }
  for (const kw of TABLE_FLOOR_CHANNEL_KEYWORDS.takeaway) {
    if (key === kw || key.includes(kw)) return "takeaway";
  }
  return "in_store";
}

export const ORDER_AMOUNT_FIELD_CANDIDATES = [
  "amount_total",
  "amount_paid",
] as const;

export const PAYMENT_FIELD_CANDIDATES = [
  "pos_order_id",
  "order_id",
  "payment_method_id",
  "amount",
  "company_id",
] as const;

export const PRODUCT_CATEGORY_FIELD_CANDIDATES = [
  "categ_id",
  "pos_categ_id",
  "pos_categ_ids",
  "company_id",
] as const;

export const CATEGORY_NODE_FIELDS = ["id", "name", "parent_id"] as const;

export function many2oneId(value: unknown): number | null {
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  return null;
}

export function many2oneName(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[1] === "string") {
    const name = value[1].trim();
    return name.length > 0 ? name : null;
  }
  return null;
}

export function asOdooMany2one(value: unknown): OdooMany2one | undefined {
  if (value === false) return false;
  if (Array.isArray(value) && typeof value[0] === "number") {
    return [value[0], typeof value[1] === "string" ? value[1] : ""];
  }
  return undefined;
}

export function pickPresentFields(
  available: Set<string> | null | undefined,
  candidates: readonly string[]
): string[] {
  if (!available) return [];
  return candidates.filter((field) => available.has(field));
}

export function fieldNamesFromFieldsGet(result: unknown): Set<string> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  return new Set(Object.keys(result as Record<string, unknown>));
}

/**
 * Map a free-text Odoo label onto the Explorer vocabulary. Returns the
 * original trimmed label when it is readable but does not match; null
 * when empty. Never defaults to in_store.
 */
export function mapChannelLabel(raw: string | null | undefined): string | null {
  const label = (raw ?? "").trim();
  if (!label) return null;
  const o = foldLabel(label);
  if (
    o.includes("delivery") ||
    o.includes("deliveroo") ||
    o.includes("uber") ||
    o.includes("rappi") ||
    o.includes("pedidosya") ||
    o.includes("didifood") ||
    o.includes("just eat") ||
    o.includes("justeat") ||
    o.includes("domicilio")
  ) {
    return "delivery";
  }
  if (
    o.includes("online") ||
    o.includes("web") ||
    o.includes("e-com") ||
    o.includes("ecom") ||
    o.includes("website")
  ) {
    return "online";
  }
  if (
    o.includes("to go") ||
    o.includes("togo") ||
    o.includes("to-go") ||
    o.includes("takeaway") ||
    o.includes("take-away") ||
    o.includes("take away") ||
    o.includes("takeout") ||
    o.includes("take-out") ||
    o.includes("take out") ||
    o.includes("pickup") ||
    o.includes("pick-up") ||
    o.includes("pick up") ||
    o.includes("llevar")
  ) {
    return "takeaway";
  }
  if (
    o.includes("eat in") ||
    o.includes("eat-in") ||
    o.includes("dine") ||
    o.includes("in store") ||
    o.includes("in-store") ||
    o.includes("instore") ||
    o.includes("on premise") ||
    o.includes("on-premise")
  ) {
    return "in_store";
  }
  return label;
}

export interface ChannelSignals {
  presetName?: string | null;
  orderType?: string | null;
  /** Softhealer pos.order.sh_order_type_id display name, when present. */
  shOrderTypeName?: string | null;
  serviceMode?: string | null;
  /** null = field not present on this Odoo; boolean = explicit value. */
  takeaway?: boolean | null;
  isTogo?: boolean | null;
  deliveryProviderName?: string | null;
  hasTable?: boolean | null;
  /** Floor name from table_id display (prefix before the comma). */
  tableFloorName?: string | null;
  configName?: string | null;
}

export interface MappedChannel {
  channel: string | null;
  source: string | null;
}

/**
 * First dedicated signal wins. Precedence:
 *   1. Named order-type signals (preset, Softhealer sh_order_type_id when
 *      it clearly maps to the Explorer vocabulary, order_type, service_mode)
 *   2. delivery_provider_id (before takeaway=false — that boolean is often
 *      stuck false on custom Odoos)
 *   3. takeaway / is_togo only when explicitly true
 *   4. Table floor name (LLEVAR → takeaway, DOMICILIO → delivery, any
 *      other real floor → in_store)
 *   5. A set table with no parseable floor → in_store
 *   6. Till / pos.config name, only when it maps to the vocabulary
 * No table and no other signal → null. Never guessed.
 */
export function mapSalesChannel(signals: ChannelSignals): MappedChannel {
  const named = (
    raw: string | null | undefined,
    source: string
  ): MappedChannel | null => {
    const channel = mapChannelLabel(raw);
    return channel ? { channel, source } : null;
  };
  const vocabulary = (
    raw: string | null | undefined,
    source: string
  ): MappedChannel | null => {
    const channel = mapChannelLabel(raw);
    return isChannelVocabulary(channel) ? { channel, source } : null;
  };

  const fromPreset = named(signals.presetName, "preset_id");
  if (fromPreset) return fromPreset;

  const fromShOrderType = vocabulary(
    signals.shOrderTypeName,
    "sh_order_type_id"
  );
  if (fromShOrderType) return fromShOrderType;

  const fromOrderType = named(signals.orderType, "order_type");
  if (fromOrderType) return fromOrderType;

  const fromService = named(signals.serviceMode, "service_mode");
  if (fromService) return fromService;

  if (signals.deliveryProviderName) {
    return {
      channel: mapChannelLabel(signals.deliveryProviderName) ?? "delivery",
      source: "delivery_provider_id",
    };
  }

  if (signals.takeaway === true || signals.isTogo === true) {
    return { channel: "takeaway", source: "takeaway" };
  }

  if (signals.tableFloorName) {
    const channel = mapFloorNameToChannel(signals.tableFloorName);
    if (channel) {
      return { channel, source: "table_floor" };
    }
  }

  if (signals.hasTable === true) {
    return { channel: "in_store", source: "table_id" };
  }

  const fromConfig = mapChannelLabel(signals.configName);
  if (isChannelVocabulary(fromConfig)) {
    return { channel: fromConfig, source: "config_id" };
  }

  return { channel: null, source: null };
}

export function channelSignalsFromOrder(
  order: Record<string, unknown>,
  available: Set<string>
): ChannelSignals {
  const has = (field: string) => available.has(field);
  const boolField = (field: string): boolean | null => {
    if (!has(field)) return null;
    const v = order[field];
    return typeof v === "boolean" ? v : null;
  };

  const orderType =
    (has("order_type") ? many2oneName(order.order_type) : null) ??
    (has("order_type") && typeof order.order_type === "string"
      ? order.order_type
      : null) ??
    (has("order_type_id") ? many2oneName(order.order_type_id) : null);

  return {
    presetName: has("preset_id") ? many2oneName(order.preset_id) : null,
    orderType,
    shOrderTypeName: has("sh_order_type_id")
      ? many2oneName(order.sh_order_type_id)
      : null,
    serviceMode:
      has("service_mode") && typeof order.service_mode === "string"
        ? order.service_mode
        : has("service_mode")
          ? many2oneName(order.service_mode)
          : null,
    takeaway: boolField("takeaway") ?? boolField("take_away"),
    isTogo: boolField("is_togo") ?? boolField("is_takeaway"),
    deliveryProviderName: has("delivery_provider_id")
      ? many2oneName(order.delivery_provider_id)
      : null,
    hasTable: has("table_id") ? many2oneId(order.table_id) !== null : null,
    tableFloorName: has("table_id")
      ? tableFloorNameFromDisplay(many2oneName(order.table_id))
      : null,
    configName: many2oneName(order.config_id),
  };
}

export interface PaymentLine {
  methodName: string | null;
  amount: number;
}

/**
 * Multi-payment rule (documented, tested):
 *   1. Drop rows with no method name or a non-finite amount.
 *   2. Sum amounts per method name.
 *   3. One method → that name.
 *   4. Several → the name with the largest summed amount.
 *   5. Tie for largest → "Mixed".
 */
export function resolvePaymentType(payments: PaymentLine[]): string | null {
  const byName = new Map<string, number>();
  for (const payment of payments) {
    const name = (payment.methodName ?? "").trim();
    if (!name || !Number.isFinite(payment.amount)) continue;
    byName.set(name, (byName.get(name) ?? 0) + payment.amount);
  }
  if (byName.size === 0) return null;
  if (byName.size === 1) return [...byName.keys()][0];

  let bestName: string | null = null;
  let bestAmount = -Infinity;
  let tied = false;
  for (const [name, amount] of byName) {
    if (amount > bestAmount) {
      bestName = name;
      bestAmount = amount;
      tied = false;
    } else if (amount === bestAmount) {
      tied = true;
    }
  }
  return tied ? MIXED_PAYMENT_TYPE : bestName;
}

export interface CategoryNode {
  id: number;
  name: string;
  parentId: number | null;
}

export interface ProductCategorySource {
  posCategIds?: number[];
  posCateg?: { id: number; name: string } | null;
  productCateg?: { id: number; name: string } | null;
}

export interface MappedCategories {
  category: string | null;
  sub_category: string | null;
}

function nodeName(
  id: number | null,
  nodes: Map<number, CategoryNode>,
  fallback?: string | null
): string | null {
  if (id === null) return fallback?.trim() || null;
  const node = nodes.get(id);
  const name = node?.name?.trim() || fallback?.trim() || null;
  return name || null;
}

function fromCategoryTree(
  id: number | null,
  name: string | null,
  nodes: Map<number, CategoryNode>
): MappedCategories {
  if (id === null && !name) {
    return { category: null, sub_category: null };
  }
  const node = id !== null ? nodes.get(id) : undefined;
  const selfName = node?.name?.trim() || name;
  const parentId = node?.parentId ?? null;
  if (parentId !== null) {
    const parentName = nodeName(parentId, nodes, null);
    if (parentName && selfName) {
      return { category: parentName, sub_category: selfName };
    }
  }
  return { category: selfName ?? null, sub_category: null };
}

/**
 * Prefer POS categories (pos_categ_ids / pos_categ_id) over product.category.
 * When a category has a parent, parent → category and self → sub_category.
 * Multiple POS categories: the most specific (has a parent) wins; else the
 * lowest id. No usable name → both null.
 */
export function mapProductCategories(
  product: ProductCategorySource,
  posCategories: Map<number, CategoryNode>,
  productCategories: Map<number, CategoryNode>
): MappedCategories {
  const posIds = [
    ...(product.posCategIds ?? []),
    ...(product.posCateg ? [product.posCateg.id] : []),
  ].filter(
    (id, index, all) => Number.isInteger(id) && all.indexOf(id) === index
  );

  if (posIds.length > 0) {
    const ranked = posIds
      .map((id) => ({
        id,
        node: posCategories.get(id),
        name: posCategories.get(id)?.name ?? product.posCateg?.name ?? null,
      }))
      .sort((a, b) => {
        const aParent = a.node?.parentId != null ? 1 : 0;
        const bParent = b.node?.parentId != null ? 1 : 0;
        if (aParent !== bParent) return bParent - aParent;
        return a.id - b.id;
      });
    const pick = ranked[0];
    return fromCategoryTree(pick.id, pick.name, posCategories);
  }

  if (product.productCateg) {
    return fromCategoryTree(
      product.productCateg.id,
      product.productCateg.name,
      productCategories
    );
  }

  return { category: null, sub_category: null };
}

export function productCategorySourceFromRaw(
  product: Record<string, unknown>,
  available: Set<string>
): ProductCategorySource {
  const posCategIds: number[] = [];
  if (available.has("pos_categ_ids") && Array.isArray(product.pos_categ_ids)) {
    for (const id of product.pos_categ_ids) {
      if (typeof id === "number" && Number.isInteger(id)) posCategIds.push(id);
    }
  }
  return {
    posCategIds,
    posCateg: available.has("pos_categ_id")
      ? (() => {
          const id = many2oneId(product.pos_categ_id);
          const name = many2oneName(product.pos_categ_id);
          return id !== null ? { id, name: name ?? "" } : null;
        })()
      : null,
    productCateg: available.has("categ_id")
      ? (() => {
          const id = many2oneId(product.categ_id);
          const name = many2oneName(product.categ_id);
          return id !== null ? { id, name: name ?? "" } : null;
        })()
      : null,
  };
}

export function categoryNodeFromRaw(
  raw: Record<string, unknown>
): CategoryNode | null {
  if (typeof raw.id !== "number" || !Number.isInteger(raw.id)) return null;
  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
  return {
    id: raw.id,
    name,
    parentId: many2oneId(raw.parent_id),
  };
}

export interface DimensionBucket {
  value: string | null;
  order_count: number;
  amount: number;
  row_count: number;
}

export function summarizeDimensionBuckets(
  items: Array<{
    value: string | null;
    orderId?: string | number | null;
    amount: number;
    rows?: number;
  }>
): DimensionBucket[] {
  const groups = new Map<
    string,
    {
      value: string | null;
      orders: Set<string>;
      amount: number;
      row_count: number;
    }
  >();
  for (const item of items) {
    const key = item.value ?? "__null__";
    let g = groups.get(key);
    if (!g) {
      g = {
        value: item.value,
        orders: new Set(),
        amount: 0,
        row_count: 0,
      };
      groups.set(key, g);
    }
    if (
      item.orderId !== undefined &&
      item.orderId !== null &&
      item.orderId !== ""
    ) {
      g.orders.add(String(item.orderId));
    }
    g.amount += Number(item.amount) || 0;
    g.row_count += item.rows ?? 1;
  }
  return [...groups.values()]
    .map((g) => ({
      value: g.value,
      order_count: g.orders.size,
      amount: Math.round(g.amount * 100) / 100,
      row_count: g.row_count,
    }))
    .sort(
      (a, b) =>
        b.amount - a.amount || (a.value ?? "").localeCompare(b.value ?? "")
    );
}

export interface ChannelSignalFieldReport {
  field: string;
  present: boolean;
  buckets: DimensionBucket[];
}

export function summarizeChannelSignalFields(
  orders: Array<{
    order: Record<string, unknown>;
    amount: number;
  }>,
  available: Set<string>
): ChannelSignalFieldReport[] {
  const reports = CHANNEL_ORDER_FIELD_CANDIDATES.map((field) => {
    const present = available.has(field);
    if (!present) {
      return { field, present: false, buckets: [] };
    }
    const items = orders.map(({ order, amount }) => {
      const raw = order[field];
      let value: string | null = null;
      if (typeof raw === "boolean") value = raw ? "true" : "false";
      else if (typeof raw === "string" && raw.trim()) value = raw.trim();
      else value = many2oneName(raw);
      return {
        value,
        orderId: typeof order.id === "number" ? order.id : null,
        amount,
      };
    });
    return { field, present: true, buckets: summarizeDimensionBuckets(items) };
  });

  const tablePresent = available.has("table_id");
  reports.push({
    field: TABLE_FLOOR_SIGNAL_FIELD,
    present: tablePresent,
    buckets: tablePresent
      ? summarizeDimensionBuckets(
          orders.map(({ order, amount }) => ({
            value: tableFloorNameFromDisplay(many2oneName(order.table_id)),
            orderId: typeof order.id === "number" ? order.id : null,
            amount,
          }))
        )
      : [],
  });
  return reports;
}
