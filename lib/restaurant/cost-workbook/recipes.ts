import { normalizeUnit } from "@/lib/restaurant/units";
import { numberAt, textAt } from "./cells";
import { recipeNameFromSheet } from "./names";
import { skipReasonForWorkbookRow } from "./skip";
import type {
  ColumnMapping,
  GroupedRecipe,
  RecipeLineCandidate,
  ReviewCandidate,
  SkipCandidate,
} from "./types";

export function evaluateRecipeLine(input: {
  tabName: string;
  rowIndex: number;
  recipeName: string;
  row: Record<string, unknown>;
  mapping: ColumnMapping;
}):
  | { ok: true; value: RecipeLineCandidate }
  | { ok: false; review: ReviewCandidate } {
  const { tabName, rowIndex, recipeName, row, mapping } = input;
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
            ingredient_name: name,
            unit: textAt(row, mapping, "unit") ?? undefined,
          }
        : null,
    },
  });

  if (!name) return fail("Missing ingredient name");
  const unitRaw = textAt(row, mapping, "unit");
  if (!unitRaw) return fail("Missing unit");
  if (!normalizeUnit(unitRaw)) {
    return fail(`unknown unit (${unitRaw})`);
  }
  const qty = numberAt(row, mapping, "quantity");
  if (qty === null || qty <= 0) {
    return fail("Quantity must be a positive number");
  }

  return {
    ok: true,
    value: {
      tabName,
      rowIndex,
      recipeName,
      ingredient_name: name,
      quantity: qty,
      unit: unitRaw,
      raw: row,
    },
  };
}

export function isTitleRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping
): string | null {
  const qty = numberAt(row, mapping, "quantity");
  const unit = textAt(row, mapping, "unit");
  if (qty !== null && qty > 0) return null;
  if (unit) return null;
  return (
    textAt(row, mapping, "recipe_name") ??
    textAt(row, mapping, "ingredient_name")
  );
}

export function collectRecipeLines(input: {
  tabName: string;
  tabKind: "recipe" | "sub_recipe";
  dataRows: Record<string, unknown>[];
  mapping: ColumnMapping;
}): {
  groups: GroupedRecipe[];
  review: ReviewCandidate[];
  skipped: SkipCandidate[];
} {
  const fallbackName = recipeNameFromSheet(input.tabName);
  const review: ReviewCandidate[] = [];
  const skipped: SkipCandidate[] = [];
  const groups = new Map<string, GroupedRecipe>();
  let currentName = fallbackName;

  const takeGroup = (name: string): GroupedRecipe => {
    const key = name.trim().toLowerCase();
    const existing = groups.get(key);
    if (existing) return existing;
    const created: GroupedRecipe = {
      name: name.trim() || fallbackName,
      tabName: input.tabName,
      kind: input.tabKind,
      lines: [],
    };
    groups.set(key, created);
    return created;
  };

  for (const [rowIndex, row] of input.dataRows.entries()) {
    const skip = skipReasonForWorkbookRow(input.tabKind, row, input.mapping);
    if (skip) {
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: skip,
        raw: row,
      });
      continue;
    }

    const title = isTitleRow(row, input.mapping);
    const qty = numberAt(row, input.mapping, "quantity");
    const ingredient = textAt(row, input.mapping, "ingredient_name");
    if (title && (qty === null || qty <= 0)) {
      currentName = title;
      if (!ingredient || ingredient === title) continue;
    }
    const named = textAt(row, input.mapping, "recipe_name");
    if (named) currentName = named;

    const evaluated = evaluateRecipeLine({
      tabName: input.tabName,
      rowIndex,
      recipeName: currentName,
      row,
      mapping: input.mapping,
    });
    if (!evaluated.ok) {
      review.push(evaluated.review);
      continue;
    }
    takeGroup(evaluated.value.recipeName).lines.push(evaluated.value);
  }

  return {
    groups: [...groups.values()].filter((group) => group.lines.length > 0),
    review,
    skipped,
  };
}
