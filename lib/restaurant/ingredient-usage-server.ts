// R1-15i: loads what "en uso" needs: the active recipes (dishes and
// preparations) and the archived ingredient ids. Read-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCostingRecipeVersions } from "@/lib/restaurant/costing-versions";
import {
  computeIngredientUsage,
  type IngredientUsage,
} from "@/lib/restaurant/ingredient-usage";

export interface IngredientUsageLoad extends IngredientUsage {
  /** Ids with `archived_at` set (050). */
  archivedIds: Set<string>;
  /** False until migration 050: nothing can be archived yet. */
  archiveAvailable: boolean;
  /** The recipes could be read; false = usage is unknown (do not hide anything). */
  ok: boolean;
}

export async function loadIngredientUsage(
  supabase: SupabaseClient,
  companyId: string
): Promise<IngredientUsageLoad> {
  const [versions, archivedRes] = await Promise.all([
    fetchCostingRecipeVersions(supabase, companyId),
    Promise.resolve(
      supabase
        .from("ingredients")
        .select("id")
        .eq("company_id", companyId)
        .not("archived_at", "is", null)
        .limit(20000)
    ).catch(() => ({ data: null, error: { message: "failed" } })),
  ]);
  const archiveAvailable = !archivedRes.error;
  const archivedIds = new Set(
    ((archivedRes.data ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  const ok = !versions.recipeVersionsError && !versions.componentVersionsError;
  if (!ok) {
    console.error(
      "[ingredient-usage] recipes:",
      versions.recipeVersionsError ?? versions.componentVersionsError
    );
  }
  const usage = computeIngredientUsage({
    menuVersionsByMenuItemId: versions.menuRecipeVersionsByMenuItemId,
    menuInputsByVersionId: versions.menuRecipeVersionInputsByVersionId,
    componentVersionsByComponentId:
      versions.componentRecipeVersionsByComponentId,
    componentInputsByVersionId:
      versions.componentRecipeVersionInputsByVersionId,
  });
  return { ...usage, archivedIds, archiveAvailable, ok };
}
