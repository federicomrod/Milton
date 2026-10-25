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
import { foldDishName } from "@/lib/restaurant/recipe-upload/marker";

export const KITCHEN_DRAFT_VERSION_SOURCE = "kitchen_draft";
export const KITCHEN_DRAFT_VERSION_NOTES = "Receta enviada por cocina";

/**
 * A draft claimed (`confirmed`) with no recipe after this long belongs to a
 * call that died between the claim and the final update: it can be claimed
 * again. Younger claims are a request still being written.
 */
export const STALE_CLAIM_MS = 2 * 60 * 1000;

/** True for a claim that never finished and is old enough to be taken over. */
export function isStaleClaim(
  draft: {
    status?: unknown;
    confirmed_recipe_id?: unknown;
    confirmed_at?: unknown;
  },
  now: number = Date.now()
): boolean {
  if (draft.status !== "confirmed" || draft.confirmed_recipe_id) return false;
  const at =
    typeof draft.confirmed_at === "string"
      ? Date.parse(draft.confirmed_at)
      : NaN;
  return Number.isFinite(at) && now - at >= STALE_CLAIM_MS;
}

/** A dish whose recipe lives only in the old lines (no versions at all). */
export const LEGACY_RECIPE_MESSAGE =
  "Este plato ya tiene una receta guardada. Para no cambiar sus costos, confirma esta receta como plato nuevo o edita la receta desde Menú.";

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

  // Was the draft left half-confirmed by a call that died? (read only; the
  // claim below is the one conditional update that decides.)
  const { data: before } = await admin
    .from("kitchen_recipe_drafts")
    .select("status, portions, confirmed_recipe_id, confirmed_at")
    .eq("id", input.draftId)
    .eq("company_id", companyId)
    .maybeSingle();
  const staleBefore = before ? isStaleClaim(before) : false;
  const staleCutoffIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  // A failed confirm puts the draft back EXACTLY as it was: its status
  // (draft / awaiting_portions) and the portions it had (the claim writes the
  // typed ones). Taking over a stale claim releases to 'draft' as before.
  const releaseTo: Record<string, unknown> =
    before && !staleBefore && typeof before.status === "string"
      ? { status: before.status, portions: before.portions ?? null }
      : { status: "draft" };

  // ONE conditional update: a `draft`, or a stale claim that never finished.
  const { data: claimed, error: claimError } = await admin
    .from("kitchen_recipe_drafts")
    .update({
      status: "confirmed",
      // The portions the reviewer typed (a draft still awaiting them gets
      // them here, in the same conditional update, so a failed confirm never
      // rewrites anything).
      portions: input.portions,
      confirmed_by: input.userId,
      confirmed_at: nowIso,
    })
    .eq("id", input.draftId)
    .eq("company_id", companyId)
    .or(
      `status.in.(draft,awaiting_portions),and(status.eq.confirmed,confirmed_recipe_id.is.null,confirmed_at.lt.${staleCutoffIso})`
    )
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

  // Taking over a dead call's claim: remove the empty kitchen_draft version
  // it may have left on THIS dish's recipe (zero lines, old enough that no
  // live call can still be writing it). Never any other version.
  if (staleBefore && input.menuItemId) {
    try {
      const { data: recipe } = await admin
        .from("recipes")
        .select("id")
        .eq("company_id", companyId)
        .eq("menu_item_id", input.menuItemId)
        .maybeSingle();
      if (recipe) {
        const { data: leftovers } = await admin
          .from("recipe_versions")
          .select("id")
          .eq("company_id", companyId)
          .eq("recipe_id", String(recipe.id))
          .eq("source_type", KITCHEN_DRAFT_VERSION_SOURCE)
          .lt("created_at", staleCutoffIso);
        for (const row of leftovers ?? []) {
          await deleteVersionIfEmpty(admin, companyId, String(row.id));
        }
      }
    } catch {
      // best effort: the new version gets the next free number anyway
    }
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
      if (doomed && createdVersionId) {
        // Ours for certain (we got its id back): remove it with its lines.
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
      } else if (doomed) {
        // Found by lookup only. It may belong to ANOTHER call that took the
        // same version number first (unique key on recipe + number), so it is
        // removed only if it has no lines: a version of ours that died before
        // its lines were written always has none (the route requires a line).
        await deleteVersionIfEmpty(admin, companyId, doomed);
      }
    } catch {
      // best effort: the claim is still released below
    }
    // Release the claim so the manager can try again; remove only the dish
    // this call created (never an existing one).
    await admin
      .from("kitchen_recipe_drafts")
      .update({ ...releaseTo, confirmed_by: null, confirmed_at: null })
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

