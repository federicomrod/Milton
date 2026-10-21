// Loads everything computeIngredientUses needs, for ONE company. Read-only.
// Any read that fails makes the whole answer unknown (ok: false): callers
// then say so instead of claiming "nobody uses this ingredient".

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCostingRecipeVersions } from "@/lib/restaurant/costing-versions";
import {
  computeIngredientUses,
  type IngredientUseEntry,
  type UsesDraft,
  type UsesLine,
} from "@/lib/restaurant/ingredient-uses";
import { fetchAllRowsRetryingWithoutColumn } from "@/lib/restaurant/missing-schema-column";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";

export interface IngredientUsesLoad {
  ok: boolean;
  usesByIngredient: Map<string, IngredientUseEntry[]>;
}

/** A table from a migration that may not be applied yet reads as empty. */
const missing = (e: { message?: string } | null): boolean =>
  !!e && /does not exist|schema cache|relation/i.test(e.message ?? "");

function group<T extends Record<string, unknown>>(
  rows: readonly T[],
  key: keyof T
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = r[key] as string | null;
    if (!k) continue;
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

export async function loadIngredientUses(
  supabase: SupabaseClient,
  companyId: string
): Promise<IngredientUsesLoad> {
  try {
    const [
      versions,
      itemsRes,
      linksRes,
      compsRes,
      recipesRes,
      recipeInputsRes,
      compRecipesRes,
      compInputsRes,
      draftsRes,
      draftLinesRes,
      aliasesRes,
      mergesRes,
    ] = await Promise.all([
      fetchCostingRecipeVersions(supabase, companyId),
      fetchAllRowsRetryingWithoutColumn<{
        id: string;
        name: string;
        odoo_product_id?: number | null;
      }>(
        "odoo_product_id",
        (select) =>
          supabase
            .from("menu_items")
            .select(select)
            .eq("company_id", companyId),
        "id, name, odoo_product_id"
      ),
      fetchAllRows<{ odoo_product_id: number; menu_item_id: string | null }>(
        () =>
          supabase
            .from("pos_product_links")
            .select("odoo_product_id, menu_item_id")
            .eq("company_id", companyId)
      ),
      fetchAllRows<{ id: string; name: string }>(() =>
        supabase
          .from("prepared_components")
          .select("id, name")
          .eq("company_id", companyId)
      ),
      fetchAllRows<{ id: string; menu_item_id: string }>(() =>
        supabase
          .from("recipes")
          .select("id, menu_item_id")
          .eq("company_id", companyId)
      ),
      fetchAllRows<UsesLine & { recipe_id: string }>(() =>
        supabase
          .from("menu_recipe_inputs")
          .select(
            "recipe_id, input_type, ingredient_id, component_id, quantity, unit"
          )
          .eq("company_id", companyId)
      ),
      fetchAllRows<{ id: string; component_id: string }>(() =>
        supabase
          .from("component_recipes")
          .select("id, component_id")
          .eq("company_id", companyId)
      ),
      fetchAllRows<UsesLine & { component_recipe_id: string }>(() =>
        supabase
          .from("component_recipe_inputs")
          .select(
            "component_recipe_id, input_type, ingredient_id, component_id, quantity, unit"
          )
          .eq("company_id", companyId)
      ),
      fetchAllRows<{ id: string; dish_name: string }>(() =>
        supabase
          .from("kitchen_recipe_drafts")
          .select("id, dish_name")
          .eq("company_id", companyId)
          .in("status", ["draft", "awaiting_portions"])
      ),
      fetchAllRows<{
        draft_id: string;
        ingredient_id: string | null;
        raw_name: string;
        total_quantity: number | null;
        unit: string | null;
      }>(() =>
        supabase
          .from("kitchen_recipe_draft_lines")
          .select("draft_id, ingredient_id, raw_name, total_quantity, unit")
          .eq("company_id", companyId)
      ),
      fetchAllRows<{ alias_key: string; ingredient_id: string }>(() =>
        supabase
          .from("ingredient_aliases")
          .select("alias_key, ingredient_id")
          .eq("company_id", companyId)
      ),
      fetchAllRows<{
        survivor_id: string;
        loser_ids: string[];
        undone_at: string | null;
      }>(() =>
        supabase
          .from("ingredient_merges")
          .select("id, survivor_id, loser_ids, undone_at")
          .eq("company_id", companyId)
      ),
    ]);

    const hard = [
      versions.recipeVersionsError,
      versions.componentVersionsError,
      itemsRes.error,
      compsRes.error,
      recipesRes.error,
      recipeInputsRes.error,
      compRecipesRes.error,
      compInputsRes.error,
      draftsRes.error,
      draftLinesRes.error,
      !missing(aliasesRes.error) && aliasesRes.error,
      !missing(mergesRes.error) && mergesRes.error,
      !missing(linksRes.error) && linksRes.error,
    ].filter(Boolean);
    if (hard.length > 0) {
      console.error("[ingredient-uses] read failed:", hard[0]);
      return { ok: false, usesByIngredient: new Map() };
    }

    const odooByItem = new Map<string, number>();
    for (const l of linksRes.error ? [] : linksRes.rows)
      if (l.menu_item_id && Number.isInteger(Number(l.odoo_product_id)))
        odooByItem.set(l.menu_item_id, Number(l.odoo_product_id));
    const dishes = new Map<
      string,
      { name: string; odooProductId: number | null }
    >();
    for (const m of itemsRes.rows)
      dishes.set(m.id, {
        name: m.name,
        odooProductId: m.odoo_product_id ?? odooByItem.get(m.id) ?? null,
      });

    // Excel-imported lines, by dish / preparation.
    const itemOfRecipe = new Map(
      recipesRes.rows.map((r) => [r.id, r.menu_item_id])
    );
    const legacyDishLines = new Map<string, UsesLine[]>();
    for (const l of recipeInputsRes.rows) {
      const item = itemOfRecipe.get(l.recipe_id);
      if (!item) continue;
      legacyDishLines.set(item, [...(legacyDishLines.get(item) ?? []), l]);
    }
    const compOfRecipe = new Map(
      compRecipesRes.rows.map((r) => [r.id, r.component_id])
    );
    const legacyComponentLines = new Map<string, UsesLine[]>();
    for (const l of compInputsRes.rows) {
      const comp = compOfRecipe.get(l.component_recipe_id);
      if (!comp) continue;
      legacyComponentLines.set(comp, [
        ...(legacyComponentLines.get(comp) ?? []),
        l,
      ]);
    }

    const linesByDraft = group(draftLinesRes.rows, "draft_id");
    const drafts: UsesDraft[] = draftsRes.rows.map((d) => ({
      id: d.id,
      dish_name: d.dish_name,
      lines: (linesByDraft.get(d.id) ?? []).map((l) => ({
        ingredient_id: l.ingredient_id,
        raw_name: l.raw_name,
        quantity: l.total_quantity == null ? null : Number(l.total_quantity),
        unit: l.unit,
      })),
    }));

    const mergedInto = new Map<string, string>();
    for (const m of mergesRes.error ? [] : mergesRes.rows)
      if (!m.undone_at)
        for (const id of m.loser_ids ?? []) mergedInto.set(id, m.survivor_id);

    const usesByIngredient = computeIngredientUses({
      dishes,
      dishVersions: versions.menuRecipeVersionsByMenuItemId,
      dishInputsByVersionId: versions.menuRecipeVersionInputsByVersionId,
      legacyDishLines,
      components: new Map(compsRes.rows.map((c) => [c.id, { name: c.name }])),
      componentVersions: versions.componentRecipeVersionsByComponentId,
      componentInputsByVersionId:
        versions.componentRecipeVersionInputsByVersionId,
      legacyComponentLines,
      drafts,
      aliases: new Map(
        (aliasesRes.error ? [] : aliasesRes.rows).map((a) => [
          a.alias_key,
          a.ingredient_id,
        ])
      ),
      mergedInto,
    });
    return { ok: true, usesByIngredient };
  } catch (err) {
    console.error("[ingredient-uses] failed:", err);
    return { ok: false, usesByIngredient: new Map() };
  }
}

export type { IngredientUseEntry };
