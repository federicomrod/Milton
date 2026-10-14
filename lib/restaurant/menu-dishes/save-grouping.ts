// lib/restaurant/menu-dishes/save-grouping.ts
//
// Save Milton's menu-dish grouping for a company (R1-10). Runs after a
// recipe import or a POS sync (new products) and on "Guardar agrupación";
// never when Platos is just opened. Only variants with no dish and no
// exclusion are written, in a few bulk requests (menu-dishes-server).

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDishEconomicsWith } from "@/lib/restaurant/costing/dish-economics-server";
import { syncMenuDishes, type SyncResult } from "./menu-dishes-server";
import { syncAutoGroups } from "@/lib/restaurant/groups/item-groups";

export type SaveGroupingResult =
  | ({ ok: true } & SyncResult)
  | { ok: true; skipped: "045" | "nada_nuevo" }
  | { ok: false; error: string };

export async function saveMenuGrouping(
  supabase: SupabaseClient,
  companyId: string
): Promise<SaveGroupingResult> {
  const load = await loadDishEconomicsWith(supabase, { companyId });
  if (!load.ok) return { ok: false, error: load.error };
  if (!load.result.menu_dishes_stored) return { ok: true, skipped: "045" };
  if ((load.result.menu_unsaved_variant_count ?? 0) === 0) {
    return { ok: true, skipped: "nada_nuevo" };
  }
  const r = await syncMenuDishes(
    supabase,
    companyId,
    load.result.menu_dishes,
    load.result.excluded_menu_dishes
  );
  // R1-15b: the Plato del menú level of the groups follows (insert-only;
  // nothing happens until 048 is applied).
  await syncAutoGroups(supabase, companyId).catch(() => null);
  return { ok: true, ...r };
}

/** Best effort, after the response (an import must not fail on this). */
export async function saveMenuGroupingQuietly(
  supabase: SupabaseClient,
  companyId: string,
  tag: string
): Promise<void> {
  try {
    const started = Date.now();
    const r = await saveMenuGrouping(supabase, companyId);
    console.info(`[menu-dishes] ${tag} ${Date.now() - started}ms`, r);
  } catch (err) {
    console.error(`[menu-dishes] ${tag} failed:`, err);
  }
}
