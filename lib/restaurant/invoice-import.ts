// lib/restaurant/invoice-import.ts
//
// Deterministic parsing + normalization for supplier-invoice CSV/XLSX
// uploads. No Supabase, no AI, no OCR — the API route owns I/O and hands
// raw header/row objects here for shape validation and numeric/date
// coercion. The route is responsible for supplier-autocreate, ingredient
// matching, and writing rows into supplier_invoices / supplier_invoice_lines.
//
// Cost entries (ingredient_cost_entries) are NOT written by the upload
// route. They are only written by the /invoices/:id/approve route after a
// human reviews and approves the lines.
//
// Header resolution mirrors lib/restaurant/cost-import.ts so users who
// already use the bulk-cost importer's column names can reuse them here.

import { parseNumber, parseDate } from "@/lib/restaurant/pos-import";

// ---------------------------------------------------------------------------
// Header → logical column mapping
// ---------------------------------------------------------------------------

const COLUMN_CANDIDATES: Record<string, string[]> = {
  supplier_name: ["supplier_name", "supplier", "vendor", "supplier name"],
  invoice_number: [
    "invoice_number",
    "invoice number",
    "invoice no",
    "invoice",
    "folio",
  ],
  invoice_date: ["invoice_date", "invoice date", "date"],
  due_date: ["due_date", "due date", "payment_due"],
  description: [
    "description",
    "item",
    "concept",
    "concepto",
    "product_name",
    "product",
  ],
  supplier_item_name: ["supplier_item_name", "supplier item name", "item_name"],
  supplier_sku: ["supplier_sku", "supplier sku", "sku", "code"],
  ingredient_name: ["ingredient_name", "ingredient", "ingredient name"],
  quantity: ["quantity", "qty"],
  unit: ["unit", "uom"],
  unit_cost: ["unit_cost", "unit price", "unit_price", "price"],
  line_total: ["line_total", "line total", "total", "amount", "subtotal"],
  tax_amount: ["tax_amount", "tax", "iva"],
  currency: ["currency"],
  notes: ["notes", "note"],
};

const REQUIRED_LOGICAL_COLUMNS: ReadonlyArray<keyof typeof COLUMN_CANDIDATES> =
  [
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "description",
    "quantity",
    "unit",
    "line_total",
  ];

export interface InvoiceImportColumnResult {
  ok: boolean;
  missingRequired: string[];
  /** logical name → actual header in the file */
  resolved: Record<string, string>;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, "");
}

export function validateInvoiceImportColumns(
  headers: string[]
): InvoiceImportColumnResult {
  const normalized = new Map<string, string>();
  for (const h of headers) normalized.set(normalizeHeader(h), h);

  const resolved: Record<string, string> = {};
  for (const [logical, candidates] of Object.entries(COLUMN_CANDIDATES)) {
    for (const candidate of candidates) {
      const actual = normalized.get(normalizeHeader(candidate));
      if (actual) {
        resolved[logical] = actual;
        break;
      }
    }
  }
  const missingRequired = REQUIRED_LOGICAL_COLUMNS.filter(
    (k) => !resolved[k]
  ) as string[];
  return { ok: missingRequired.length === 0, missingRequired, resolved };
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

export interface NormalizedInvoiceRow {
  rowIndex: number;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  description: string;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  ingredient_name: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  line_total: number;
  tax_amount: number | null;
  currency: string;
  notes: string | null;
}

export interface InvoiceRowError {
  rowIndex: number;
  reason: string;
  /** Best-effort identifier so the user can find the offending line. */
  description?: string;
}

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

export function normalizeInvoiceImportRow(
  row: Record<string, unknown>,
  rowIndex: number,
  resolved: Record<string, string>,
  defaultCurrency: string
):
  | { ok: true; value: NormalizedInvoiceRow }
  | { ok: false; error: InvoiceRowError } {
  const supplierName = optionalText(resolved.supplier_name, row);
  if (!supplierName) {
    return { ok: false, error: { rowIndex, reason: "Missing supplier_name" } };
  }

  const invoiceNumber = optionalText(resolved.invoice_number, row);
  if (!invoiceNumber) {
    return {
      ok: false,
      error: { rowIndex, reason: "Missing invoice_number" },
    };
  }

  const invoiceDate = parseDate(row[resolved.invoice_date]);
  if (!invoiceDate) {
    return {
      ok: false,
      error: { rowIndex, reason: "Invalid or missing invoice_date" },
    };
  }
  const dueDate = resolved.due_date ? parseDate(row[resolved.due_date]) : null;

  const description = optionalText(resolved.description, row);
  if (!description) {
    return {
      ok: false,
      error: { rowIndex, reason: "Missing description" },
    };
  }

  const quantity = parseNumber(row[resolved.quantity]);
  if (quantity === null || quantity <= 0) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Quantity must be a positive number",
        description,
      },
    };
  }

  const unit = optionalText(resolved.unit, row);
  if (!unit) {
    return {
      ok: false,
      error: { rowIndex, reason: "Missing unit", description },
    };
  }

  const lineTotal = parseNumber(row[resolved.line_total]);
  if (lineTotal === null || lineTotal < 0) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "line_total must be a non-negative number",
        description,
      },
    };
  }

  const unitCostRaw = resolved.unit_cost
    ? parseNumber(row[resolved.unit_cost])
    : null;
  const unitCost =
    unitCostRaw !== null && unitCostRaw >= 0
      ? unitCostRaw
      : lineTotal > 0 && quantity > 0
        ? lineTotal / quantity
        : null;

  const taxAmount = resolved.tax_amount
    ? parseNumber(row[resolved.tax_amount])
    : null;

  const currencyRaw = optionalText(resolved.currency, row);
  const currency =
    currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw)
      ? currencyRaw.toUpperCase()
      : defaultCurrency;

  return {
    ok: true,
    value: {
      rowIndex,
      supplier_name: supplierName,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      description,
      supplier_item_name: optionalText(resolved.supplier_item_name, row),
      supplier_sku: optionalText(resolved.supplier_sku, row),
      ingredient_name: optionalText(resolved.ingredient_name, row),
      quantity,
      unit,
      unit_cost: unitCost,
      line_total: lineTotal,
      tax_amount: taxAmount && taxAmount >= 0 ? taxAmount : null,
      currency,
      notes: optionalText(resolved.notes, row),
    },
  };
}

