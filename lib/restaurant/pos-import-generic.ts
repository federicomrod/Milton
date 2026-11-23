// lib/restaurant/pos-import-generic.ts
//
// Generic sales file column mapper for non-Revel POS exports.
// Issue #531: Fuel, El Malevo, and other clients with different column layouts.
//
// This module handles:
// - Header detection (skip title/summary rows)
// - Flexible column mapping (AI + heuristics)
// - Multiple date formats (US, EU, ISO)
// - Decimal separator detection (comma vs dot)
// - Preview and confirmation flow

import crypto from "crypto";
import { normalizeHeader } from "./pos-import";
import { resolveScopedName } from "./scoped-matching";
import type {
  PosSalesItemInsert,
  SourceType,
  SalesChannel,
} from "./pos-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedColumnMapping {
  header_fingerprint: string;
  mapping_name: string;
  column_mapping: Record<string, string>; // logical field → actual header
  date_format?: string;
  decimal_separator: "comma" | "dot";
  created_at: string;
  last_used: string;
}

export interface DetectedFormat {
  headers: string[];
  header_row_index: number;
  decimal_separator: "comma" | "dot";
  sample_rows: Record<string, unknown>[];
}

/**
 * Logical fields we need to map for a sales import.
 * Required: date, product, quantity, net_amount
 * Optional: location, category, order_id, payment_type
 */
export const SALES_LOGICAL_FIELDS = {
  // Required fields
  date: { required: true, type: "date" },
  product: { required: true, type: "string" },
  quantity: { required: true, type: "number" },
  net_amount: { required: true, type: "number" },

  // Optional fields
  location: { required: false, type: "string" },
  category: { required: false, type: "string" },
  sub_category: { required: false, type: "string" },
  order_id: { required: false, type: "string" },
  payment_type: { required: false, type: "string" },
  gross_amount: { required: false, type: "number" },
  discount: { required: false, type: "number" },
  tax: { required: false, type: "number" },
} as const;

export type SalesLogicalField = keyof typeof SALES_LOGICAL_FIELDS;

export interface ColumnMappingPreview {
  header_fingerprint: string;
  suggested_mapping: Record<string, string>;
  decimal_separator: "comma" | "dot";
  sample_rows: Record<string, unknown>[];
  unmapped_required: string[];
  confidence: number;
}

export interface GenericNormalizeContext {
  company_id: string;
  source_type: SourceType;
  currency: string;
  column_mapping: Record<string, string>;
  decimal_separator: "comma" | "dot";
  locationIndex: Map<string, string>;
  locationBrandIndex: Map<string, string | null>;
  menuItemIndex: import("./scoped-matching").ScopedNameIndex;
}

// ---------------------------------------------------------------------------
// Header detection and fingerprinting
// ---------------------------------------------------------------------------

/**
 * Compute a stable fingerprint for a set of headers by sorting and hashing.
 * This lets us match future uploads to saved mappings even if columns are
 * reordered.
 */
export function computeHeaderFingerprint(headers: string[]): string {
  const sorted = [...headers].map(normalizeHeader).sort();
  return crypto.createHash("sha256").update(sorted.join("|")).digest("hex");
}

/**
 * Detect which row contains the actual headers by looking for rows with
 * multiple non-empty string values and no numeric-only patterns.
 * Returns the header row index and the headers themselves.
 */
export function detectHeaders(
  rows: Record<string, unknown>[]
): { headers: string[]; headerRowIndex: number } | null {
  if (rows.length === 0) return null;

  // Try first 10 rows to find headers
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    const values = Object.values(row);

    // Skip rows that are mostly empty
    const nonEmpty = values.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    if (nonEmpty.length < 3) continue;

    // Headers should be mostly strings, not numbers
    const stringValues = nonEmpty.filter((v) => typeof v === "string");
    if (stringValues.length < nonEmpty.length * 0.7) continue;

    // Headers shouldn't look like data (all numbers, dates, etc)
    const looksLikeData = stringValues.every((v) => {
      const s = String(v).trim();
      return (
        /^\d+([.,]\d+)?$/.test(s) ||
        /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(s)
      );
    });
    if (looksLikeData) continue;

    // This looks like a header row
    const headers = Object.keys(row).filter(
      (k) => row[k] !== null && row[k] !== undefined && row[k] !== ""
    );
    if (headers.length >= 3) {
      return { headers, headerRowIndex: i };
    }
  }

  // Fallback: use first row keys as headers
  const firstRowKeys = Object.keys(rows[0]).filter(
    (k) => k && k !== "__EMPTY" && k !== "__EMPTY_1"
  );
  return { headers: firstRowKeys, headerRowIndex: 0 };
}

