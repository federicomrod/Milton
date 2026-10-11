import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import { evaluateWorkbookRow, isSkippableWorkbookRow } from "./parse";
import { evaluateRecipeLine, isTitleRow } from "./recipes";
import { recipeNameFromSheet } from "./names";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { ColumnMapping, CostTabType } from "./types";

const QTY_PLAUSIBILITY_MARGIN = 0.15;

export const SANITY_PASS_RATIO = 0.5;

export const RECIPE_ROLE_FIELDS = [
  "recipe_name",
  "ingredient_name",
  "quantity",
  "unit",
] as const;

export const OPTIONAL_RECIPE_FIELDS = [
  "output_quantity",
  "output_unit",
] as const;

/** Recipe / sub-recipe roles must be distinct columns. A shared
 *  Articulo for recipe_name and ingredient_name parses rows but
 *  makes every line its own one-line recipe. */
export function recipeMappingHasDistinctRoles(mapping: ColumnMapping): boolean {
  const cols = RECIPE_ROLE_FIELDS.map((field) => mapping[field]?.column).filter(
    (column): column is string => Boolean(column)
  );
  return new Set(cols).size === cols.length;
}

function numericColumnValues(
  dataRows: Record<string, unknown>[],
  column: string
): number[] {
  const values: number[] = [];
  for (const row of dataRows) {
    const parsed = parseCostImportNumber(row[column]);
    if (parsed !== null) values.push(parsed);
  }
  return values;
}

export function quantityLikeness(values: number[]): number {
  if (values.length === 0) return 0;
  const integers =
    values.filter((value) => Math.abs(value - Math.round(value)) < 1e-9)
      .length / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const inRecipeRange =
    mid >= 0.1 && mid <= 500 ? 1 : mid > 0 && mid < 0.1 ? 0.2 : 0.35;
  const smallDecimals =
    values.filter(
      (value) =>
        value > 0 && value < 5 && Math.abs(value - Math.round(value)) >= 1e-9
    ).length / values.length;
  return Math.max(
    0,
    integers * 0.55 + inRecipeRange * 0.45 - smallDecimals * 0.5
  );
}

/** False when the mapped quantity column looks like cost and another
 *  numeric column looks like recipe quantities. */
export function recipeQuantityColumnIsPlausible(
  dataRows: Record<string, unknown>[],
  mapping: ColumnMapping
): boolean {
  const qtyCol = mapping.quantity?.column;
  if (!qtyCol) return true;
  const used = new Set(
    ["recipe_name", "ingredient_name", "unit", "quantity"]
      .map((field) => mapping[field]?.column)
      .filter((column): column is string => Boolean(column))
  );
  const qtyScore = quantityLikeness(numericColumnValues(dataRows, qtyCol));
  const columns = new Set<string>();
  for (const row of dataRows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  for (const column of columns) {
    if (used.has(column)) continue;
    const values = numericColumnValues(dataRows, column);
    if (values.length < 2) continue;
    const rival = quantityLikeness(values);
    if (rival - qtyScore >= QTY_PLAUSIBILITY_MARGIN) return false;
    if (
      Math.abs(rival - qtyScore) < QTY_PLAUSIBILITY_MARGIN &&
      rival >= 0.35 &&
      qtyScore >= 0.35
    ) {
      return false;
    }
  }
  return true;
}

export function dropCollidingOptionalRecipeFields(
  mapping: ColumnMapping
): ColumnMapping {
  const used = new Set(
    RECIPE_ROLE_FIELDS.map((field) => mapping[field]?.column).filter(
      (column): column is string => Boolean(column)
    )
  );
  const next: ColumnMapping = { ...mapping };
  for (const field of OPTIONAL_RECIPE_FIELDS) {
    const column = next[field]?.column;
    if (column && used.has(column)) delete next[field];
  }
  return next;
}

export function mappingSanityScore(input: {
  tabType: CostTabType;
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}): number {
  if (input.tabType === "ignore") return 0;
  if (input.tabType === "recipe" || input.tabType === "sub_recipe") {
    if (!recipeMappingHasDistinctRoles(input.mapping)) return 0;
    if (!recipeQuantityColumnIsPlausible(input.dataRows, input.mapping)) {
      return 0;
    }
    const evaluated: boolean[] = [];
    for (const [rowIndex, row] of input.dataRows.entries()) {
      if (isSkippableWorkbookRow(input.tabType, row, input.mapping)) continue;
      if (isTitleRow(row, input.mapping)) continue;
      const result = evaluateRecipeLine({
        tabName: "sanity",
        rowIndex,
        recipeName: recipeNameFromSheet("sanity"),
        row,
        mapping: input.mapping,
      });
      evaluated.push(result.ok);
    }
    if (evaluated.length === 0) return 0;
    return evaluated.filter(Boolean).length / evaluated.length;
  }

  const evaluated: Array<{ ok: boolean; unit?: string }> = [];
  for (const [rowIndex, row] of input.dataRows.entries()) {
    if (isSkippableWorkbookRow(input.tabType, row, input.mapping)) continue;
    const result = evaluateWorkbookRow({
      tabType: input.tabType,
      tabName: "sanity",
      rowIndex,
      row,
      mapping: input.mapping,
      currency: input.currency,
      defaultDate: input.defaultDate,
    });
    evaluated.push({
      ok: result.ok,
      unit: result.ok ? result.value.unit : undefined,
    });
  }
  if (evaluated.length === 0) return 0;
  const rowRatio = evaluated.filter((row) => row.ok).length / evaluated.length;

  if (input.tabType !== "price_list") {
    const unitCol = input.mapping.unit?.column;
    if (unitCol) {
      const units = evaluated
        .map((row) => row.unit)
        .filter((unit): unit is string => Boolean(unit));
      if (units.length === 0) return 0;
      const plausible = units.filter((unit) => Boolean(normalizeUnit(unit)));
      return Math.min(rowRatio, plausible.length / units.length);
    }
  }
  return rowRatio;
}

export function mappingPassesSanity(input: {
  tabType: CostTabType;
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}): boolean {
  return mappingSanityScore(input) > SANITY_PASS_RATIO;
}
