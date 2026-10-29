// lib/restaurant/kitchen/kitchen-recipes.ts
//
// The location's approved recipes, as a cook reads them in the app (mobile P1,
// #431). READ ONLY: this file never writes, so an approved recipe can never be
// overwritten from the app. It reuses pickApprovedVersion (the one rule for
// «which version is in force») and selects explicit columns only: no selling
// price, no unit cost, no cost source ever leaves the database, and the
// serializer would drop them anyway.
//
// Service-role client: every query is filtered by the cook's company, and menu
// items by their location (or company-wide, location_id null).

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";
import { serializeKitchenRecipe } from "@/lib/restaurant/kitchen/kitchen-serializer";

export const RECIPES_PAGE_SIZE = 30;

type Recipe = ReturnType<typeof serializeKitchenRecipe>;

interface VersionRow {
  id: string;
  menu_item_id: string;
  version_number: number;
  status: string;
  effective_date: string | null;
  serving_quantity: number | null;
  serving_unit: string | null;
  notes: string | null;
}

interface InputRow {
  recipe_version_id: string;
  input_type: string;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

export function encodeRecipesCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeRecipesCursor(raw: string | null): number | null {
  if (!raw) return 0;
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(raw)) return null;
  const digits = Buffer.from(raw, "base64url").toString("utf8");
  if (!/^\d{1,6}$/.test(digits)) return null;
  return Number(digits);
}

/** Keeps a search term safe inside a PostgREST ilike filter. */
export function cleanRecipeSearch(raw: string | null): string | null {
  const q = (raw ?? "")
    .replace(/[%,()*\\]/g, " ")
    .trim()
    .slice(0, 60);
  return q || null;
}

function stepsOf(notes: string | null): string[] {
  return (notes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function loadKitchenRecipes(
  admin: SupabaseClient,
  scope: { companyId: string; locationId: string },
  opts: { offset: number; search: string | null }
): Promise<
  { ok: true; recipes: Recipe[]; nextOffset: number | null } | { ok: false }
> {
  const { companyId, locationId } = scope;
  let items = admin
    .from("menu_items")
    .select("id, name, category, description")
    .eq("company_id", companyId)
    .eq("status", "active")
    .or(`location_id.eq.${locationId},location_id.is.null`)
    .order("name", { ascending: true })
    .range(opts.offset, opts.offset + RECIPES_PAGE_SIZE);
  if (opts.search) items = items.ilike("name", `%${opts.search}%`);
  const { data: itemRows, error: itemsError } = await items;
  if (itemsError) return { ok: false };

  const all = (itemRows ?? []) as {
    id: string;
    name: string;
    category: string | null;
    description: string | null;
  }[];
  const more = all.length > RECIPES_PAGE_SIZE;
  const page = all.slice(0, RECIPES_PAGE_SIZE);
  const nextOffset = more ? opts.offset + RECIPES_PAGE_SIZE : null;
  if (page.length === 0) return { ok: true, recipes: [], nextOffset };

  const { data: versionRows, error: versionsError } = await admin
    .from("recipe_versions")
    .select(
      "id, menu_item_id, version_number, status, effective_date, serving_quantity, serving_unit, notes"
    )
    .eq("company_id", companyId)
    .in(
      "menu_item_id",
      page.map((i) => i.id)
    );
  if (versionsError) return { ok: false };

  const byItem = new Map<string, VersionRow[]>();
  for (const v of (versionRows ?? []) as VersionRow[]) {
    byItem.set(v.menu_item_id, [...(byItem.get(v.menu_item_id) ?? []), v]);
  }
  const chosen = new Map<string, VersionRow>();
  for (const item of page) {
    const v = pickApprovedVersion(byItem.get(item.id) ?? []);
    if (v) chosen.set(item.id, v);
  }
  if (chosen.size === 0) return { ok: true, recipes: [], nextOffset };

  const { data: inputRows, error: inputsError } = await admin
    .from("recipe_version_inputs")
    .select(
      "recipe_version_id, input_type, ingredient_id, component_id, quantity, unit, notes"
    )
    .eq("company_id", companyId)
    .in(
      "recipe_version_id",
      [...chosen.values()].map((v) => v.id)
    );
  if (inputsError) return { ok: false };
  const inputs = (inputRows ?? []) as InputRow[];

  const ingredientIds = [
    ...new Set(inputs.map((i) => i.ingredient_id).filter(Boolean)),
  ] as string[];
  const componentIds = [
    ...new Set(inputs.map((i) => i.component_id).filter(Boolean)),
  ] as string[];
  const [ingredients, components] = await Promise.all([
    ingredientIds.length
      ? admin
          .from("ingredients")
          .select("id, name")
          .eq("company_id", companyId)
          .in("id", ingredientIds)
      : Promise.resolve({ data: [], error: null }),
    componentIds.length
      ? admin
          .from("prepared_components")
          .select("id, name")
          .eq("company_id", companyId)
          .in("id", componentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ingredients.error || components.error) return { ok: false };
  const names = new Map<string, string>();
  for (const r of [...(ingredients.data ?? []), ...(components.data ?? [])]) {
    names.set(r.id as string, r.name as string);
  }

  const recipes: Recipe[] = [];
  for (const item of page) {
    const version = chosen.get(item.id);
    if (!version) continue;
    recipes.push(
      serializeKitchenRecipe({
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        yield:
          version.serving_quantity && version.serving_unit
            ? { quantity: version.serving_quantity, unit: version.serving_unit }
            : null,
        ingredients: inputs
          .filter((i) => i.recipe_version_id === version.id)
          .map((i) => ({
            name:
              names.get((i.ingredient_id ?? i.component_id) as string) ?? "",
            quantity: i.quantity,
            unit: i.unit,
            note: i.notes,
          }))
          .filter((i) => i.name),
        steps: stepsOf(version.notes),
      })
    );
  }
  return { ok: true, recipes, nextOffset };
}
