// lib/restaurant/pos-import.ts
// Deterministic helpers for ingesting a Revel-style item-level POS export.
//
// This module is intentionally pure: no Supabase, no OpenAI, no I/O.
// Server code (app/api/restaurant/pos/upload/route.ts) calls these helpers
// after parsing the file with the existing XLSX/CSV path.
//
// Scope of this milestone: ONLY the Revel "Customer Items" item-level export.
// Generic POS support, PDF invoices, API integrations are out of scope.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SourceType = "csv" | "xlsx";

export type SalesChannel = "in_store" | "takeaway" | "delivery" | "online";

/**
 * Shape of a row ready to be inserted into Supabase `pos_sales_items`.
 * company_id is filled in by the API route (it comes from auth context, not
 * from the file).
 */
export interface PosSalesItemInsert {
  company_id: string;
  location_id: string | null;
  menu_item_id: string | null;
  sale_date: string; // ISO "YYYY-MM-DD" — strip time to keep the column shape simple
  order_id: string;
  check_id: string;
  raw_item_name: string;
  quantity: number;
  gross_revenue: number;
  net_revenue: number;
  discount_amount: number;
  tax_amount: number | null;
  currency: string;
  sales_channel: SalesChannel;
  source_type: SourceType;
  // Free-text fields populated when the upload file carries them; null when
  // the column was absent. Stored verbatim (trimmed) — we do NOT normalize
  // casing at ingest, so the dashboard can show the user's original labels.
  // Added by migration 002_add_pos_sales_filter_fields.sql.
  payment_type: string | null;
  category: string | null;
  sub_category: string | null;
}

export interface RowValidationError {
  rowIndex: number; // 0-based index into the data rows (header excluded)
  reason: string;
  rawOrderNumber?: string;
}

export interface ColumnValidationResult {
  ok: boolean;
  missingRequired: string[]; // logical names that could not be matched
  resolved: Record<string, string>; // logical name → actual header in the file
}

// ---------------------------------------------------------------------------
// Column resolution — Revel exports use slightly inconsistent header names
// (e.g. "Customer ID" with a space, "Sub-category" with a dash). We normalize
// before comparing to avoid surprises on real client files.
// ---------------------------------------------------------------------------

/**
 * Maps logical field names to one or more candidate header strings as they
 * may appear in the source file. The first candidate that matches a header
 * (after normalization) wins.
 */
const COLUMN_CANDIDATES: Record<string, string[]> = {
  establishment: ["Establishment_Name", "Establishment"],
  pos_station: ["POS_Station", "POS Station"],
  order_number: ["Order_Number", "Order Number"],
  order_type: ["Order_Type", "Order Type"],
  order_date: ["Order_Date", "Order Date"],
  payment_type: [
    "Payment_Type",
    "Payment Type",
    "Payment _type",
    "payment_type",
  ],
  product_name: ["Product_Name", "Product Name"],
  product_quantity: ["Product_Quantity", "Product Quantity", "Quantity"],
  gross_item: [
    "Gross_Item_Total",
    "Gross_Item_Price",
    "Gross Item Total",
    "Gross Item Price",
  ],
  total_sales: ["Total_Sales", "Total Sales"],
  discount: ["Discount_Amount", "Discount Amount", "Discount"],
  tax: ["Total_Product_Tax", "Tax_Amount", "Order_Sales_Tax"],
  // Newly persisted fields (see migration 002). Header normalization in
  // normalizeHeader() collapses spaces/underscores/dashes, so "Sub_Category",
  // "Sub Category", and "Sub-category" all match a single candidate.
  category: ["Category", "category", "Product_Category", "Product Category"],
  sub_category: [
    "Sub_Category",
    "Sub Category",
    "sub_category",
    "Sub-category",
    "Product_Sub_Category",
  ],
};

/** Logical fields that MUST be present for the upload to proceed. */
const REQUIRED_LOGICAL_COLUMNS: ReadonlyArray<keyof typeof COLUMN_CANDIDATES> =
  ["order_number", "order_date", "product_name", "product_quantity"];

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Resolves logical column names against the actual headers in the file.
 * Returns the resolved mapping plus any required columns that could not be matched.
 *
 * Note: at least ONE of (gross_item, total_sales) must be present — both can
 * supply revenue. The caller checks this after the basic missing-required pass.
 */