/** Normalized lookup key for case-insensitive name matching. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Ingredient match scaffolding
// ---------------------------------------------------------------------------

export interface IngredientMatchInput {
  ingredient_name: string | null;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  supplier_id: string | null;
}

export interface IngredientCatalogEntry {
  id: string;
  name: string;
  default_unit: string | null;
}

export interface SupplierIngredientLink {
  supplier_id: string;
  ingredient_id: string;
  supplier_item_name: string | null;
  supplier_sku: string | null;
}

/**
 * Decide which ingredient_id (if any) an invoice line should be matched to.
 * Tries, in order:
 *   1. exact match on the supplier_ingredients link by sku (within the
 *      same supplier)
 *   2. exact match on the supplier_ingredients link by supplier_item_name
 *      (case-insensitive, within the same supplier)
 *   3. exact match on the ingredient name across the company catalog
 *      (case-insensitive)
 *
 * Returns null when none of the above resolves. The caller decides what
 * to do (leave unmatched for human review). We do NOT fuzzy-match — false
 * positives here become bad cost entries downstream.
 */
export function matchIngredientForLine(
  input: IngredientMatchInput,
  catalog: IngredientCatalogEntry[],
  links: SupplierIngredientLink[]
): {
  ingredient_id: string;
  via: "sku" | "supplier_item_name" | "ingredient_name";
} | null {
  // (1) supplier link by SKU
  if (input.supplier_id && input.supplier_sku) {
    const skuKey = nameKey(input.supplier_sku);
    const hit = links.find(
      (l) =>
        l.supplier_id === input.supplier_id &&
        l.supplier_sku !== null &&
        nameKey(l.supplier_sku) === skuKey
    );
    if (hit) return { ingredient_id: hit.ingredient_id, via: "sku" };
  }

  // (2) supplier link by supplier_item_name
  if (input.supplier_id && input.supplier_item_name) {
    const itemKey = nameKey(input.supplier_item_name);
    const hit = links.find(
      (l) =>
        l.supplier_id === input.supplier_id &&
        l.supplier_item_name !== null &&
        nameKey(l.supplier_item_name) === itemKey
    );
    if (hit)
      return { ingredient_id: hit.ingredient_id, via: "supplier_item_name" };
  }

  // (3) by ingredient_name
  if (input.ingredient_name) {
    const key = nameKey(input.ingredient_name);
    const hit = catalog.find((c) => nameKey(c.name) === key);
    if (hit) return { ingredient_id: hit.id, via: "ingredient_name" };
  }

  return null;
}
