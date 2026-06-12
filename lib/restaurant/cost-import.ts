// lib/restaurant/cost-import.ts
//
// Deterministic parsing + normalization for the bulk ingredient-cost
// importer (CSV / XLSX). No Supabase, no AI — the API route owns I/O and
// hands raw rows here for shape validation and numeric/date coercion.
//
// Scope: ONLY the ingredient-cost observation file described in the
// milestone. Supplier/ingredient resolution and the cost normalization
// that needs the ingredient's default_unit live partly here
// (buildIngredientCostEntryInsert) and partly in the route (DB lookups).

import { parseNumber, parseDate } from "@/lib/restaurant/pos-import";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

/**
 * Logical field → candidate header strings. Matching is done after
 * `normalizeHeader` collapses spaces/underscores/dashes and lowercases,
 * so "Cost Date", "cost_date" and "cost-date" all resolve to the same
 * logical column.
 */
const COLUMN_CANDIDATES: Record<string, string[]> = {
  cost_date: ["cost_date", "cost date", "date", "invoice_date", "invoice date"],
  supplier_name: ["supplier_name", "supplier", "vendor", "supplier name"],
  ingredient_name: [
    "ingredient_name",
    "ingredient",
    "item_name",
    "product_name",
    "ingredient name",
    "item name",
    "product name",
  ],
  quantity: ["quantity", "qty"],
  unit: ["unit", "uom"],
  total_cost: [
    "total_cost",
    "total cost",
    "amount",
    "line_total",
    "line total",
  ],
  currency: ["currency"],
  notes: ["notes", "note"],
  supplier_item_name: ["supplier_item_name", "supplier item name"],
  supplier_sku: ["supplier_sku", "supplier sku", "sku"],
};

const REQUIRED_LOGICAL_COLUMNS: ReadonlyArray<keyof typeof COLUMN_CANDIDATES> =
  [
    "cost_date",
    "supplier_name",
    "ingredient_name",
    "quantity",
    "unit",
    "total_cost",
  ];

export interface CostImportColumnResult {
  ok: boolean;
  missingRequired: string[];
  /** logical name → actual header in the file */
  resolved: Record<string, string>;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Maps file headers to logical column names. Returns the resolved map
 * plus any required columns that couldn't be matched.
 */
export function validateCostImportColumns(
  headers: string[]
): CostImportColumnResult {
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

/** Thin alias kept for the API surface described in the milestone. */
export function mapCostImportHeaders(
  headers: string[]
): Record<string, string> {
  return validateCostImportColumns(headers).resolved;
}

// ---------------------------------------------------------------------------
// Value parsers — reuse the POS parsers so date/number handling is
// identical across import paths (Excel serials, MX/EU date orders, etc.)
// ---------------------------------------------------------------------------

export function parseCostImportNumber(value: unknown): number | null {
  return parseNumber(value);
}

export function parseCostImportDate(value: unknown): string | null {
  return parseDate(value);
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

export interface NormalizedCostRow {
  rowIndex: number;
  cost_date: string;
  supplier_name: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  total_cost: number;
  currency: string;
  notes: string | null;
  supplier_item_name: string | null;
  supplier_sku: string | null;
}

export interface CostRowError {
  rowIndex: number;
  reason: string;
  /** Best-effort identifier so the user can find the offending line. */
  ingredient_name?: string;
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

/**
 * Validates + coerces a single raw row into a NormalizedCostRow, or
 * returns a CostRowError explaining why it was rejected. Never throws.
 *
 * `defaultCurrency` is applied when the row omits a currency. Currency
 * is upper-cased and only accepted as a 3-letter code; otherwise we fall
 * back to the default rather than reject the whole row.
 */
export function normalizeCostImportRow(
  row: Record<string, unknown>,
  rowIndex: number,
  resolved: Record<string, string>,
  defaultCurrency: string
): { ok: true; value: NormalizedCostRow } | { ok: false; error: CostRowError } {
  const supplierName = optionalText(resolved.supplier_name, row);
  if (!supplierName) {
    return { ok: false, error: { rowIndex, reason: "Missing supplier_name" } };
  }

  const ingredientName = optionalText(resolved.ingredient_name, row);
  if (!ingredientName) {
    return {
      ok: false,
      error: { rowIndex, reason: "Missing ingredient_name" },
    };
  }

  const costDate = parseCostImportDate(row[resolved.cost_date]);
  if (!costDate) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Invalid or missing cost_date",
        ingredient_name: ingredientName,
      },
    };
  }

  const quantity = parseCostImportNumber(row[resolved.quantity]);
  if (quantity === null || quantity <= 0) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Quantity must be a positive number",
        ingredient_name: ingredientName,
      },
    };
  }

  const unit = optionalText(resolved.unit, row);
  if (!unit) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Missing unit",
        ingredient_name: ingredientName,
      },
    };
  }

  const totalCost = parseCostImportNumber(row[resolved.total_cost]);
  if (totalCost === null || totalCost < 0) {
    return {
      ok: false,
      error: {
        rowIndex,
        reason: "Total cost must be a non-negative number",
        ingredient_name: ingredientName,
      },
    };
  }

  const currencyRaw = optionalText(resolved.currency, row);
  const currency =
    currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw)
      ? currencyRaw.toUpperCase()
      : defaultCurrency;

  return {
    ok: true,
    value: {
      rowIndex,
      cost_date: costDate,
      supplier_name: supplierName,
      ingredient_name: ingredientName,
      quantity,
      unit,
      total_cost: totalCost,
      currency,
      notes: optionalText(resolved.notes, row),
      supplier_item_name: optionalText(resolved.supplier_item_name, row),
      supplier_sku: optionalText(resolved.supplier_sku, row),
    },
  };
}

