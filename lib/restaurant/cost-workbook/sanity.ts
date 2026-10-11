import { evaluateWorkbookRow, isSkippableWorkbookRow } from "./parse";
import { mappingHasOverlappingRoles } from "./mapping";
import { evaluateRecipeLine, isTitleRow } from "./recipes";
import { recipeNameFromSheet } from "./names";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { ColumnMapping, CostTabType } from "./types";

export const SANITY_PASS_RATIO = 0.5;

export function mappingSanityScore(input: {
  tabType: CostTabType;
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}): number {
  if (input.tabType === "ignore") return 0;
  if (mappingHasOverlappingRoles(input.mapping)) return 0;
  if (input.tabType === "recipe" || input.tabType === "sub_recipe") {
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
