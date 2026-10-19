// lib/restaurant/telegram/kitchen-draft-confirm.ts
//
// «Confirmar» on a recipe a cook sent through Telegram. Confirming is NOT
// approving: it adds a NEW recipe version in status `in_review` for the dish,
// through the same version path the Excel importer and the recipe editor use.
// Nothing counts in Costos or margins until someone with the approval role
// approves that version in the normal flow.
//
// What it never does: delete or edit existing recipe lines, change an
// approved/manual version, rename or change the status of an existing recipe,
// or touch another company's rows. Every query is filtered by company_id.
//
// LEGACY: the SQL function public.confirm_kitchen_recipe_draft (migration 024)
// used to do this work. It REPLACED a dish's recipe lines and wrote a 0 price
// for new dishes, so it is no longer called. The function is still in the
// database (no migration); it is unused and can be dropped later.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseCostWorkbookRepo,
  type CostWorkbookRepo,
} from "@/lib/restaurant/cost-workbook/repo";
import type { RecipeInputSnapshot } from "@/lib/restaurant/cost-workbook/types";
import { nextVersionNumber } from "@/lib/restaurant/recipe-versions";

export const KITCHEN_DRAFT_VERSION_SOURCE = "kitchen_draft";
export const KITCHEN_DRAFT_VERSION_NOTES = "Receta enviada por cocina";

/** A dish whose recipe lives only in the old lines (no versions at all). */
export const LEGACY_RECIPE_MESSAGE =
  "Este platillo ya tiene una receta guardada. Para no cambiar sus costos, confirma esta receta como platillo nuevo o edita la receta desde Menú.";

/**
 * menu_items.selling_price is NOT NULL (default 0) and a migration is out of
 * scope, so «no price yet» is stored as 0 — the column's own «not set». The
 * costing and every screen treat a price of 0 or less as «Sin precio», never
 * as a real $0 price. A price is stored only when the manager typed one.
 */
export function menuItemPriceToStore(typed: number | null | undefined): number {
  return typeof typed === "number" && Number.isFinite(typed) && typed > 0
    ? Math.round(typed * 100) / 100
    : 0;
}

export interface ConfirmDraftLine {
  ingredient_id: string;
  /** Total for the whole batch; the recipe stores it per portion. */
  total_quantity: number;
  unit: string;
}

export interface ConfirmDraftInput {
  companyId: string;
  userId: string;
  draftId: string;
  dishName: string;
  portions: number;
  /** An existing dish of this company, or null to create a new one. */
  menuItemId: string | null;
  /** Only used for a NEW dish; null/0 = «Sin precio». */
  sellingPrice: number | null;
  currency: string | null;
  lines: ConfirmDraftLine[];
}

