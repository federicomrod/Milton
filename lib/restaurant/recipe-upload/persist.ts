// lib/restaurant/recipe-upload/persist.ts
//
// Server: saves the validated recipes of ONE file as drafts in
// kitchen_recipe_drafts (status draft, or awaiting_portions when the portions
// are not clearly written). It NEVER writes recipes, recipe_versions,
// menu_items, menu_recipe_inputs or ingredient_cost_entries: a person reviews
// each draft in «Revisar receta» and confirms it there.
//
// Company and location come from the caller. Writes use the admin client the
// caller passes. Logs: counts only.

import { classifyRecipeKind } from "./classify";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadDraftMatchingCatalog,
  type DraftMatchingCatalog,
} from "@/lib/restaurant/kitchen-draft-catalog";
import {
  createRecipeDraft,
  matchIngredients,
} from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import {
  getOrCreateUploadAuthor,
  UPLOAD_CHAT_ID,
  uploadMessageId,
} from "./author";
import {
  findApprovedDuplicate,
  loadApprovedDishes,
  type ApprovedDish,
} from "./duplicates";
import { withPreparationMarker } from "./marker";
import type { ExtractedUploadRecipe } from "./validate";

export const DRAFT_SAVE_ERROR =
  "No pude guardar algunas recetas. Vuelve a intentarlo.";
const MESSAGE_ID_RETRIES = 5;

export interface PersistResult {
  drafts_created: number;
  duplicates: Array<{ dish_name: string }>;
  preparations: Array<{ dish_name: string }>;
  lines_without_quantity: number;
  errors: string[];
}

export async function persistRecipes(input: {
  admin: SupabaseClient;
  companyId: string;
  locationId: string;
  recipes: ExtractedUploadRecipe[];
  /** Tests / callers may pass an already loaded catalog or approved list. */
  catalog?: DraftMatchingCatalog;
  approved?: ApprovedDish[];
}): Promise<PersistResult> {
  const result: PersistResult = {
    drafts_created: 0,
    duplicates: [],
    preparations: [],
    lines_without_quantity: 0,
    errors: [],
  };
  if (input.recipes.length === 0) return result;

  const { admin, companyId, locationId } = input;

  const author = await getOrCreateUploadAuthor(admin, companyId, locationId);
  if (!author.ok) {
    result.errors.push(DRAFT_SAVE_ERROR);
    return result;
  }

  const catalog =
    input.catalog ?? (await loadDraftMatchingCatalog(admin, companyId));
  const approved =
    input.approved ?? (await loadApprovedDishes(admin, companyId));

  let failed = 0;
  for (let i = 0; i < input.recipes.length; i++) {
    const original = input.recipes[i];
    // Deterministic: what is written overrides the model's kind (classify.ts).
    const classified = classifyRecipeKind({
      yieldText: original.yield_text,
      tabLabel: original.tab_label ?? null,
      modelKind: original.kind,
      modelPortions: original.portions,
    });
    const recipe = {
      ...original,
      kind: classified.kind,
      portions: classified.portions,
    };
    const isPrep = recipe.kind === "preparacion";

    const matched = matchIngredients(
      recipe.ingredients,
      catalog.ingredients,
      catalog.costMap,
      recipe.portions,
      catalog.aliasKeyToId
    );

    const hasUnmatched = matched.some((l) => l.ingredient_id === null);
    const hasLowConf = matched.some((l) => l.confidence === "low");
    let overallConfidence = recipe.overall_confidence;
    if (overallConfidence !== "low" && (hasUnmatched || hasLowConf)) {
      overallConfidence = "low";
    }

    const currencies = new Set(
      matched
        .map((l) =>
          l.ingredient_id
            ? (catalog.costMap.get(l.ingredient_id)?.[0]?.currency ?? null)
            : null
        )
        .filter((c): c is string => c !== null)
    );
    let currency = catalog.currency;
    if (currencies.size === 1) currency = Array.from(currencies)[0];
    else if (currencies.size > 1) overallConfidence = "low";

    // A dish already approved: the draft points at it, so a confirm becomes a
    // NEW in_review version. A preparation matches an approved preparation by
    // name only (menu_item_id stays null).
    const duplicate = findApprovedDuplicate(
      recipe.dish_name,
      approved.filter((d) =>
        isPrep ? d.menu_item_id === null : d.menu_item_id !== null
      )
    );

    const dishName = isPrep
      ? withPreparationMarker(recipe.dish_name)
      : recipe.dish_name;

    let created = false;
    for (let attempt = 0; attempt < MESSAGE_ID_RETRIES; attempt++) {
      const res = await createRecipeDraft(
        {
          companyId,
          locationId,
          staffId: author.staffId,
          kitchenReportId: null,
          chatId: UPLOAD_CHAT_ID,
          messageId: uploadMessageId(i, attempt),
          dishName,
          portions: recipe.portions,
          lines: matched,
          overallConfidence,
          currency,
          menuItemId: !isPrep && duplicate ? duplicate.menu_item_id : null,
        },
        admin
      );
      if (res.ok) {
        created = true;
        break;
      }
      if (res.error !== "duplicate") break;
    }

    if (!created) {
      failed += 1;
      continue;
    }

    result.drafts_created += 1;
    result.lines_without_quantity += matched.filter(
      (l) => l.total_quantity === null
    ).length;
    if (isPrep) result.preparations.push({ dish_name: recipe.dish_name });
    if (duplicate) result.duplicates.push({ dish_name: recipe.dish_name });
  }

  if (failed > 0) result.errors.push(DRAFT_SAVE_ERROR);
  console.log(
    `[recipe-upload] persisted drafts=${result.drafts_created} failed=${failed}`
  );
  return result;
}
