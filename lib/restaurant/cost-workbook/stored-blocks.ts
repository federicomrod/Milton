// Compact parsed workbook blocks stored on a Costos upload batch so
// Recetas y costeo can generate AI suggestions without re-uploading
// the xlsx. Lines keep qty/unit/cost; raw Excel cells are dropped.

import { lineUnitCostFromRaw } from "./propose-recipe";
import type { GroupedRecipe, RecipeLineCandidate } from "./types";

export interface StoredRecipeLine {
  tabName: string;
  rowIndex: number;
  recipeName: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
}

export interface StoredRecipeBlock {
  name: string;
  tabName: string;
  kind: "recipe" | "sub_recipe";
  output_quantity: number | null;
  output_unit: string | null;
  yield_assumed?: boolean;
  cost_total?: number | null;
  cost_total_inferred?: boolean;
  lines: StoredRecipeLine[];
  pending_lines?: StoredRecipeLine[];
}

function compactLine(line: RecipeLineCandidate): StoredRecipeLine {
  return {
    tabName: line.tabName,
    rowIndex: line.rowIndex,
    recipeName: line.recipeName,
    ingredient_name: line.ingredient_name,
    quantity: line.quantity,
    unit: line.unit,
    unit_cost: lineUnitCostFromRaw(line.raw),
  };
}

function expandLine(line: StoredRecipeLine): RecipeLineCandidate {
  return {
    tabName: line.tabName,
    rowIndex: line.rowIndex,
    recipeName: line.recipeName,
    ingredient_name: line.ingredient_name,
    quantity: line.quantity,
    unit: line.unit,
    raw: line.unit_cost != null ? { "Costo Unitario": line.unit_cost } : {},
  };
}

export function compactCandidateBlocks(
  blocks: readonly GroupedRecipe[]
): StoredRecipeBlock[] {
  return blocks
    .filter(
      (block) => block.lines.length + (block.pending_lines?.length ?? 0) > 0
    )
    .map((block) => ({
      name: block.name,
      tabName: block.tabName,
      kind: block.kind,
      output_quantity: block.output_quantity,
      output_unit: block.output_unit,
      yield_assumed: block.yield_assumed,
      cost_total: block.cost_total,
      cost_total_inferred: block.cost_total_inferred,
      lines: block.lines.map(compactLine),
      pending_lines: (block.pending_lines ?? []).map(compactLine),
    }));
}

export function expandCandidateBlocks(
  stored: readonly StoredRecipeBlock[] | null | undefined
): GroupedRecipe[] {
  if (!stored?.length) return [];
  return stored.map((block) => ({
    name: block.name,
    tabName: block.tabName,
    kind: block.kind,
    output_quantity: block.output_quantity,
    output_unit: block.output_unit,
    yield_assumed: block.yield_assumed,
    cost_total: block.cost_total,
    cost_total_inferred: block.cost_total_inferred,
    lines: block.lines.map(expandLine),
    pending_lines: (block.pending_lines ?? []).map(expandLine),
  }));
}

export function candidateBlocksFromUnknown(
  value: unknown
): StoredRecipeBlock[] {
  if (!Array.isArray(value)) return [];
  const out: StoredRecipeBlock[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    if (typeof row.tabName !== "string" || !row.tabName.trim()) continue;
    if (row.kind !== "recipe" && row.kind !== "sub_recipe") continue;
    const lines = Array.isArray(row.lines)
      ? row.lines
          .map(asStoredLine)
          .filter((line): line is StoredRecipeLine => line !== null)
      : [];
    const pending = Array.isArray(row.pending_lines)
      ? row.pending_lines
          .map(asStoredLine)
          .filter((line): line is StoredRecipeLine => line !== null)
      : [];
    if (lines.length + pending.length === 0) continue;
    out.push({
      name: row.name,
      tabName: row.tabName,
      kind: row.kind,
      output_quantity:
        typeof row.output_quantity === "number" ? row.output_quantity : null,
      output_unit: typeof row.output_unit === "string" ? row.output_unit : null,
      yield_assumed: row.yield_assumed === true,
      cost_total: typeof row.cost_total === "number" ? row.cost_total : null,
      cost_total_inferred: row.cost_total_inferred === true,
      lines,
      pending_lines: pending,
    });
  }
  return out;
}

function asStoredLine(value: unknown): StoredRecipeLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ingredient_name !== "string" || !row.ingredient_name.trim()) {
    return null;
  }
  if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity)) {
    return null;
  }
  return {
    tabName: typeof row.tabName === "string" ? row.tabName : "",
    rowIndex: typeof row.rowIndex === "number" ? row.rowIndex : 0,
    recipeName: typeof row.recipeName === "string" ? row.recipeName : "",
    ingredient_name: row.ingredient_name,
    quantity: row.quantity,
    unit: typeof row.unit === "string" ? row.unit : "",
    unit_cost:
      typeof row.unit_cost === "number" && Number.isFinite(row.unit_cost)
        ? row.unit_cost
        : null,
  };
}
