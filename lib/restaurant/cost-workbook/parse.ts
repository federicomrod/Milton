// Plain-code parsing + validation. AI never invents these numbers.

import {
  parseCostImportDate,
  parseCostImportNumber,
} from "@/lib/restaurant/cost-import";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";
import type {
  ColumnMapping,
  CostTabType,
  ReviewCandidate,
  WorkbookRowCandidate,
} from "./types";
import { HIGH_COLUMN_CONFIDENCE } from "./types";

const MATH_ABS_TOL = 0.05;
const MATH_REL_TOL = 0.02;

function textAt(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: string
): string | null {
  const col = mapping[field]?.column;
  if (!col) return null;
  const raw = row[col];
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

function numberAt(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: string
): number | null {
  const col = mapping[field]?.column;
  if (!col) return null;
  return parseCostImportNumber(row[col]);
}

export function totalsMatch(
  quantity: number,
  unitPrice: number,
  total: number
): boolean {
  const expected = quantity * unitPrice;
  const abs = Math.abs(expected - total);
  if (abs <= MATH_ABS_TOL) return true;
  const denom = Math.max(Math.abs(total), Math.abs(expected), 1e-9);
  return abs / denom <= MATH_REL_TOL;
}

export function pricesConvert(
  fromPrice: number,
  fromUnit: string,
  toPrice: number,
  toUnit: string
): boolean {
  const converted = convertUnitPriceStr(fromPrice, fromUnit, toUnit);
  if (!converted.ok) return false;
  return totalsMatch(1, converted.value, toPrice);
}

function mappingConfidence(mapping: ColumnMapping, field: string): number {
  return mapping[field]?.confidence ?? 0;
}

function columnUnsure(mapping: ColumnMapping, fields: string[]): string | null {
  for (const field of fields) {
    const binding = mapping[field];
    if (!binding?.column) continue;
    if (binding.confidence < HIGH_COLUMN_CONFIDENCE) {
      return `column unsure (${field} ← ${binding.column})`;
    }
  }
  return null;
}

function baseCandidate(
  tabName: string,
  rowIndex: number,
  row: Record<string, unknown>,
  currency: string,
  defaultDate: string
): Omit<
  WorkbookRowCandidate,
  "ingredient_name" | "quantity" | "unit" | "total_cost" | "unit_price"
> {
  return {
    tabName,
    rowIndex,
    cost_date: defaultDate,
    supplier_name: null,
    currency,
    notes: null,
    raw: row,
  };
}

export function evaluateWorkbookRow(input: {
  tabType: CostTabType;
  tabName: string;
  rowIndex: number;
  row: Record<string, unknown>;
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
  const { tabType, tabName, rowIndex, row, mapping, currency, defaultDate } =
    input;

  if (tabType === "price_list") {
    return evaluatePriceListRow(
      tabName,
      rowIndex,
      row,
      mapping,
      currency,
      defaultDate
    );
  }
  return evaluateQuantityCostRow(
    tabName,
    rowIndex,
    row,
    mapping,
    currency,
    defaultDate,
    tabType === "purchases"
  );
}

function evaluatePriceListRow(
  tabName: string,
  rowIndex: number,
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  currency: string,
  defaultDate: string
):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
  const unsure = columnUnsure(mapping, [
    "ingredient_name",
    "price_per_lb",
    "price_per_oz",
    "price_per_unit",
  ]);
  const name = textAt(row, mapping, "ingredient_name");
  const fail = (reason: string): { ok: false; review: ReviewCandidate } => ({
    ok: false,
    review: {
      tabName,
      rowIndex,
      reason,
      raw: row,
      suggested: name
        ? {
            ...baseCandidate(tabName, rowIndex, row, currency, defaultDate),
            ingredient_name: name,
          }
        : null,
    },
  });

  if (!name) return fail("Missing ingredient name");
  if (unsure) return fail(unsure);
  if (mappingConfidence(mapping, "ingredient_name") < HIGH_COLUMN_CONFIDENCE) {
    return fail("column unsure (ingredient name)");
  }

  const priceLb = numberAt(row, mapping, "price_per_lb");
  const priceOz = numberAt(row, mapping, "price_per_oz");
  const priceUnit = numberAt(row, mapping, "price_per_unit");

  if (
    priceLb !== null &&
    priceOz !== null &&
    priceLb > 0 &&
    priceOz > 0 &&
    !pricesConvert(priceLb, "lb", priceOz, "oz")
  ) {
    return fail(
      "quantity x price doesn't match total (lb/oz prices don't convert)"
    );
  }

  let unit = "";
  let unitPrice = 0;
  if (priceLb !== null && priceLb > 0) {
    unit = "lb";
    unitPrice = priceLb;
  } else if (priceOz !== null && priceOz > 0) {
    unit = "oz";
    unitPrice = priceOz;
  } else if (priceUnit !== null && priceUnit > 0) {
    unit = "unit";
    unitPrice = priceUnit;
  } else {
    return fail("Missing unit price");
  }

  return {
    ok: true,
    value: {
      ...baseCandidate(tabName, rowIndex, row, currency, defaultDate),
      ingredient_name: name,
      quantity: 1,
      unit,
      unit_price: unitPrice,
      total_cost: unitPrice,
    },
  };
}

function evaluateQuantityCostRow(
  tabName: string,
  rowIndex: number,
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  currency: string,
  defaultDate: string,
  requireQuantity: boolean
):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
  const unsure = columnUnsure(mapping, [
    "ingredient_name",
    "unit",
    "unit_price",
    "quantity",
    "total_cost",
  ]);
  const name = textAt(row, mapping, "ingredient_name");
  const fail = (
    reason: string,
    suggested?: Partial<WorkbookRowCandidate>
  ): { ok: false; review: ReviewCandidate } => ({
    ok: false,
    review: {
      tabName,
      rowIndex,
      reason,
      raw: row,
      suggested: suggested ?? (name ? { ingredient_name: name } : null),
    },
  });

  if (!name) return fail("Missing ingredient name");
  if (unsure) return fail(unsure);

  const unitRaw = textAt(row, mapping, "unit");
  if (!unitRaw) return fail("Missing unit", { ingredient_name: name });
  if (!normalizeUnit(unitRaw)) {
    return fail(`unknown unit (${unitRaw})`, {
      ingredient_name: name,
      unit: unitRaw,
    });
  }

  const qty = numberAt(row, mapping, "quantity");
  const unitPrice = numberAt(row, mapping, "unit_price");
  const total = numberAt(row, mapping, "total_cost");
  const dateRaw = textAt(row, mapping, "cost_date");
  const costDate = dateRaw
    ? (parseCostImportDate(dateRaw) ?? defaultDate)
    : defaultDate;
  const supplier = textAt(row, mapping, "supplier_name");

  if (requireQuantity && (qty === null || qty <= 0)) {
    return fail("Quantity must be a positive number", {
      ingredient_name: name,
    });
  }

  if (
    qty !== null &&
    qty > 0 &&
    unitPrice !== null &&
    unitPrice >= 0 &&
    total !== null &&
    total >= 0 &&
    !totalsMatch(qty, unitPrice, total)
  ) {
    return fail("quantity x price doesn't match total", {
      ingredient_name: name,
      quantity: qty,
      unit: unitRaw,
      unit_price: unitPrice,
      total_cost: total,
    });
  }

  const quantity = qty !== null && qty > 0 ? qty : 1;
  let resolvedTotal: number | null = total;
  let resolvedPrice: number | null = unitPrice;
  if (resolvedTotal === null && resolvedPrice !== null) {
    resolvedTotal = resolvedPrice * quantity;
  }
  if (resolvedPrice === null && resolvedTotal !== null && quantity > 0) {
    resolvedPrice = resolvedTotal / quantity;
  }
  if (
    resolvedTotal === null ||
    resolvedTotal < 0 ||
    resolvedPrice === null ||
    resolvedPrice < 0
  ) {
    return fail("Missing cost", { ingredient_name: name, unit: unitRaw });
  }

  return {
    ok: true,
    value: {
      ...baseCandidate(tabName, rowIndex, row, currency, defaultDate),
      ingredient_name: name,
      quantity,
      unit: unitRaw,
      unit_price: resolvedPrice,
      total_cost: resolvedTotal,
      cost_date: costDate,
      supplier_name: supplier,
    },
  };
}
