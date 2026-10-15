// Flipping an imported recipe to source_type=manual protects it the same
// way a recipe typed in by hand is protected: a later workbook upload
// must skip it instead of overwriting the owner's fix.
//
// Clearing workbook_cost_match / workbook_computed_cost is required so a
// hand fix is not stuck as Excel mismatch (or a stale match) forever.
// NULL means "no Excel check" — the live engine counts the recipe if it
// is otherwise complete. The mismatch rule only applies to source_type
// === "import".

export const MANUAL_RECIPE_SOURCE = "manual";

export function isImportProtectedSource(
  sourceType: string | null | undefined
): boolean {
  return sourceType !== "import";
}

export function handmadeSourceCorePatch(): {
  source_type: typeof MANUAL_RECIPE_SOURCE;
} {
  return { source_type: MANUAL_RECIPE_SOURCE };
}

export function handmadeWorkbookClearPatch(): {
  workbook_cost_match: null;
  workbook_computed_cost: null;
  workbook_variance_amount: null;
  workbook_variance_pct: null;
} {
  return {
    workbook_cost_match: null,
    workbook_computed_cost: null,
    workbook_variance_amount: null,
    workbook_variance_pct: null,
  };
}

export function handmadeSourcePatch(): {
  source_type: typeof MANUAL_RECIPE_SOURCE;
  workbook_cost_match: null;
  workbook_computed_cost: null;
  workbook_variance_amount: null;
  workbook_variance_pct: null;
} {
  return {
    ...handmadeSourceCorePatch(),
    ...handmadeWorkbookClearPatch(),
  };
}

export function shouldApplyWorkbookMismatch(recipe: {
  source_type?: string | null;
  workbook_cost_match?: "match" | "mismatch" | null;
}): boolean {
  return (
    recipe.source_type === "import" && recipe.workbook_cost_match === "mismatch"
  );
}