/** Deletes the version only when it has zero rows in recipe_version_inputs. */
async function deleteVersionIfEmpty(
  admin: SupabaseClient,
  companyId: string,
  versionId: string
): Promise<boolean> {
  const { data: lines } = await admin
    .from("recipe_version_inputs")
    .select("id")
    .eq("company_id", companyId)
    .eq("recipe_version_id", versionId)
    .limit(1);
  if (lines && lines.length > 0) return false;
  await admin
    .from("recipe_versions")
    .delete()
    .eq("company_id", companyId)
    .eq("id", versionId);
  return true;
}

// ---------------------------------------------------------------------------
// «Confirmar como preparación»
//
// A draft marked as preparación (see recipe-upload/marker.ts) is confirmed
// into Menú › Preparaciones through the SAME tables the preparations editor
// uses (prepared_components → component_recipes → component_recipe_versions,
// as editor-store.createPreparation does), by the same CostWorkbookRepo the
// plato path uses. It only ever ADDS an `in_review` version: an existing
// preparation (found by folded name) keeps its name, yield and approved
// version. It writes no price, no recipe / menu_items / menu_recipe_inputs
// row, and nothing in ingredient_cost_entries.
//
// Idempotency key: the version's `source_type` is `kitchen_draft:<draftId>`
// (component_recipe_versions has no notes column and a migration is out of
// scope; source_type is free text that nothing else reads for preparations).
// A second Confirmar finds that version and answers ok with it.
// ---------------------------------------------------------------------------

export const KITCHEN_DRAFT_PREPARATION_SOURCE_PREFIX = "kitchen_draft:";

export function preparationDraftSourceType(draftId: string): string {
  return `${KITCHEN_DRAFT_PREPARATION_SOURCE_PREFIX}${draftId}`;
}

/** The in_review version an earlier Confirmar of this draft created, if any. */
export async function findPreparationConfirmedByDraft(
  admin: SupabaseClient,
  companyId: string,
  draftId: string
): Promise<{
  componentId: string;
  versionId: string;
  status: string;
} | null> {
  const { data } = await admin
    .from("component_recipe_versions")
    .select("id, component_id, status")
    .eq("company_id", companyId)
    .eq("source_type", preparationDraftSourceType(draftId));
  for (const row of data ?? []) {
    // A version with no lines is a call that died half way: not a result.
    const { data: lines } = await admin
      .from("component_recipe_version_inputs")
      .select("id")
      .eq("company_id", companyId)
      .eq("component_recipe_version_id", String(row.id))
      .limit(1);
    if (lines && lines.length > 0) {
      return {
        componentId: String(row.component_id),
        versionId: String(row.id),
        status: String(row.status ?? "in_review"),
      };
    }
  }
  return null;
}

export interface ConfirmPreparationInput {
  companyId: string;
  userId: string;
  draftId: string;
  /** Without the « · preparación» marker. */
  name: string;
  yieldQuantity: number;
  yieldUnit: string;
  lines: ConfirmDraftLine[];
}

export type ConfirmPreparationResult =
  | {
      ok: true;
      componentId: string;
      versionId: string;
      versionNumber: number;
      createdComponent: boolean;
    }
  | { ok: false; status: number; error: string };

