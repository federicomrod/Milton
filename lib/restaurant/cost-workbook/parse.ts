// Plain-code parsing + validation. AI never invents these numbers.

import { parseCostImportDate } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  currencyMismatchReason,
  normalizeCurrency,
} from "@/lib/restaurant/currency";
import { convertUnitPriceStr, resolveUnitCell } from "@/lib/restaurant/units";
import { numberAt, textAt } from "./cells";
import {
  missingIngredientNameReason,
  missingUnitReason,
  positiveQuantityReason,
} from "./copy";
import { resolveIngredientPriceDate } from "@/lib/restaurant/price-date";
import { implausiblePriceReason } from "./plausibility";
import { skipReasonForWorkbookRow } from "./skip";
import type {
  ColumnMapping,
  CostTabType,
  ReviewCandidate,
  WorkbookRowCandidate,
} from "./types";

const MATH_ABS_TOL = 0.05;
const MATH_REL_TOL = 0.02;

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

export function isSkippableWorkbookRow(
  tabType: CostTabType,
  row: Record<string, unknown>,
  mapping: ColumnMapping
): boolean {
  return skipReasonForWorkbookRow(tabType, row, mapping) !== null;
}

function currencyReviewReason(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  companyCurrency: string
): string | null {
  const raw = textAt(row, mapping, "currency");
  if (!raw) return null;
  const normalized = normalizeCurrency(raw);
  if (!normalized) {
    return currencyMismatchReason(raw.trim().toUpperCase(), companyCurrency);
  }
  return currencyMismatchReason(normalized, companyCurrency);
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
  /** True when defaultDate came from a dated price list (file/sheet date). */
  datedPriceList?: boolean;
  uploadDate?: string;
  lang?: PreferredLanguage;
}):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
  const { tabType, tabName, rowIndex, row, mapping, currency, defaultDate } =
    input;
  const lang = input.lang ?? "en";

  const currencyReason = currencyReviewReason(row, mapping, currency);
  if (currencyReason) {
    const name = textAt(row, mapping, "ingredient_name");
    return {
      ok: false,
      review: {
        tabName,
        rowIndex,
        reason: currencyReason,
        raw: row,
        suggested: name ? { ingredient_name: name } : null,
      },
    };
  }

  const uploadDate = input.uploadDate ?? defaultDate;
  if (tabType === "price_list") {
    return evaluatePriceListRow(
      tabName,
      rowIndex,
      row,
      mapping,
      currency,
      defaultDate,
      lang,
      Boolean(input.datedPriceList),
      uploadDate
    );
  }
  return evaluateQuantityCostRow(
    tabName,
    rowIndex,
    row,
    mapping,
    currency,
    defaultDate,
    tabType === "purchases",
    lang,
    uploadDate
  );
}

function evaluatePriceListRow(
  tabName: string,
  rowIndex: number,
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  currency: string,
  defaultDate: string,
  lang: PreferredLanguage,
  datedPriceList: boolean,
  uploadDate: string
):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
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

  if (!name) return fail(missingIngredientNameReason(lang));

  const unitRaw = textAt(row, mapping, "unit");
  if (unitRaw) {
    const resolvedUnit = resolveUnitCell(unitRaw, lang);
    if (!resolvedUnit.ok) return fail(resolvedUnit.reason);
  }

  const resolved = resolvePriceListPrice({
    priceLb: numberAt(row, mapping, "price_per_lb"),
    priceOz: numberAt(row, mapping, "price_per_oz"),
    priceUnit: numberAt(row, mapping, "price_per_unit"),
  });
  if (!resolved.ok) return fail(resolved.reason);

  const implausible = implausiblePriceReason(
    name,
    resolved.unit,
    resolved.unitPrice
  );
  if (implausible) return fail(implausible);

  const priced = resolveIngredientPriceDate({
    priceListDate: datedPriceList ? defaultDate : null,
    uploadDate,
    kind: "price_list",
  });
  return {
    ok: true,
    value: {
      ...baseCandidate(tabName, rowIndex, row, currency, priced.effective_date),
      ingredient_name: name,
      quantity: 1,
      unit: resolved.unit,
      unit_price: resolved.unitPrice,
      total_cost: resolved.unitPrice,
      effective_date: priced.effective_date,
      date_source: priced.date_source,
    },
  };
}

/**
 * On LIBRA / ONZA price-list tabs the unit is the column the price
 * actually sits in. Never guess lb vs oz. PRECIO UNITARIO is per-each
 * only when neither mass column has a price.
 */
