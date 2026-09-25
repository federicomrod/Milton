// lib/restaurant/odoo/sync.ts
//
// Pure Odoo → Milton canonical pos_sales_items transform. No Supabase, no
// network — takes already-fetched Odoo rows (search_read output shape)
// and a small context bundle, returns insertable rows plus a skip log.
// Mirrors the existing lib/restaurant/pos-import.ts contract for Revel:
// deterministic, no I/O, safe to unit test with fixtures.
//
// Revenue mapping (provisional — see Issue #3 analysis):
//   gross_revenue = price_subtotal_incl (tax-incl, post-discount)
//   net_revenue   = price_subtotal      (tax-excl, post-discount)
// This has NOT been reconciled against a real Revel export's tax/discount
// convention. Treat cross-source (Revel vs Odoo) KPI comparisons as
// unverified until that reconciliation happens — this module does not
// block on it per the approved decision.
//
// Multi-restaurant matching (Multi-Restaurant v1): mirrors pos-import.ts —
// a line's menu-item match is scoped by the BRAND of the order's matched
// pos.config/location, never guessed across brands. See
// lib/restaurant/scoped-matching.ts.

import { resolveScopedName, type ScopedNameIndex } from "../scoped-matching";

// ---------------------------------------------------------------------------
// Odoo raw row shapes (search_read output). Odoo many2one fields come back
// as a 2-tuple [id, display_name], or the literal `false` when unset.
// ---------------------------------------------------------------------------

export type OdooMany2one = [number, string] | false;

export const ODOO_COMPLETED_STATES = ["paid", "done", "invoiced"] as const;
export type OdooCompletedState = (typeof ODOO_COMPLETED_STATES)[number];

export interface OdooPosOrderRaw {
  id: number;
  state: string;
  /** Odoo XML-RPC convention: naive UTC "YYYY-MM-DD HH:MM:SS". */
  date_order: string;
  pos_reference: string | false;
  uuid: string | false;
  session_id: OdooMany2one;
  config_id: OdooMany2one;
  currency_id: OdooMany2one;
}

export interface OdooPosOrderLineRaw {
  id: number;
  order_id: OdooMany2one;
  product_id: OdooMany2one;
  full_product_name: string;
  qty: number;
  price_unit: number;
  price_subtotal: number;
  price_subtotal_incl: number;
  discount: number; // percent, 0-100
  uuid?: string | false;
}

// ---------------------------------------------------------------------------
// Context + output
// ---------------------------------------------------------------------------

export interface OdooSyncContext {
  companyId: string;
  /** IANA timezone, e.g. "America/Mexico_City" — from restaurant_pos_connections.timezone. */
  timezone: string;
  /** Fallback currency when an order's currency_id is unexpectedly unset. */
  defaultCurrency: string;
  /**
   * Menu items indexed by brand (scopeId = brand_id, or unscoped for
   * legacy brand_id-NULL items) — see lib/restaurant/scoped-matching.ts.
   */
  menuItemIndex: ScopedNameIndex;
  /** normalized pos.config name → restaurant_locations.id. */
  locationIndex: Map<string, string>;
  /** location_id → brand_id (or null), so a resolved location can be scoped to its brand. */
  locationBrandIndex: Map<string, string | null>;
}

export interface CanonicalOdooSaleRow {
  company_id: string;
  location_id: string | null;
  menu_item_id: string | null;
  sale_date: string; // YYYY-MM-DD, in ctx.timezone
  order_id: string;
  check_id: string;
  raw_item_name: string;
  quantity: number;
  gross_revenue: number;
  net_revenue: number;
  discount_amount: number;
  tax_amount: number;
  currency: string;
  sales_channel: null;
  source_type: "api";
  pos_source: "odoo";
  external_line_id: string;
  unit_price: number;
  order_placed_at: string; // ISO 8601 UTC
  source_metadata: Record<string, unknown>;
}

export interface SkippedLine {
  line_id: number | null;
  order_id: number | null;
  reason: string;
}

