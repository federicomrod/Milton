// Content-based column detection for recipe / sub-recipe tabs.
// Used when a saved or AI mapping fails sanity — AI still only
// proposes columns; this scores the actual cell values.

import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import { resolveUnitCell } from "@/lib/restaurant/units";
import { mapColumnsHeuristic } from "./ai";
import { sanitizeColumnMapping } from "./mapping";
import { mappingSanityScore, SANITY_PASS_RATIO } from "./sanity";
import type { ColumnMapping, CostTabType, MappingSource } from "./types";

const UNIT_RATIO = 0.4;
const QTY_RATIO = 0.4;
const SAMPLE_LIMIT = 8;

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
}

function columnStats(rows: Record<string, unknown>[]): ColumnStats[] {
  const cols = columnOrder(rows);
  return cols.map((col, index) => {
    let nonempty = 0;
    let units = 0;
    let numbers = 0;
    let texts = 0;
    const unique = new Set<string>();
    for (const row of rows) {
      const raw = row[col];
      const text = cellText(raw);
      if (!text) continue;
      nonempty += 1;
      if (parseCostImportNumber(raw) !== null) {
        numbers += 1;
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
    };
  });
}

function bind(
  column: string,
  confidence = 0.86
): { column: string; confidence: number } {
  return { column, confidence };
}

/**
 * Pick the column whose values are mostly recognised units, the numeric
 * quantity column, a text ingredient column, and an optional repeating
 * recipe-name column. Does not guess prices.
 */
export function inferRecipeMappingFromContent(
  dataRows: Record<string, unknown>[]
): ColumnMapping {
  const stats = columnStats(dataRows).filter((col) => col.nonempty > 0);
  if (stats.length === 0) return {};

  const unitCol = stats
    .filter((col) => col.units / col.nonempty >= UNIT_RATIO)
    .sort(
      (a, b) => b.units / b.nonempty - a.units / a.nonempty || b.units - a.units
    )[0];

  const qtyCandidates = stats.filter(
    (col) => col.col !== unitCol?.col && col.numbers / col.nonempty >= QTY_RATIO
  );
  const qtyCol = qtyCandidates.slice().sort((a, b) => {
    if (unitCol) {
      const aAdj = Math.abs(a.index - unitCol.index);
      const bAdj = Math.abs(b.index - unitCol.index);
      if (aAdj !== bAdj) return aAdj - bAdj;
    }
    const aRatio = a.numbers / a.nonempty;
    const bRatio = b.numbers / b.nonempty;
    if (bRatio !== aRatio) return bRatio - aRatio;
    return b.numbers - a.numbers;
  })[0];

  const used = new Set<string>();
  if (unitCol) used.add(unitCol.col);
  if (qtyCol) used.add(qtyCol.col);

  const textCols = stats.filter(
    (col) => !used.has(col.col) && col.texts - col.units > 0
  );
  const recipeCol = textCols
    .filter((col) => col.texts >= 2 && col.uniqueTexts < col.texts * 0.7)
    .sort((a, b) => a.uniqueTexts / a.texts - b.uniqueTexts / b.texts)[0];
  const ingredientCol = textCols
    .filter((col) => col.col !== recipeCol?.col)
    .sort(
      (a, b) =>
        b.uniqueTexts - a.uniqueTexts || b.texts - b.units - (a.texts - a.units)
    )[0];

  const mapping: ColumnMapping = {};
  if (ingredientCol) mapping.ingredient_name = bind(ingredientCol.col);
  if (qtyCol) mapping.quantity = bind(qtyCol.col);
  if (unitCol) mapping.unit = bind(unitCol.col);
  if (recipeCol && recipeCol.col !== ingredientCol?.col) {
    mapping.recipe_name = bind(recipeCol.col, 0.8);
  }
  return sanitizeColumnMapping(mapping);
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
}> {
  const scoreOf = (mapping: ColumnMapping) =>
    mappingSanityScore({
      tabType: input.tabType,
      dataRows: input.dataRows,
      mapping,
      currency: input.currency,
      defaultDate: input.defaultDate,
    });

  const cleanedAi = sanitizeColumnMapping(input.aiMapping);
  const candidates: MappingCandidate[] = [
    { mapping: cleanedAi, source: "ai", score: scoreOf(cleanedAi) },
  ];

  const bestSoFar = () =>
    candidates.reduce((best, row) => (row.score > best.score ? row : best));

  if (bestSoFar().score <= SANITY_PASS_RATIO) {
    const content = inferRecipeMappingFromContent(input.dataRows);
    candidates.push({
      mapping: content,
      source: "heuristic",
      score: scoreOf(content),
    });

    const headerMap = sanitizeColumnMapping(
      mapColumnsHeuristic({
        tabType: input.tabType,
        headers: input.headers,
        sampleRows: input.sampleRows,
      })
    );
    candidates.push({
      mapping: headerMap,
      source: "heuristic",
      score: scoreOf(headerMap),
    });
  }

  if (bestSoFar().score <= SANITY_PASS_RATIO) {
    const betterSample = pickMappingSampleRows(input.dataRows);
    if (betterSample.length > 0) {
      const retried = await input.mapColumns({
        tabType: input.tabType,
        headers: input.headers,
        sampleRows: betterSample,
      });
      const cleanedRetry = sanitizeColumnMapping(retried);
      candidates.push({
        mapping: cleanedRetry,
        source: "ai",
        score: scoreOf(cleanedRetry),
      });
    }
  }

  const passing = candidates.filter((row) => row.score > SANITY_PASS_RATIO);
  const pool = passing.length > 0 ? passing : candidates;
  const winner = pool.reduce((best, row) =>
    row.score > best.score ? row : best
  );

  return {
    mapping: winner.mapping,
    mappingSource: winner.source,
    persistMapping: winner.score > SANITY_PASS_RATIO,
    score: winner.score,
  };
}
