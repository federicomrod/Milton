import type { PreferredLanguage } from "@/lib/restaurant/language";
import { inspectCostImportNumber } from "@/lib/restaurant/cost-import";
import { numberAt, textAt } from "./cells";
import {
  ambiguousNumberReason,
  missingIngredientNameReason,
  missingUnitReason,
  positiveQuantityReason,
} from "./copy";
import { recipeNameFromSheet } from "./names";
import { resolveRecipeLineUnit } from "./portion-unit";
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
  knownSubRecipeNames?: Iterable<string>;
  lang?: PreferredLanguage;
}):
  | { ok: true; value: RecipeLineCandidate }
  | { ok: false; review: ReviewCandidate } {
  const { tabName, rowIndex, recipeName, row, mapping } = input;
  const lang = input.lang ?? "en";
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

  if (!name) return fail(missingIngredientNameReason(lang));
  const unitRaw = textAt(row, mapping, "unit");
  if (!unitRaw) return fail(missingUnitReason(lang));
  const resolvedUnit = resolveRecipeLineUnit({
    unitRaw,
    ingredientName: name,
    knownSubRecipeNames: input.knownSubRecipeNames ?? [],
    lang,
  });
  if (!resolvedUnit.ok) return fail(resolvedUnit.reason);
  const qtyCol = mapping.quantity?.column;
  const qtyInspected = qtyCol
    ? inspectCostImportNumber(row[qtyCol])
    : { kind: "blank" as const };
  if (qtyInspected.kind === "ambiguous") {
    return fail(ambiguousNumberReason(lang, qtyInspected.raw));
  }
  const qty = numberAt(row, mapping, "quantity");
  if (qty === null || qty <= 0) {
    return fail(positiveQuantityReason(lang));
  }

  return {
    ok: true,
    value: {
      tabName,
      rowIndex,
      recipeName,
      ingredient_name: name,
      quantity: qty * resolvedUnit.quantityMultiplier,
      unit:
        resolvedUnit.quantityMultiplier !== 1 ||
        resolvedUnit.canonical === "portion"
          ? resolvedUnit.unit
          : unitRaw,
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
  knownSubRecipeNames?: Iterable<string>;
  lang?: PreferredLanguage;
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
      output_quantity: null,
      output_unit: null,
      incomplete_lines: false,
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
    const outputQty = numberAt(row, input.mapping, "output_quantity");
    const outputUnit = textAt(row, input.mapping, "output_unit");
    if (title && (qty === null || qty <= 0)) {
      currentName = title;
      if (outputQty != null && outputQty > 0 && outputUnit) {
        const group = takeGroup(currentName);
        group.output_quantity = outputQty;
        group.output_unit = outputUnit;
      }
      if (!ingredient || ingredient === title) continue;
    }
    const named = textAt(row, input.mapping, "recipe_name");
    if (named) currentName = named;
    if (outputQty != null && outputQty > 0 && outputUnit) {
      const group = takeGroup(currentName);
      group.output_quantity = outputQty;
      group.output_unit = outputUnit;
    }

    const evaluated = evaluateRecipeLine({
      tabName: input.tabName,
      rowIndex,
      recipeName: currentName,
      row,
      mapping: input.mapping,
      knownSubRecipeNames: input.knownSubRecipeNames,
      lang: input.lang,
    });
    if (!evaluated.ok) {
      takeGroup(currentName).incomplete_lines = true;
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