export type ConfirmDraftResult =
  | {
      ok: true;
      recipeId: string;
      menuItemId: string;
      versionId: string;
      versionNumber: number;
      createdMenuItem: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Writes the new in_review version. The draft is claimed first (draft →
 * confirmed, only if it is still `draft`) so a double click cannot create two
 * versions; if anything fails afterwards the claim is released.
 */
export async function confirmKitchenDraftAsVersion(
  admin: SupabaseClient,
  input: ConfirmDraftInput,
  repo: CostWorkbookRepo = createSupabaseCostWorkbookRepo(admin)
): Promise<ConfirmDraftResult> {
  const { companyId } = input;
  const nowIso = new Date().toISOString();

  // A dish with an old-style recipe (lines in menu_recipe_inputs, no version
  // at all) is costed from those lines. The costing ignores them as soon as
  // the dish has ANY version that is not approved, so adding an in_review
  // version here would silently remove its cost and margin. Checked BEFORE
  // the draft is claimed; nothing is created or approved from the old lines.
  if (input.menuItemId) {
    const { data: recipe } = await admin
      .from("recipes")
      .select("id")
      .eq("company_id", companyId)
      .eq("menu_item_id", input.menuItemId)
      .maybeSingle();
    if (recipe) {
      const versions = await repo.listRecipeVersions(
        companyId,
        String(recipe.id)
      );
      if (versions.length === 0) {
        const { data: legacy } = await admin
          .from("menu_recipe_inputs")
          .select("id")
          .eq("company_id", companyId)
          .eq("recipe_id", String(recipe.id))
          .limit(1);
        if (legacy && legacy.length > 0) {
          return { ok: false, status: 409, error: LEGACY_RECIPE_MESSAGE };
        }
      }
    }
  }

  const { data: claimed, error: claimError } = await admin
    .from("kitchen_recipe_drafts")
    .update({
      status: "confirmed",
      confirmed_by: input.userId,
      confirmed_at: nowIso,
    })
    .eq("id", input.draftId)
    .eq("company_id", companyId)
    .eq("status", "draft")
    .select("id");
  if (claimError) {
    return { ok: false, status: 500, error: "No pude confirmar la receta." };
  }
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Esta receta ya no está pendiente de revisar.",
    };
  }

  let createdMenuItemId: string | null = null;
  let createdRecipeId: string | null = null;
  let createdVersionId: string | null = null;
  let attemptedVersion: { recipeId: string; versionNumber: number } | null =
    null;
  try {
    let menuItemId = input.menuItemId;
    if (!menuItemId) {
      const { data: created, error: menuError } = await admin
        .from("menu_items")
        .insert({
          company_id: companyId,
          name: input.dishName,
          category: "Main",
          selling_price: menuItemPriceToStore(input.sellingPrice),
          ...(input.currency ? { currency: input.currency } : {}),
          source_type: "manual",
        })
        .select("id")
        .single();
      if (menuError || !created) {
        throw new Error(menuError?.message ?? "menu item insert failed");
      }
      menuItemId = String(created.id);
      createdMenuItemId = menuItemId;
    }

    // The dish's recipe header: reused as it is, or created for a new dish.
    // An existing header is never renamed or re-activated.
    const { data: existingRecipe, error: recipeLookupError } = await admin
      .from("recipes")
      .select("id")
      .eq("company_id", companyId)
      .eq("menu_item_id", menuItemId)
      .maybeSingle();
    if (recipeLookupError) throw new Error(recipeLookupError.message);
    let recipeId = existingRecipe ? String(existingRecipe.id) : null;
    if (!recipeId) {
      const { data: createdRecipe, error: recipeError } = await admin
        .from("recipes")
        .insert({
          company_id: companyId,
          menu_item_id: menuItemId,
          name: input.dishName,
          status: "draft",
          source_type: "manual",
        })
        .select("id")
        .single();
      if (recipeError || !createdRecipe) {
        throw new Error(recipeError?.message ?? "recipe insert failed");
      }
      recipeId = String(createdRecipe.id);
      createdRecipeId = recipeId;
    }

    const versions = await repo.listRecipeVersions(companyId, recipeId);
    const versionNumber = nextVersionNumber(versions);
    const inputs: RecipeInputSnapshot[] = input.lines.map((line) => ({
      input_type: "ingredient",
      ingredient_id: line.ingredient_id,
      component_id: null,
      quantity: line.total_quantity / input.portions,
      unit: line.unit,
      notes: null,
    }));
    attemptedVersion = { recipeId, versionNumber };
    const version = await repo.insertRecipeVersion({
      companyId,
      recipeId,
      menuItemId,
      versionNumber,
      status: "in_review",
      effectiveDate: null,
      sourceType: KITCHEN_DRAFT_VERSION_SOURCE,
      notes: KITCHEN_DRAFT_VERSION_NOTES,
      inputs,
    });
    createdVersionId = version.id;

    const { error: finishError } = await admin
      .from("kitchen_recipe_drafts")
      .update({
        confirmed_recipe_id: recipeId,
        menu_item_id: menuItemId,
        dish_name: input.dishName,
        portions: input.portions,
      })
      .eq("id", input.draftId)
      .eq("company_id", companyId);
    if (finishError) throw new Error(finishError.message);

    return {
      ok: true,
      recipeId,
      menuItemId,
      versionId: version.id,
      versionNumber,
      createdMenuItem: createdMenuItemId !== null,
    };
  } catch (err) {
    console.error(
      "[kitchen-draft-confirm] failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    // Remove ONLY the version this call created (its inputs go with it), so
    // no orphan in_review version is left behind. When the insert threw after
    // the version row was written, it is found by company + recipe + the
    // number we tried + our source; no other version is ever touched.
    try {
      let doomed = createdVersionId;
      if (!doomed && attemptedVersion) {
        const { data: found } = await admin
          .from("recipe_versions")
          .select("id")
          .eq("company_id", companyId)
          .eq("recipe_id", attemptedVersion.recipeId)
          .eq("version_number", attemptedVersion.versionNumber)
          .eq("source_type", KITCHEN_DRAFT_VERSION_SOURCE)
          .maybeSingle();
        doomed = found ? String(found.id) : null;
      }
      if (doomed) {
        await admin
          .from("recipe_version_inputs")
          .delete()
          .eq("company_id", companyId)
          .eq("recipe_version_id", doomed);
        await admin
          .from("recipe_versions")
          .delete()
          .eq("company_id", companyId)
          .eq("id", doomed);
      }
    } catch {
      // best effort: the claim is still released below
    }
    // Release the claim so the manager can try again; remove only the dish
    // this call created (never an existing one).
    await admin
      .from("kitchen_recipe_drafts")
      .update({ status: "draft", confirmed_by: null, confirmed_at: null })
      .eq("id", input.draftId)
      .eq("company_id", companyId);
    if (createdRecipeId) {
      await admin
        .from("recipes")
        .delete()
        .eq("id", createdRecipeId)
        .eq("company_id", companyId);
    }
    if (createdMenuItemId) {
      await admin
        .from("menu_items")
        .delete()
        .eq("id", createdMenuItemId)
        .eq("company_id", companyId);
    }
    return { ok: false, status: 500, error: "No pude confirmar la receta." };
  }
}
