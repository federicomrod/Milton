// R1-15i: loads what "en uso" needs: the active recipes (dishes and
// preparations) and the archived ingredient ids. Read-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  usageFromUses,
  type IngredientUsage,
} from "@/lib/restaurant/ingredient-usage";
import {
  loadIngredientUses,
  type IngredientUseEntry,
} from "@/lib/restaurant/ingredient-uses-server";

export interface IngredientUsageLoad extends IngredientUsage {
  /** Ids with `archived_at` set (050). */
  archivedIds: Set<string>;
  /** False until migration 050: nothing can be archived yet. */
  archiveAvailable: boolean;
  /** The recipes could be read; false = usage is unknown (do not hide anything). */
  ok: boolean;
  /** Every dish and preparation that uses each ingredient: the SAME list the detail shows. */
  usesByIngredient: Map<string, IngredientUseEntry[]>;
}

export async function loadIngredientUsage(
  supabase: SupabaseClient,
  companyId: string,
  lang: PreferredLanguage = "es"
): Promise<IngredientUsageLoad> {
  const [uses, archivedRes] = await Promise.all([
    loadIngredientUses(supabase, companyId, lang),
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
  return {
    ...usageFromUses(uses.usesByIngredient),
    usesByIngredient: uses.usesByIngredient,
    archivedIds,
    archiveAvailable,
    ok: uses.ok,
  };
}
