// What a dish already has before the import writes: a recipe made by hand or
// approved is KEPT when it has lines (the person chooses per dish); an empty
// placeholder (no lines, nothing approved with lines) is filled.

import type { CostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { isImportProtectedSource } from "@/lib/restaurant/protect-imported-recipe";
import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";

export interface ExistingRecipeState {
  /** Made by hand (not an import draft) or has an approved version. */
  protected: boolean;
  /** Lines of the version in force (approved), else of the newest one. */
  lines: number;
}

export async function existingRecipeState(
  repo: CostWorkbookRepo,
  companyId: string,
  recipe: { id: string; source_type?: string | null }
): Promise<ExistingRecipeState> {
  const versions = await repo.listRecipeVersions(companyId, recipe.id);
  const approved = versions.some((row) => row.status === "approved");
  const current =
    pickApprovedVersion(versions) ??
    versions.slice().sort((a, b) => b.version_number - a.version_number)[0] ??
    null;
  const lines = current
    ? (await repo.listRecipeVersionInputs(companyId, current.id)).length
    : (await repo.listRecipeInputs(companyId, recipe.id)).length;
  return {
    protected: isImportProtectedSource(recipe.source_type) || approved,
    lines,
  };
}

/** A recipe with lines that is not an import draft: the import never replaces it on its own. */
export function isKeptRecipe(state: ExistingRecipeState): boolean {
  return state.protected && state.lines > 0;
}
