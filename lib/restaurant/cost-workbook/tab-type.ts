// Deterministic tab-type corrections on top of AI / header heuristics.
// Dish-section sheets with title-row blocks are recipes; only
// SUB RECETAS-style names stay sub_recipe; plate-cost summaries are skipped.

import { normalizeHeaderToken } from "./header";
import { sanitizeColumnMapping } from "./mapping";
import { isTitleRow } from "./recipes";
import { skipReasonForWorkbookRow } from "./skip";
import type { ColumnMapping, TabClassification } from "./types";

export function isSubRecipeTabName(sheetName: string): boolean {
  return /(sub[\s_-]*receta|sub[\s_-]*recipe|preparacion|preparación)/i.test(
    sheetName
  );
}

export function isMenuSummaryTab(
  sheetName: string,
  headers: string[]
): boolean {
  const name = normalizeHeaderToken(sheetName);
  if (/costosrestaurante/.test(name)) return true;

  const tokens = headers.map((header) => normalizeHeaderToken(header));
  const hasMenu = tokens.some(
    (token) => token === "menu" || token === "plato" || token === "platillo"
  );
  const hasPlateCost = tokens.some(
    (token) =>
      token.includes("costodelplato") ||
      token.includes("costoplato") ||
      token.includes("preciodeventa") ||
      token.includes("precioventa")
  );
  const hasUnit = tokens.some(
    (token) =>
      token.includes("unidad") ||
      token === "unit" ||
      token === "uom" ||
      token === "um"
  );
  return hasMenu && hasPlateCost && !hasUnit;
}

function bindIfHeader(
  headers: string[],
  field: string,
  needles: string[]
): ColumnMapping {
  const hit = headers.find((header) => {
    const token = normalizeHeaderToken(header);
    return needles.some((needle) => token === needle || token.includes(needle));
  });
  return hit ? { [field]: { column: hit, confidence: 0.8 } } : {};
}

function titleBlockMapping(headers: string[]): ColumnMapping {
  return sanitizeColumnMapping({
    ...bindIfHeader(headers, "ingredient_name", [
      "ingrediente",
      "ingredient",
      "articulo",
      "artículo",
      "nombre",
      "producto",
      "item",
    ]),
    ...bindIfHeader(headers, "quantity", ["cantidad", "qty", "quantity"]),
    ...bindIfHeader(headers, "unit", ["unidad", "unit", "uom", "um", "medida"]),
  });
}

export function looksLikeTitleBlockRecipes(
  headers: string[],
  rows: Record<string, unknown>[]
): boolean {
  const mapping = titleBlockMapping(headers);
  if (
    !mapping.ingredient_name?.column ||
    !mapping.quantity?.column ||
    !mapping.unit?.column
  ) {
    return false;
  }

  let titles = 0;
  let lines = 0;
  for (const row of rows) {
    if (skipReasonForWorkbookRow("recipe", row, mapping)) continue;
    if (isTitleRow(row, mapping)) {
      titles += 1;
      continue;
    }
    lines += 1;
  }
  return titles >= 1 && lines >= 2;
}

export function refineCostTabType(input: {
  sheetName: string;
  headers: string[];
  dataRows: Record<string, unknown>[];
  classified: TabClassification;
}): TabClassification {
  if (isMenuSummaryTab(input.sheetName, input.headers)) {
    return {
      type: "ignore",
      confidence: Math.max(input.classified.confidence, 0.92),
      notes: "menu list / plate-cost summary — not recipe lines",
    };
  }
  if (isSubRecipeTabName(input.sheetName)) {
    return {
      ...input.classified,
      type: "sub_recipe",
    };
  }
  if (
    input.classified.type === "sub_recipe" &&
    !isSubRecipeTabName(input.sheetName)
  ) {
    return {
      type: "recipe",
      confidence: input.classified.confidence,
      notes:
        input.classified.notes ??
        "menu-section ingredient blocks — finished dishes, not prep",
    };
  }
  if (
    input.classified.type === "category_cost" &&
    looksLikeTitleBlockRecipes(input.headers, input.dataRows)
  ) {
    return {
      type: "recipe",
      confidence: Math.max(input.classified.confidence, 0.88),
      notes: "title-row ingredient blocks — finished dishes",
    };
  }
  return input.classified;
}