export function validateRevelPOSColumns(
  headers: string[]
): ColumnValidationResult {
  const normalizedHeaders = new Map<string, string>();
  for (const h of headers) {
    normalizedHeaders.set(normalizeHeader(h), h);
  }

  const resolved: Record<string, string> = {};
  for (const [logical, candidates] of Object.entries(COLUMN_CANDIDATES)) {
    for (const candidate of candidates) {
      const actual = normalizedHeaders.get(normalizeHeader(candidate));
      if (actual) {
        resolved[logical] = actual;
        break;
      }
    }
  }

  const missingRequired = REQUIRED_LOGICAL_COLUMNS.filter((k) => !resolved[k]);

  // Revenue requirement: at least one of gross_item / total_sales must be present.
  if (!resolved.gross_item && !resolved.total_sales) {
    missingRequired.push("gross_item_total OR total_sales");
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired: missingRequired as string[],
    resolved,
  };
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

/**
 * Parses a cell value to a finite number. Returns null when the value is
 * blank or cannot be coerced — caller decides whether that's an error.
 */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  // Strip currency symbols and thousands separators we sometimes see in exports.
  const cleaned = s.replace(/[$€£¥,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a Revel date cell into an ISO YYYY-MM-DD string.
 * Handles three observed shapes:
 *   - "MM/DD/YYYY HH:MM:SS" (US Revel format)
 *   - "YYYY-MM-DDTHH:MM:SS"  (already-normalized by the XLSX parser)
 *   - Excel serial number (rare — parse/route.ts usually pre-converts these)
 */
export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Excel serial number
  if (typeof value === "number" && value > 1 && value < 100000) {
    // Excel epoch: 1899-12-30. Multiply by ms per day.
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (!s) return null;

  // Already ISO?
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // MM/DD/YYYY or MM/DD/YYYY HH:MM:SS — Revel's default US format.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const [, mm, dd, yyyy] = us;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // DD.MM.YYYY (EU)
  const eu = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (eu) {
    const [, dd, mm, yyyy] = eu;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // Last-resort: let Date.parse try.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Derives a normalized sales channel from Revel's free-text Order_Type / Payment_Type.
 * Defaults to "in_store" when we can't infer — explicit channel assignment can
 * come later when we add a per-tenant mapping table.
 */
export function deriveSalesChannel(
  orderType: unknown,
  paymentType?: unknown
): SalesChannel {
  const o = String(orderType ?? "").toLowerCase();
  if (o.includes("delivery") || o.includes("uber") || o.includes("rappi"))
    return "delivery";
  if (o.includes("online") || o.includes("web") || o.includes("app"))
    return "online";
  if (
    o.includes("to go") ||
    o.includes("togo") ||
    o.includes("takeaway") ||
    o.includes("take-away") ||
    o.includes("pickup") ||
    o.includes("take out")
  )
    return "takeaway";
  if (o.includes("eat in") || o.includes("dine") || o.includes("eat-in"))
    return "in_store";

  // Fall back to payment hints (Revel sometimes leaves Order_Type blank).
  const p = String(paymentType ?? "").toLowerCase();
  if (p.includes("delivery")) return "delivery";
  if (p.includes("online")) return "online";

  return "in_store";
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

export interface NormalizeContext {
  company_id: string;
  source_type: SourceType;
  currency: string;
  /** Map of normalized location name → location_id, for soft-matching Establishment / POS_Station. */
  locationIndex: Map<string, string>;
  /** Map of normalized menu item name → menu_item_id, for soft-matching Product_Name. */
  menuItemIndex: Map<string, string>;
  /** Resolved logical → actual header mapping from validateRevelPOSColumns. */
  columns: Record<string, string>;
}

/**
 * Normalizes a Revel item-level row into a pos_sales_items insert.
 * Returns either an insert object or a validation error describing why
 * the row was rejected. Never throws — rejection is data, not an exception.
 */
export function normalizeRevelPOSRow(
  row: Record<string, unknown>,
  rowIndex: number,
  ctx: NormalizeContext
):
  | { ok: true; insert: PosSalesItemInsert }
  | { ok: false; error: RowValidationError } {
  const c = ctx.columns;

  const orderNumberRaw = row[c.order_number];
  const orderNumber =
    orderNumberRaw !== undefined &&
    orderNumberRaw !== null &&
    orderNumberRaw !== ""
      ? String(orderNumberRaw)
      : null;

  if (!orderNumber) {
    return { ok: false, error: { rowIndex, reason: "Missing Order_Number" } };
  }

  const saleDate = parseDate(row[c.order_date]);
  if (!saleDate) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Invalid or missing Order_Date",
        rawOrderNumber: orderNumber,
      },
    };
  }

  const productNameRaw = row[c.product_name];
  const productName =
    productNameRaw !== undefined && productNameRaw !== null
      ? String(productNameRaw).trim()
      : "";
  if (!productName) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Missing Product_Name",
        rawOrderNumber: orderNumber,
      },
    };
  }

  const quantity = parseNumber(row[c.product_quantity]);
  if (quantity === null) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Invalid Product_Quantity",
        rawOrderNumber: orderNumber,
      },
    };
  }

  // Revenue: prefer Gross_Item_Total when present, else Total_Sales.
  const grossRevenue = c.gross_item
    ? (parseNumber(row[c.gross_item]) ?? 0)
    : (parseNumber(row[c.total_sales]) ?? 0);
  const netRevenue = c.total_sales
    ? (parseNumber(row[c.total_sales]) ?? grossRevenue)
    : grossRevenue;

  const discountAmount = c.discount ? (parseNumber(row[c.discount]) ?? 0) : 0;
  const taxAmount = c.tax ? parseNumber(row[c.tax]) : null;

  const salesChannel = deriveSalesChannel(
    c.order_type ? row[c.order_type] : undefined,
    c.payment_type ? row[c.payment_type] : undefined
  );

  // Soft matching against existing Supabase rows. Misses are intentionally
  // left null and recorded — we never invent IDs.
  const locationKey =
    (c.establishment && row[c.establishment]
      ? normalizeHeader(String(row[c.establishment]))
      : "") ||
    (c.pos_station && row[c.pos_station]
      ? normalizeHeader(String(row[c.pos_station]))
      : "");
  const locationId = locationKey
    ? (ctx.locationIndex.get(locationKey) ?? null)
    : null;

  const menuItemId =
    ctx.menuItemIndex.get(normalizeHeader(productName)) ?? null;

  // New optional text fields. The schema columns were added by migration
  // 002_add_pos_sales_filter_fields.sql; for files that don't carry these
  // headers (or rows where the cell is blank) we explicitly insert null so
  // existing/historic data stays distinguishable from "" in queries.
  const paymentType = optionalText(c.payment_type, row);
  const category = optionalText(c.category, row);
  const subCategory = optionalText(c.sub_category, row);

  return {
    ok: true,
    insert: {
      company_id: ctx.company_id,
      location_id: locationId,
      menu_item_id: menuItemId,
      sale_date: saleDate,
      order_id: orderNumber,
      check_id: orderNumber, // Revel item-level exports don't carry a separate check id
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

/**
 * Returns the trimmed string value of `row[columnName]`, or null when the
 * column was not resolved or the cell is blank. Used for non-required text
 * fields whose absence is normal (payment_type, category, sub_category).
 */
function optionalText(
  columnName: string | undefined,
  row: Record<string, unknown>
): string | null {
  if (!columnName) return null;
  const raw = row[columnName];
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Lookup-index builders
// ---------------------------------------------------------------------------

/**
 * Build a normalized-name → id map from Supabase rows. Used for soft matching
 * Product_Name → menu_items.id and Establishment → restaurant_locations.id.
 */
export function buildNameIndex<T extends { id: string; name: string }>(
  rows: T[]
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r?.name) m.set(normalizeHeader(r.name), r.id);
  }
  return m;
}

// Exposed for tests / inspection only — internal callers use normalizeHeader directly.
export const __internal = { normalizeHeader };
