// Content-based column detection for recipe / sub-recipe tabs.
// Used when a saved or AI mapping fails sanity — AI still only
// proposes columns; this scores the actual cell values.

import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import { resolveUnitCell } from "@/lib/restaurant/units";
import { mapColumnsHeuristic } from "./ai";
import {
  dropCollidingOptionalRecipeFields,
  LOOKALIKE_QTY_MARGIN,
  mappingSanityScore,
  numericColumnsLookAlike,
  quantityLikeness,
  recipeMappingHasDistinctRoles,
  SANITY_PASS_RATIO,
} from "./sanity";
import type { ColumnMapping, CostTabType, MappingSource } from "./types";

const UNIT_RATIO = 0.4;
const QTY_RATIO = 0.4;
const ROLE_MARGIN = 0.15;
const SAMPLE_LIMIT = 8;

export const AMBIGUOUS_MAPPING_REASON =
  "No está claro qué columna es la unidad, la cantidad o el ingrediente.";
export const OVERLAPPING_MAPPING_REASON =
  "La misma columna no puede ser a la vez receta e ingrediente.";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function columnOrder(rows: Record<string, unknown>[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

interface ColumnStats {
  col: string;
  index: number;
  nonempty: number;
  units: number;
  numbers: number;
  texts: number;
  uniqueTexts: number;
  numericValues: number[];
}

function columnStats(rows: Record<string, unknown>[]): ColumnStats[] {
  const cols = columnOrder(rows);
  return cols.map((col, index) => {
    let nonempty = 0;
    let units = 0;
    let numbers = 0;
    let texts = 0;
    const unique = new Set<string>();
    const numericValues: number[] = [];
    for (const row of rows) {
      const raw = row[col];
      const text = cellText(raw);
      if (!text) continue;
      nonempty += 1;
      const parsed = parseCostImportNumber(raw);
      if (parsed !== null) {
        numbers += 1;
        numericValues.push(parsed);
        continue;
      }
      texts += 1;
      unique.add(text.toLowerCase());
      if (resolveUnitCell(text).ok) units += 1;
    }
    return {
      col,
      index,
      nonempty,
      units,
      numbers,
      texts,
      uniqueTexts: unique.size,
      numericValues,
    };
  });
}

function bind(
  column: string,
  confidence = 0.86
): { column: string; confidence: number } {
  return { column, confidence };
}

function unitRatio(col: ColumnStats): number {
  return col.nonempty === 0 ? 0 : col.units / col.nonempty;
}

function numberRatio(col: ColumnStats): number {
  return col.nonempty === 0 ? 0 : col.numbers / col.nonempty;
}

function hasClearMargin(best: number, second: number): boolean {
  if (second <= 0) return true;
  return best - second >= ROLE_MARGIN;
}

function pickUnique(
  ranked: Array<{ col: ColumnStats; score: number }>,
  used: Set<string>
): ColumnStats | undefined {
  const free = ranked.filter((row) => !used.has(row.col.col));
  const first = free[0];
  if (!first || first.score <= 0) return undefined;
  const second = free[1];
  if (second && !hasClearMargin(first.score, second.score)) return undefined;
  return first.col;
}

export interface InferredRecipeMapping {
  mapping: ColumnMapping;
  confident: boolean;
  reason?: string;
}

/**
 * Pick the column whose values are mostly recognised units, the numeric
 * quantity column, a text ingredient column, and an optional repeating
 * recipe-name column. Does not guess prices. Requires a clear margin
 * between the best and second-best candidate and refuses a quantity
 * column that looks more like cost than another numeric column.
 */
export function inferRecipeMappingDetails(
  dataRows: Record<string, unknown>[]
): InferredRecipeMapping {
  const stats = columnStats(dataRows).filter((col) => col.nonempty > 0);
  if (stats.length === 0) {
    return {
      mapping: {},
      confident: false,
      reason: AMBIGUOUS_MAPPING_REASON,
    };
  }

  const unitRanked = stats
    .map((col) => ({ col, score: unitRatio(col) }))
    .filter((row) => row.score >= UNIT_RATIO)
    .sort((a, b) => b.score - a.score || b.col.units - a.col.units);
  const unitCol = pickUnique(unitRanked, new Set());

  const qtyPool = stats.filter(
    (col) => col.col !== unitCol?.col && numberRatio(col) >= QTY_RATIO
  );
  for (let i = 0; i < qtyPool.length; i += 1) {
    for (let j = i + 1; j < qtyPool.length; j += 1) {
      const left = qtyPool[i];
      const right = qtyPool[j];
      if (!numericColumnsLookAlike(left.numericValues, right.numericValues)) {
        continue;
      }
      const leftScore = quantityLikeness(left.numericValues);
      const rightScore = quantityLikeness(right.numericValues);
      if (Math.abs(leftScore - rightScore) < LOOKALIKE_QTY_MARGIN) {
        return {
          mapping: {},
          confident: false,
          reason: AMBIGUOUS_MAPPING_REASON,
        };
      }
    }
  }

  const qtyRanked = qtyPool
    .map((col) => {
      const qtyScore = quantityLikeness(col.numericValues);
      const adjacency =
        unitCol != null ? 1 / (1 + Math.abs(col.index - unitCol.index)) : 0;
      return { col, score: qtyScore * 0.85 + adjacency * 0.15 };
    })
    .sort((a, b) => b.score - a.score);
  const qtyCol = pickUnique(qtyRanked, new Set(unitCol ? [unitCol.col] : []));

  if (qtyCol && qtyRanked.length > 1) {
    const bestQty = quantityLikeness(qtyCol.numericValues);
    const rival = qtyRanked.find((row) => row.col.col !== qtyCol.col);
    const rivalQty = rival ? quantityLikeness(rival.col.numericValues) : 0;
    if (
      rival &&
      (rivalQty - bestQty >= ROLE_MARGIN ||
        (Math.abs(rivalQty - bestQty) < ROLE_MARGIN &&
          rivalQty >= 0.35 &&
          bestQty >= 0.35))
    ) {
      return {
        mapping: {},
        confident: false,
        reason: AMBIGUOUS_MAPPING_REASON,
      };
    }
  }

  const used = new Set<string>();
  if (unitCol) used.add(unitCol.col);
  if (qtyCol) used.add(qtyCol.col);

  const textCols = stats.filter(
    (col) => !used.has(col.col) && col.texts - col.units > 0
  );
  const recipeRanked = textCols
    .filter((col) => col.texts >= 2 && col.uniqueTexts < col.texts * 0.7)
    .map((col) => ({
      col,
      score: 1 - col.uniqueTexts / col.texts,
    }))
    .sort((a, b) => b.score - a.score);
  const recipeCol = pickUnique(recipeRanked, used);

  const ingredientRanked = textCols
    .filter((col) => col.col !== recipeCol?.col)
    .map((col) => ({
      col,
      score: col.uniqueTexts + (col.texts - col.units) * 0.25,
    }))
    .sort((a, b) => b.score - a.score);
  const ingredientCol = pickUnique(
    ingredientRanked,
    new Set([...used, recipeCol?.col ?? ""])
  );

  const mapping: ColumnMapping = {};
  if (ingredientCol) mapping.ingredient_name = bind(ingredientCol.col);
  if (qtyCol) mapping.quantity = bind(qtyCol.col);
  if (unitCol) mapping.unit = bind(unitCol.col);
  if (recipeCol && recipeCol.col !== ingredientCol?.col) {
    mapping.recipe_name = bind(recipeCol.col, 0.8);
  }

  const required =
    Boolean(mapping.ingredient_name?.column) &&
    Boolean(mapping.quantity?.column) &&
    Boolean(mapping.unit?.column);
  if (!required || !recipeMappingHasDistinctRoles(mapping)) {
    return {
      mapping: {},
      confident: false,
      reason: required ? OVERLAPPING_MAPPING_REASON : AMBIGUOUS_MAPPING_REASON,
    };
  }
  return { mapping, confident: true };
}

export function inferRecipeMappingFromContent(
  dataRows: Record<string, unknown>[]
): ColumnMapping {
  return inferRecipeMappingDetails(dataRows).mapping;
}

export function pickMappingSampleRows(
  dataRows: Record<string, unknown>[],
  limit = SAMPLE_LIMIT
): Record<string, unknown>[] {
  const scored = dataRows.map((row, index) => {
    let numbers = 0;
    let units = 0;
    let texts = 0;
    for (const value of Object.values(row)) {
      const text = cellText(value);
      if (!text) continue;
      if (parseCostImportNumber(value) !== null) {
        numbers += 1;
        continue;
      }
      texts += 1;
      if (resolveUnitCell(text).ok) units += 1;
    }
    return { row, index, score: units * 3 + numbers * 2 + texts };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.row);
}

interface MappingCandidate {
  mapping: ColumnMapping;
  source: MappingSource;
  score: number;
}

export function scoreRecipeMapping(input: {
  tabType: CostTabType;
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  currency: string;
  defaultDate: string;
}): number {
  return mappingSanityScore(input);
}

function usableRecipeMapping(mapping: ColumnMapping): ColumnMapping | null {
  const cleaned = dropCollidingOptionalRecipeFields(mapping);
  if (!recipeMappingHasDistinctRoles(cleaned)) return null;
  if (
    !cleaned.ingredient_name?.column ||
    !cleaned.quantity?.column ||
    !cleaned.unit?.column
  ) {
    return null;
  }
  return cleaned;
}

export async function resolveRecipeMapping(input: {
  tabType: Extract<CostTabType, "recipe" | "sub_recipe">;
  headers: string[];
  dataRows: Record<string, unknown>[];
  sampleRows: Record<string, unknown>[];
  aiMapping: ColumnMapping;
  mapColumns: (args: {
    tabType: CostTabType;
    headers: string[];
    sampleRows: Record<string, unknown>[];
  }) => Promise<ColumnMapping>;
  currency: string;
  defaultDate: string;
}): Promise<{
  mapping: ColumnMapping;
  mappingSource: MappingSource;
  persistMapping: boolean;
  score: number;
  holdReason?: string;
}> {
  const scoreOf = (mapping: ColumnMapping) =>
    mappingSanityScore({
      tabType: input.tabType,
      dataRows: input.dataRows,
      mapping,
      currency: input.currency,
      defaultDate: input.defaultDate,
    });

  const candidates: MappingCandidate[] = [];
  const add = (mapping: ColumnMapping, source: MappingSource) => {
    const usable = usableRecipeMapping(mapping);
    if (!usable) return;
    candidates.push({ mapping: usable, source, score: scoreOf(usable) });
  };

  add(input.aiMapping, "ai");

  const bestSoFar = () =>
    candidates.length === 0
      ? null
      : candidates.reduce((best, row) => (row.score > best.score ? row : best));

  const needsFallback = () =>
    !bestSoFar() || (bestSoFar()?.score ?? 0) <= SANITY_PASS_RATIO;

  const content = inferRecipeMappingDetails(input.dataRows);
  if (needsFallback()) {
    if (content.confident) add(content.mapping, "heuristic");

    const headerMap = mapColumnsHeuristic({
      tabType: input.tabType,
      headers: input.headers,
      sampleRows: input.sampleRows,
    });
    add(headerMap, "heuristic");
  }

  if (needsFallback()) {
    const betterSample = pickMappingSampleRows(input.dataRows);
    if (betterSample.length > 0) {
      const retried = await input.mapColumns({
        tabType: input.tabType,
        headers: input.headers,
        sampleRows: betterSample,
      });
      add(retried, "ai");
    }
  }

  const passing = candidates.filter((row) => row.score > SANITY_PASS_RATIO);
  if (passing.length === 0) {
    return {
      mapping: {},
      mappingSource: "heuristic",
      persistMapping: false,
      score: 0,
      holdReason: content.reason ?? AMBIGUOUS_MAPPING_REASON,
    };
  }
  const winner = passing.reduce((best, row) =>
    row.score > best.score ? row : best
  );
  return {
    mapping: winner.mapping,
    mappingSource: winner.source,
    persistMapping: true,
    score: winner.score,
  };
}
