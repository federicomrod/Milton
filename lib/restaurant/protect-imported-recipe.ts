// Flipping an imported recipe to source_type=manual protects it the same
// way a recipe typed in by hand is protected: a later workbook upload
// must skip it instead of overwriting the owner's fix.

export const MANUAL_RECIPE_SOURCE = "manual";

export function isImportProtectedSource(
  sourceType: string | null | undefined
): boolean {
  return sourceType !== "import";
}

export function handmadeSourcePatch(): {
  source_type: typeof MANUAL_RECIPE_SOURCE;
} {
  return { source_type: MANUAL_RECIPE_SOURCE };
}