export async function confirmKitchenDraftAsPreparation(
  admin: SupabaseClient,
  input: ConfirmPreparationInput,
  repo: CostWorkbookRepo = createSupabaseCostWorkbookRepo(admin)
): Promise<ConfirmPreparationResult> {
  const { companyId } = input;
  const sourceType = preparationDraftSourceType(input.draftId);
  const nowIso = new Date().toISOString();

  const { data: before } = await admin
    .from("kitchen_recipe_drafts")
    .select("status, confirmed_recipe_id, confirmed_at")
    .eq("id", input.draftId)
    .eq("company_id", companyId)
    .maybeSingle();
  const staleBefore = before ? isStaleClaim(before) : false;
  const staleCutoffIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  // A failed confirm puts the draft back as it was (status only: the
  // portions of a preparation draft are never touched).
  const releaseTo: Record<string, unknown> =
    before && !staleBefore && typeof before.status === "string"
      ? { status: before.status }
      : { status: "draft" };

  const { data: claimed, error: claimError } = await admin
    .from("kitchen_recipe_drafts")
    .update({
      status: "confirmed",
      confirmed_by: input.userId,
      confirmed_at: nowIso,
    })
    .eq("id", input.draftId)
    .eq("company_id", companyId)
    .or(
      `status.in.(draft,awaiting_portions),and(status.eq.confirmed,confirmed_recipe_id.is.null,confirmed_at.lt.${staleCutoffIso})`
    )
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

  let createdComponentId: string | null = null;
  let createdHeaderId: string | null = null;
  let createdVersionId: string | null = null;
  try {
    // A leftover version of THIS draft with no lines (a dead call): remove it.
    const { data: leftovers } = await admin
      .from("component_recipe_versions")
      .select("id")
      .eq("company_id", companyId)
      .eq("source_type", sourceType);
    for (const row of leftovers ?? []) {
      await deleteComponentVersionIfEmpty(admin, companyId, String(row.id));
    }

    // Find the preparation by folded name (accents, case, spaces).
    const key = foldDishName(input.name);
    const components = await repo.listComponents(companyId);
    const existing = components.find((c) => foldDishName(c.name) === key);
    let componentId = existing?.id ?? null;
    if (!componentId) {
      const { data: created, error: componentError } = await admin
        .from("prepared_components")
        .insert({
          company_id: companyId,
          name: input.name,
          output_unit: input.yieldUnit,
          status: "active",
          source_type: "manual",
        })
        .select("id")
        .single();
      if (componentError || !created) {
        throw new Error(componentError?.message ?? "component insert failed");
      }
      componentId = String(created.id);
      createdComponentId = componentId;
    }

    // The preparation's recipe header: reused as it is (never renamed or
    // given another yield), or created for a new preparation.
    const headers = existing
      ? (await repo.listComponentRecipes(companyId)).filter(
          (r) => r.component_id === componentId
        )
      : [];
    let headerId = headers[0]?.id ?? null;
    if (!headerId) {
      const { data: header, error: headerError } = await admin
        .from("component_recipes")
        .insert({
          company_id: companyId,
          component_id: componentId,
          name: existing?.name ?? input.name,
          output_quantity: input.yieldQuantity,
          output_unit: existing?.output_unit ?? input.yieldUnit,
          status: "active",
          source_type: "manual",
        })
        .select("id")
        .single();
      if (headerError || !header) {
        throw new Error(headerError?.message ?? "recipe insert failed");
      }
      headerId = String(header.id);
      createdHeaderId = headerId;
    }

    const versions = await repo.listComponentRecipeVersions(
      companyId,
      headerId
    );
    const versionNumber = nextVersionNumber(versions);
    const inputs: RecipeInputSnapshot[] = input.lines.map((line) => ({
      input_type: "ingredient",
      ingredient_id: line.ingredient_id,
      component_id: null,
      quantity: line.total_quantity,
      unit: line.unit,
      notes: null,
    }));
    const version = await repo.insertComponentRecipeVersion({
      companyId,
      componentRecipeId: headerId,
      componentId,
      versionNumber,
      status: "in_review",
      effectiveDate: null,
      outputQuantity: input.yieldQuantity,
      outputUnit: input.yieldUnit,
      sourceType,
      inputs,
    });
    createdVersionId = version.id;

    return {
      ok: true,
      componentId,
      versionId: version.id,
      versionNumber,
      createdComponent: createdComponentId !== null,
    };
  } catch (err) {
    console.error(
      "[kitchen-draft-confirm] preparation failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    // Remove ONLY what this call created. The version carries this draft's
    // key, so it is ours even when the insert threw after writing the row.
    try {
      const { data: ours } = await admin
        .from("component_recipe_versions")
        .select("id")
        .eq("company_id", companyId)
        .eq("source_type", sourceType);
      const doomed = new Set<string>(
        (ours ?? []).map((r) => String(r.id)).filter(Boolean)
      );
      if (createdVersionId) doomed.add(createdVersionId);
      for (const id of doomed) {
        await admin
          .from("component_recipe_version_inputs")
          .delete()
          .eq("company_id", companyId)
          .eq("component_recipe_version_id", id);
        await admin
          .from("component_recipe_versions")
          .delete()
          .eq("company_id", companyId)
          .eq("id", id);
      }
    } catch {
      // best effort: the claim is still released below
    }
    await admin
      .from("kitchen_recipe_drafts")
      .update({ ...releaseTo, confirmed_by: null, confirmed_at: null })
      .eq("id", input.draftId)
      .eq("company_id", companyId);
    if (createdHeaderId) {
      await admin
        .from("component_recipes")
        .delete()
        .eq("id", createdHeaderId)
        .eq("company_id", companyId);
    }
    if (createdComponentId) {
      await admin
        .from("prepared_components")
        .delete()
        .eq("id", createdComponentId)
        .eq("company_id", companyId);
    }
    return { ok: false, status: 500, error: "No pude confirmar la receta." };
  }
}

async function deleteComponentVersionIfEmpty(
  admin: SupabaseClient,
  companyId: string,
  versionId: string
): Promise<void> {
  const { data: lines } = await admin
    .from("component_recipe_version_inputs")
    .select("id")
    .eq("company_id", companyId)
    .eq("component_recipe_version_id", versionId)
    .limit(1);
  if (lines && lines.length > 0) return;
  await admin
    .from("component_recipe_versions")
    .delete()
    .eq("company_id", companyId)
    .eq("id", versionId);
}