export function resolvePriceListPrice(input: {
  priceLb: number | null;
  priceOz: number | null;
  priceUnit: number | null;
}):
  | { ok: true; unit: "lb" | "oz" | "unit"; unitPrice: number }
  | { ok: false; reason: string } {
  const priceLb = input.priceLb;
  const priceOz = input.priceOz;
  const priceUnit = input.priceUnit;
  const hasLb = priceLb !== null && priceLb > 0;
  const hasOz = priceOz !== null && priceOz > 0;
  const hasEach = priceUnit !== null && priceUnit > 0;

  if (hasLb && hasOz && priceLb !== null && priceOz !== null) {
    if (!pricesConvert(priceLb, "lb", priceOz, "oz")) {
      return {
        ok: false,
        reason:
          "quantity x price doesn't match total (lb/oz prices don't convert)",
      };
    }
    return { ok: true, unit: "lb", unitPrice: priceLb };
  }
  if (hasLb && priceLb !== null) {
    return { ok: true, unit: "lb", unitPrice: priceLb };
  }
  if (hasOz && priceOz !== null) {
    return { ok: true, unit: "oz", unitPrice: priceOz };
  }
  if (hasEach && priceUnit !== null) {
    return { ok: true, unit: "unit", unitPrice: priceUnit };
  }
  return { ok: false, reason: "Missing unit price" };
}

function evaluateQuantityCostRow(
  tabName: string,
  rowIndex: number,
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  currency: string,
  defaultDate: string,
  requireQuantity: boolean,
  lang: PreferredLanguage,
  uploadDate: string
):
  | { ok: true; value: WorkbookRowCandidate }
  | { ok: false; review: ReviewCandidate } {
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

  if (!name) return fail(missingIngredientNameReason(lang));

  const unitRaw = textAt(row, mapping, "unit");
  if (!unitRaw) return fail(missingUnitReason(lang), { ingredient_name: name });
  const resolvedUnit = resolveUnitCell(unitRaw, lang);
  if (!resolvedUnit.ok) {
    return fail(resolvedUnit.reason, {
      ingredient_name: name,
      unit: unitRaw,
    });
  }

  const qty = numberAt(row, mapping, "quantity");
  const unitPrice = numberAt(row, mapping, "unit_price");
  const total = numberAt(row, mapping, "total_cost");
  const dateRaw = textAt(row, mapping, "cost_date");
  const parsedRowDate = dateRaw ? parseCostImportDate(dateRaw) : null;
  const priced = resolveIngredientPriceDate({
    recordDate: parsedRowDate,
    uploadDate,
    kind: requireQuantity ? "invoice" : "workbook",
  });
  const costDate = priced.effective_date;
  const supplier = textAt(row, mapping, "supplier_name");

  if (requireQuantity && (qty === null || qty <= 0)) {
    return fail(positiveQuantityReason(lang), {
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

  const rawQuantity = qty !== null && qty > 0 ? qty : 1;
  let resolvedTotal: number | null = total;
  let resolvedPrice: number | null = unitPrice;
  if (resolvedTotal === null && resolvedPrice !== null) {
    resolvedTotal = resolvedPrice * rawQuantity;
  }
  if (resolvedPrice === null && resolvedTotal !== null && rawQuantity > 0) {
    resolvedPrice = resolvedTotal / rawQuantity;
  }
  const quantity = rawQuantity * resolvedUnit.quantityMultiplier;
  const storedUnit =
    resolvedUnit.quantityMultiplier !== 1 ? resolvedUnit.unit : unitRaw;
  if (
    resolvedUnit.quantityMultiplier !== 1 &&
    resolvedTotal !== null &&
    quantity > 0
  ) {
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

  const implausible = implausiblePriceReason(name, storedUnit, resolvedPrice);
  if (implausible) {
    return fail(implausible, {
      ingredient_name: name,
      unit: storedUnit,
      unit_price: resolvedPrice,
      total_cost: resolvedTotal,
      quantity,
    });
  }

  return {
    ok: true,
    value: {
      ...baseCandidate(tabName, rowIndex, row, currency, defaultDate),
      ingredient_name: name,
      quantity,
      unit: storedUnit,
      unit_price: resolvedPrice,
      total_cost: resolvedTotal,
      cost_date: costDate,
      effective_date: priced.effective_date,
      date_source: priced.date_source,
      supplier_name: supplier,
    },
  };
}