// ---------------------------------------------------------------------------
// Cost-entry insert builder
// ---------------------------------------------------------------------------

export interface IngredientCostEntryInsert {
  company_id: string;
  ingredient_id: string;
  supplier_id: string | null;
  source_type: "import";
  source_id: null;
  cost_date: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_cost: number;
  normalized_unit: string;
  normalized_unit_cost: number;
  currency: string;
  notes: string | null;
}

/**
 * Computes the cost-entry insert for a normalized row, given the resolved
 * ingredient (for its default_unit / canonical projection) and supplier id.
 *
 * Cost math mirrors the manual-entry route:
 *   unit_cost           = total_cost / quantity            (per uploaded unit)
 *   normalized_unit     = ingredient.default_unit (canonical token)
 *   normalized_unit_cost= convertUnitPrice(unit_cost, uploaded → default)
 *
 * When the uploaded unit can't be converted to the ingredient's default
 * unit we DO NOT fabricate a normalized cost — we return a failure so the
 * route can report the row instead of poisoning downstream costing.
 */
export function buildIngredientCostEntryInsert(params: {
  companyId: string;
  ingredientId: string;
  ingredientDefaultUnit: string | null;
  supplierId: string | null;
  row: NormalizedCostRow;
}):
  | { ok: true; insert: IngredientCostEntryInsert }
  | { ok: false; reason: string } {
  const { companyId, ingredientId, ingredientDefaultUnit, supplierId, row } =
    params;

  const unitCost = row.total_cost / row.quantity;
  const targetUnit = ingredientDefaultUnit || row.unit;

  const converted = convertUnitPriceStr(unitCost, row.unit, targetUnit);
  if (!converted.ok) {
    return {
      ok: false,
      reason: `Cannot convert unit "${row.unit}" to default unit "${targetUnit}"`,
    };
  }
  const normalizedUnit = normalizeUnit(targetUnit) ?? targetUnit;

  return {
    ok: true,
    insert: {
      company_id: companyId,
      ingredient_id: ingredientId,
      supplier_id: supplierId,
      source_type: "import",
      source_id: null,
      cost_date: row.cost_date,
      quantity: row.quantity,
      unit: row.unit,
      total_cost: row.total_cost,
      unit_cost: unitCost,
      normalized_unit: normalizedUnit,
      normalized_unit_cost: converted.value,
      currency: row.currency,
      notes: row.notes,
    },
  };
}

/** Normalized lookup key for case-insensitive name matching. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}
