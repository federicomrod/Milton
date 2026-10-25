// ONE rule for "this plato has a recipe", shared by «Leer menú» and
// «Estimar con Milton». It is the same rule Menú › Platos uses to say
// «Sin receta» (dishStateFrom: no version, or the version the plato is costed
// with has no lines): that version is the approved one in force, else the
// newest one that was not rejected. An empty version, a rejected one, or a
// Confirmado link on its own do not make a recipe. A bound Excel suggestion
// (a parsed workbook block with lines) does. Pure (no I/O, no React).

import {
  pickDishVersions,
  type StateVersion,
} from "@/lib/restaurant/costing/dish-state";

export interface RecipeVersionForRule extends StateVersion {
  id: string;
}

/** A rejected version never counts (the app only writes approved / in_review today). */
function counts(version: { status: string }): boolean {
  return version.status !== "rejected";
}

export interface HasRecipeInput {
  versions: readonly RecipeVersionForRule[];
  /** Lines per version id; a missing id is 0 lines. */
  lineCounts: ReadonlyMap<string, number>;
  /** A parsed Excel suggestion with lines is bound to the plato. */
  boundSuggestion?: boolean;
  asOfDate?: string | null;
}

export function hasRecipe(input: HasRecipeInput): boolean {
  if (input.boundSuggestion) return true;
  const { version } = pickDishVersions(
    input.versions.filter(counts),
    input.asOfDate
  );
  return version !== null && (input.lineCounts.get(version.id) ?? 0) > 0;
}

/** Lines per version id from the rows of recipe_version_inputs. */
export function countLinesByVersion(
  rows: ReadonlyArray<{ recipe_version_id: string }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.recipe_version_id, (out.get(row.recipe_version_id) ?? 0) + 1);
  }
  return out;
}
