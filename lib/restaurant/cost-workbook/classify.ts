// Content-based tab type checks. AI / header heuristics still propose
// a type; these signals override a bad guess so a dish tab is not a
// sub-recipe and a yearly cost summary is not a recipe.

import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import { resolveUnitCell } from "@/lib/restaurant/units";
import { sheetLooksLikeCostoRestauranteBlocks } from "./blocks";
import { normalizeHeaderToken } from "./header";
import type { TabClassification } from "./types";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nameBlob(sheetName: string): string {
  return normalizeHeaderToken(sheetName);
}

export function isExplicitSubRecipeName(sheetName: string): boolean {
  return /(sub[\s_]*receta|sub[\s_]*recipe|preparacion|preparación|mise[\s_]*en[\s_]*place)/i.test(
    sheetName
  );
}

export function isCostSummaryName(sheetName: string): boolean {
  const folded = nameBlob(sheetName);
  return (
    /costosrestaurante/.test(folded) ||
    /costosdelrestaurante/.test(folded) ||
    /resumendecostos/.test(folded) ||
    /resumencostos/.test(folded) ||
    /costostotales/.test(folded) ||
    /costos20\d{2}/.test(folded)
  );
}

function rowShape(row: Record<string, unknown>): {
  texts: string[];
  numbers: number;
  units: number;
} {
  let numbers = 0;
  let units = 0;
  const texts: string[] = [];
  for (const value of Object.values(row)) {
    const text = cellText(value);
    if (!text) continue;
    if (parseCostImportNumber(value) !== null) {
      numbers += 1;
      continue;
    }
    texts.push(text);
    if (resolveUnitCell(text).ok) units += 1;
  }
  return { texts, numbers, units };
}

/**
 * Dish tabs write the plate name on its own row, then ingredient
 * lines with a quantity and a unit. Prep tabs usually keep a Receta
 * column instead of those block headers.
 */
export function countDishTitleBlocks(rows: Record<string, unknown>[]): number {
  let blocks = 0;
  let pendingTitle = false;
  for (const row of rows) {
    const shape = rowShape(row);
    const nameTexts = shape.texts.length - shape.units;
    const isTitle = nameTexts === 1 && shape.numbers === 0 && shape.units === 0;
    const isIngredient =
      nameTexts >= 1 && shape.numbers >= 1 && shape.units >= 1;
    if (isTitle) {
      pendingTitle = true;
      continue;
    }
    if (isIngredient && pendingTitle) {
      blocks += 1;
      pendingTitle = false;
    }
  }
  return blocks;
}

function recognizedUnitShare(rows: Record<string, unknown>[]): number {
  let nonempty = 0;
  let units = 0;
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const text = cellText(value);
      if (!text) continue;
      if (parseCostImportNumber(value) !== null) continue;
      nonempty += 1;
      if (resolveUnitCell(text).ok) units += 1;
    }
  }
  return nonempty === 0 ? 0 : units / nonempty;
}

function headerLooksLikeCostSummary(headers: string[]): boolean {
  const blob = headers.map((header) => normalizeHeaderToken(header)).join(" ");
  return /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|presupuesto|porcentaje|%|totalkitchen|totalgeneral|costo20\d{2})/.test(
    blob
  );
}

export function looksLikeCostSummaryTab(input: {
  sheetName: string;
  headers: string[];
  dataRows: Record<string, unknown>[];
  aoa?: unknown[][];
}): boolean {
  if (isExplicitSubRecipeName(input.sheetName)) return false;
  if (input.aoa && sheetLooksLikeCostoRestauranteBlocks(input.aoa)) {
    return isCostSummaryName(input.sheetName);
  }
  if (countDishTitleBlocks(input.dataRows) >= 2) return false;
  if (isCostSummaryName(input.sheetName)) return true;
  if (
    headerLooksLikeCostSummary(input.headers) &&
    recognizedUnitShare(input.dataRows) < 0.12
  ) {
    return true;
  }
  return false;
}

export function looksLikeDishRecipeTab(input: {
  sheetName: string;
  headers: string[];
  dataRows: Record<string, unknown>[];
  aoa?: unknown[][];
}): boolean {
  if (isExplicitSubRecipeName(input.sheetName)) return false;
  if (looksLikeCostSummaryTab(input)) return false;
  if (input.aoa && sheetLooksLikeCostoRestauranteBlocks(input.aoa)) return true;
  return countDishTitleBlocks(input.dataRows) >= 2;
}

export function refineTabClassification(input: {
  proposed: TabClassification;
  sheetName: string;
  headers: string[];
  dataRows: Record<string, unknown>[];
  aoa?: unknown[][];
}): TabClassification {
  const { proposed, sheetName, headers, dataRows, aoa } = input;
  if (looksLikeCostSummaryTab({ sheetName, headers, dataRows, aoa })) {
    return {
      type: "ignore",
      confidence: Math.max(proposed.confidence, 0.91),
      notes: "cost summary tab",
    };
  }
  if (isExplicitSubRecipeName(sheetName)) {
    return {
      type: "sub_recipe",
      confidence: Math.max(proposed.confidence, 0.93),
      notes: proposed.notes,
    };
  }
  if (
    looksLikeDishRecipeTab({ sheetName, headers, dataRows, aoa }) &&
    (proposed.type === "sub_recipe" ||
      proposed.type === "ignore" ||
      proposed.type === "category_cost")
  ) {
    return {
      type: "recipe",
      confidence: Math.max(proposed.confidence, 0.88),
      notes: "dish tab from content",
    };
  }
  return proposed;
}