/**
 * Detect decimal separator by looking at sample numeric values.
 * Returns "comma" if we see patterns like "1.234,56" or "comma" is more common,
 * otherwise "dot".
 */
export function detectDecimalSeparator(
  rows: Record<string, unknown>[]
): "comma" | "dot" {
  let commaDecimals = 0;
  let dotDecimals = 0;

  for (const row of rows.slice(0, 100)) {
    for (const value of Object.values(row)) {
      if (typeof value !== "string") continue;
      const s = value.trim();

      // Pattern: "1.234,56" or "1,56" with comma as decimal
      if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
        commaDecimals++;
      }
      // Pattern: "1,234.56" or "1.56" with dot as decimal
      if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) {
        dotDecimals++;
      }
    }
  }

  return commaDecimals > dotDecimals ? "comma" : "dot";
}

// ---------------------------------------------------------------------------
// Number parsing with decimal separator support
// ---------------------------------------------------------------------------

/**
 * Parse a number value respecting the detected decimal separator.
 * - If separator is "comma": "1.234,56" → 1234.56
 * - If separator is "dot": "1,234.56" → 1234.56
 */
export function parseNumberGeneric(
  value: unknown,
  decimalSeparator: "comma" | "dot"
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const s = String(value).trim();
  if (!s) return null;

  // Remove currency symbols and spaces
  let cleaned = s.replace(/[$€£¥\s]/g, "");

  if (decimalSeparator === "comma") {
    // European format: "1.234,56" → remove dots (thousands), replace comma with dot (decimal)
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US format: "1,234.56" → remove commas (thousands), dot is decimal
    cleaned = cleaned.replace(/,/g, "");
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a date value supporting multiple formats:
 * - ISO: YYYY-MM-DD
 * - US: MM/DD/YYYY
 * - EU: DD/MM/YYYY or DD.MM.YYYY
 * - Excel serial number
 */
export function parseDateGeneric(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Excel serial number
  if (typeof value === "number" && value > 1 && value < 100000) {
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO format: YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // US format: MM/DD/YYYY
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    // Disambiguate: if day > 12, it's definitely DD/MM/YYYY
    if (parseInt(mm) > 12) {
      return `${yyyy}-${dd.padStart(2, "0")}-${mm.padStart(2, "0")}`;
    }
    // Otherwise assume US format MM/DD/YYYY
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // EU format: DD.MM.YYYY or DD/MM/YYYY
  const euMatch = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (euMatch) {
    const [, dd, mm, yyyy] = euMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // Last resort: try Date.parse
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Generic row normalization
// ---------------------------------------------------------------------------

/**
 * Derive sales channel from optional order_type or payment_type text.
 */
function deriveSalesChannelGeneric(
  orderType: unknown,
  paymentType?: unknown
): SalesChannel {
  const o = String(orderType ?? "").toLowerCase();
  if (
    o.includes("delivery") ||
    o.includes("uber") ||
    o.includes("rappi") ||
    o.includes("entrega") ||
    o.includes("domicilio")
  )
    return "delivery";
  if (o.includes("online") || o.includes("web") || o.includes("app"))
    return "online";
  if (
    o.includes("to go") ||
    o.includes("togo") ||
    o.includes("takeaway") ||
    o.includes("take-away") ||
    o.includes("pickup") ||
    o.includes("take out") ||
    o.includes("para llevar") ||
    o.includes("llevar")
  )
    return "takeaway";
  if (
    o.includes("eat in") ||
    o.includes("dine") ||
    o.includes("eat-in") ||
    o.includes("comer aquí") ||
    o.includes("local")
  )
    return "in_store";

  // Fallback to payment hints
  const p = String(paymentType ?? "").toLowerCase();
  if (p.includes("delivery") || p.includes("entrega")) return "delivery";
  if (p.includes("online")) return "online";

  return "in_store";
}

/**
 * Normalize a generic POS row using a user-confirmed column mapping.
 * Similar to normalizeRevelPOSRow but driven by the mapping config.
 */
export function normalizeGenericPOSRow(
  row: Record<string, unknown>,
  rowIndex: number,
  ctx: GenericNormalizeContext
):
  | { ok: true; insert: PosSalesItemInsert }
  | {
      ok: false;
      error: { rowIndex: number; reason: string; rawOrderNumber?: string };
    } {
  const cm = ctx.column_mapping;

  // Parse date (required)
  const dateCol = cm.date;
  if (!dateCol) {
    return { ok: false, error: { rowIndex, reason: "No date column mapped" } };
  }
  const saleDate = parseDateGeneric(row[dateCol]);
  if (!saleDate) {
    return {
      ok: false,
      error: { rowIndex, reason: "Invalid or missing date" },
    };
  }

  // Parse product name (required)
  const productCol = cm.product;
  if (!productCol) {
    return {
      ok: false,
      error: { rowIndex, reason: "No product column mapped" },
    };
  }
  const productName = String(row[productCol] ?? "").trim();
  if (!productName) {
    return { ok: false, error: { rowIndex, reason: "Missing product name" } };
  }

  // Parse quantity (required)
  const quantityCol = cm.quantity;
  if (!quantityCol) {
    return {
      ok: false,
      error: { rowIndex, reason: "No quantity column mapped" },
    };
  }
  const quantity = parseNumberGeneric(row[quantityCol], ctx.decimal_separator);
  if (quantity === null || quantity === 0) {
    return {
      ok: false,
      error: { rowIndex, reason: "Invalid or missing quantity" },
    };
  }

  // Parse net amount (required)
  const netCol = cm.net_amount;
  if (!netCol) {
    return {
      ok: false,
      error: { rowIndex, reason: "No net amount column mapped" },
    };
  }
  const netRevenue = parseNumberGeneric(row[netCol], ctx.decimal_separator);
  if (netRevenue === null) {
    return {
      ok: false,
      error: { rowIndex, reason: "Invalid or missing net amount" },
    };
  }

  // Optional fields
  const grossRevenue = cm.gross_amount
    ? (parseNumberGeneric(row[cm.gross_amount], ctx.decimal_separator) ??
      netRevenue)
    : netRevenue;
  const discountAmount = cm.discount
    ? (parseNumberGeneric(row[cm.discount], ctx.decimal_separator) ?? 0)
    : 0;
  const taxAmount = cm.tax
    ? parseNumberGeneric(row[cm.tax], ctx.decimal_separator)
    : null;

  const orderIdRaw = cm.order_id ? String(row[cm.order_id] ?? "") : "";
  const orderId = orderIdRaw || `order-${rowIndex}`;

  const orderType = cm.payment_type ? row[cm.payment_type] : undefined;
  const salesChannel = deriveSalesChannelGeneric(orderType);

  // Location soft-match
  const locationKey = cm.location
    ? normalizeHeader(String(row[cm.location] ?? ""))
    : "";
  const locationId = locationKey
    ? (ctx.locationIndex.get(locationKey) ?? null)
    : null;

  // Brand scoping for menu item match
  const brandId = locationId
    ? (ctx.locationBrandIndex.get(locationId) ?? null)
    : null;

  const menuItemId = resolveScopedName(
    ctx.menuItemIndex,
    brandId,
    normalizeHeader(productName)
  );

  // Optional text fields
  const paymentType =
    cm.payment_type && row[cm.payment_type]
      ? String(row[cm.payment_type]).trim() || null
      : null;
  const category =
    cm.category && row[cm.category]
      ? String(row[cm.category]).trim() || null
      : null;
  const subCategory =
    cm.sub_category && row[cm.sub_category]
      ? String(row[cm.sub_category]).trim() || null
      : null;

  return {
    ok: true,
    insert: {
      company_id: ctx.company_id,
      location_id: locationId,
      menu_item_id: menuItemId,
      sale_date: saleDate,
      order_id: orderId,
      check_id: orderId,
      raw_item_name: productName,
      quantity,
      gross_revenue: grossRevenue,
      net_revenue: netRevenue,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      currency: ctx.currency,
      sales_channel: salesChannel,
      source_type: ctx.source_type,
      payment_type: paymentType,
      category,
      sub_category: subCategory,
    },
  };
}
