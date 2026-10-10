import { evaluateWorkbookRow, isSkippableWorkbookRow } from "./parse";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { ColumnMapping, CostTabType } from "./types";

const SANITY_PASS_RATIO = 0.5;

export function mappingPassesSanity(input: {
  tabType: CostTabType;
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}): boolean {
  if (input.tabType === "recipe") return true;
  if (input.tabType === "ignore") return false;

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
  if (evaluated.length === 0) return false;
  const passed = evaluated.filter((row) => row.ok).length;
  if (passed / evaluated.length <= SANITY_PASS_RATIO) return false;

  if (input.tabType !== "price_list") {
    const unitCol = input.mapping.unit?.column;
    if (unitCol) {
      const units = evaluated
        .map((row) => row.unit)
        .filter((unit): unit is string => Boolean(unit));
      if (units.length === 0) return false;
      const plausible = units.filter((unit) => Boolean(normalizeUnit(unit)));
      if (plausible.length / units.length <= SANITY_PASS_RATIO) return false;
    }
  }
  return true;
}