export interface TransformResult {
  rows: CanonicalOdooSaleRow[];
  skipped: SkippedLine[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors pos-import.ts's header/name normalization so both sources match consistently. */
export function normalizeMatchKey(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converts Odoo's naive-UTC "YYYY-MM-DD HH:MM:SS" datetime string to a
 * proper ISO 8601 UTC instant. Odoo's XML-RPC API always returns Datetime
 * fields in UTC with no offset marker — this makes that explicit.
 */
export function parseOdooDatetimeToUtcIso(odooDatetime: string): string {
  const iso = odooDatetime.trim().replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Cannot parse Odoo datetime: "${odooDatetime}"`);
  }
  return d.toISOString();
}

/**
 * Derives the local calendar date (YYYY-MM-DD) for a UTC instant in the
 * given IANA timezone. Zero-dependency: Intl with the en-CA locale
 * formats as YYYY-MM-DD directly.
 */
export function deriveLocalSaleDate(utcIso: string, timeZone: string): string {
  const d = new Date(utcIso);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Transforms raw Odoo pos.order / pos.order.line rows into canonical
 * pos_sales_items insert rows.
 *
 * - Only orders whose state is in ODOO_COMPLETED_STATES are considered;
 *   lines belonging to any other order (or referencing an order not in
 *   `orders`) are skipped, never silently dropped without a record.
 * - A line whose product has no pos_item_mappings-equivalent match still
 *   produces a row — menu_item_id is null, raw_item_name is preserved.
 *   Sales are never discarded for being unmatched.
 * - discount_amount and tax_amount are derived (Odoo doesn't provide them
 *   directly): discount is a percentage on the line, and there is no
 *   per-line tax-amount field.
 */
export function transformOdooOrders(
  orders: OdooPosOrderRaw[],
  lines: OdooPosOrderLineRaw[],
  ctx: OdooSyncContext
): TransformResult {
  const completedOrderById = new Map<number, OdooPosOrderRaw>();
  for (const order of orders) {
    if ((ODOO_COMPLETED_STATES as readonly string[]).includes(order.state)) {
      completedOrderById.set(order.id, order);
    }
  }

  const rows: CanonicalOdooSaleRow[] = [];
  const skipped: SkippedLine[] = [];

  for (const line of lines) {
    const orderId = Array.isArray(line.order_id) ? line.order_id[0] : null;
    if (orderId === null) {
      skipped.push({
        line_id: line.id ?? null,
        order_id: null,
        reason: "Line has no order_id",
      });
      continue;
    }
    const order = completedOrderById.get(orderId);
    if (!order) {
      // Either the order wasn't in a completed state or wasn't in the
      // fetched batch at all — either way, this line is not synced.
      skipped.push({
        line_id: line.id,
        order_id: orderId,
        reason: "Order not in a completed state (paid/done/invoiced)",
      });
      continue;
    }

    const qty = line.qty;
    const priceUnit = line.price_unit;
    const priceSubtotal = line.price_subtotal;
    const priceSubtotalIncl = line.price_subtotal_incl;
    if (
      !Number.isFinite(qty) ||
      !Number.isFinite(priceUnit) ||
      !Number.isFinite(priceSubtotal) ||
      !Number.isFinite(priceSubtotalIncl)
    ) {
      skipped.push({
        line_id: line.id,
        order_id: orderId,
        reason: "Non-finite quantity or price field",
      });
      continue;
    }

    let orderPlacedAt: string;
    try {
      orderPlacedAt = parseOdooDatetimeToUtcIso(order.date_order);
    } catch {
      skipped.push({
        line_id: line.id,
        order_id: orderId,
        reason: `Invalid order date_order: "${order.date_order}"`,
      });
      continue;
    }

    const rawItemName = (line.full_product_name || "").trim();
    const locationId =
      order.config_id && order.config_id[1]
        ? (ctx.locationIndex.get(normalizeMatchKey(order.config_id[1])) ?? null)
        : null;
    // Brand scoping: only known when the pos.config resolved to a known
    // location. Unresolved location → unknown brand → only the
    // brand-less/legacy fallback bucket is considered, never a guess into
    // a specific brand's menu.
    const brandId = locationId
      ? (ctx.locationBrandIndex.get(locationId) ?? null)
      : null;
    const menuItemId = rawItemName
      ? resolveScopedName(
          ctx.menuItemIndex,
          brandId,
          normalizeMatchKey(rawItemName)
        )
      : null;

    const currency =
      order.currency_id && order.currency_id[1]
        ? order.currency_id[1]
        : ctx.defaultCurrency;

    const discountAmount = round2(priceUnit * qty - priceSubtotal);
    const taxAmount = round2(priceSubtotalIncl - priceSubtotal);
    const saleDate = deriveLocalSaleDate(orderPlacedAt, ctx.timezone);

    rows.push({
      company_id: ctx.companyId,
      location_id: locationId,
      menu_item_id: menuItemId,
      sale_date: saleDate,
      order_id: String(order.id),
      check_id: String(order.id),
      raw_item_name: rawItemName,
      quantity: qty,
      gross_revenue: priceSubtotalIncl,
      net_revenue: priceSubtotal,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      currency,
      sales_channel: null,
      source_type: "api",
      pos_source: "odoo",
      external_line_id: String(line.id),
      unit_price: priceUnit,
      order_placed_at: orderPlacedAt,
      source_metadata: {
        order_pos_reference: order.pos_reference || null,
        order_uuid: order.uuid || null,
        line_uuid: line.uuid || null,
        session_id: order.session_id ? order.session_id[0] : null,
        config_id: order.config_id ? order.config_id[0] : null,
        config_name: order.config_id ? order.config_id[1] : null,
        product_id: line.product_id ? line.product_id[0] : null,
        state: order.state,
      },
    });
  }

  return { rows, skipped };
}
