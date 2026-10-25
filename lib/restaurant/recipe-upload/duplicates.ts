// lib/restaurant/recipe-upload/duplicates.ts
//
// «Is this uploaded recipe already approved?» An uploaded recipe never edits
// an approved one: a draft is still created, pointed at the dish, and a
// confirm becomes a NEW in_review version. This module only finds the match.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import { foldDishName } from "./marker";

export interface ApprovedDish {
  /** null for an approved preparation (it has no menu item). */
  menu_item_id: string | null;
  name: string;
}

/** PURE: the approved dish with the same folded name, or null. */
export function findApprovedDuplicate(
  name: string,
  approvedDishes: ApprovedDish[]
): ApprovedDish | null {
  const key = foldDishName(name);
  if (!key) return null;
  return approvedDishes.find((d) => foldDishName(d.name) === key) ?? null;
}

/**
 * This company's menu items whose recipe has an approved version, plus its
 * approved preparations, by name. Company-scoped; read-only.
 */
export async function loadApprovedDishes(
  supabase: SupabaseClient,
  companyId: string
): Promise<ApprovedDish[]> {
  const [items, versions, comps, compVersions] = await Promise.all([
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase.from("menu_items").select("id, name").eq("company_id", companyId)
    ),
    fetchAllRows<{ menu_item_id: string; status: string }>(() =>
      supabase
        .from("recipe_versions")
        .select("menu_item_id, status")
        .eq("company_id", companyId)
    ),
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase
        .from("prepared_components")
        .select("id, name")
        .eq("company_id", companyId)
    ),
    fetchAllRows<{ component_id: string; status: string }>(() =>
      supabase
        .from("component_recipe_versions")
        .select("component_id, status")
        .eq("company_id", companyId)
    ),
  ]);
  if (items.error || versions.error || comps.error || compVersions.error) {
    console.error("[recipe-upload] approved dishes read failed");
    return [];
  }

  const byItem = new Map<string, Array<{ status: string }>>();
  for (const v of versions.rows) {
    const list = byItem.get(v.menu_item_id) ?? [];
    list.push(v);
    byItem.set(v.menu_item_id, list);
  }
  const byComponent = new Map<string, Array<{ status: string }>>();
  for (const v of compVersions.rows) {
    const list = byComponent.get(v.component_id) ?? [];
    list.push(v);
    byComponent.set(v.component_id, list);
  }

  const out: ApprovedDish[] = [];
  for (const item of items.rows) {
    if (hasApprovedVersion(byItem.get(item.id) ?? [])) {
      out.push({ menu_item_id: item.id, name: item.name });
    }
  }
  for (const comp of comps.rows) {
    if (hasApprovedVersion(byComponent.get(comp.id) ?? [])) {
      out.push({ menu_item_id: null, name: comp.name });
    }
  }
  return out;
}
