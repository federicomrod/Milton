// Undo one cost upload: put back exactly what its snapshot recorded and
// mark the batch undone. Used by "Deshacer esta carga" (price list and
// dish preparation runs). Refuses when a newer upload owns the same rows.

import type { CostWorkbookRepo } from "./repo";

export async function undoCostImportBatch(
  repo: CostWorkbookRepo,
  companyId: string,
  batchId: string
): Promise<
  | {
      ok: true;
      deleted: number;
      restored: number;
      partial?: boolean;
      warnings?: string[];
    }
  | { ok: false; reason: string }
> {
  const batch = await repo.getBatch(companyId, batchId);
  if (!batch) return { ok: false, reason: "Import batch not found" };
  if (batch.undone_at) return { ok: false, reason: "Import already undone" };

  const snap = batch.undo_snapshot;
  const watchedIds = [
    ...snap.inserted_entry_ids,
    ...snap.updated_entries.map((row) => row.id),
  ];
  const liveEntries = await repo.listCostEntriesByIds(companyId, watchedIds);
  const newerOwns = liveEntries.some(
    (entry) => entry.source_id && entry.source_id !== batchId
  );
  if (newerOwns) {
    return {
      ok: false,
      reason: "A newer import updated these rows. Undo the newer import first.",
    };
  }

  if ((snap.deleted_ingredients ?? []).length > 0) {
    await repo.restoreIngredients(
      snap.deleted_ingredients.map((row) => ({
        id: row.id,
        companyId: companyId,
        name: row.name,
        category: row.category,
        defaultUnit: row.default_unit,
        currentUnitCost: row.current_unit_cost,
        currency: row.currency,
      }))
    );
  }
  if ((snap.deleted_cost_entries ?? []).length > 0) {
    await repo.restoreCostEntries(companyId, snap.deleted_cost_entries);
  }
  if ((snap.deleted_supplier_ingredients ?? []).length > 0) {
    await repo.restoreSupplierIngredientLinks(
      snap.deleted_supplier_ingredients
    );
  }
  if ((snap.deleted_menu_recipe_inputs ?? []).length > 0) {
    await repo.restoreMenuRecipeInputs(snap.deleted_menu_recipe_inputs);
  }
  if ((snap.deleted_component_recipe_inputs ?? []).length > 0) {
    await repo.restoreComponentRecipeInputs(
      snap.deleted_component_recipe_inputs
    );
  }
  await repo.deleteRecipeVersions(
    companyId,
    snap.created_recipe_version_ids ?? []
  );
  await repo.deleteComponentRecipeVersions(
    companyId,
    snap.created_component_recipe_version_ids ?? []
  );
  for (const recipe of snap.updated_recipes ?? []) {
    await repo.replaceRecipeInputs(companyId, recipe.id, recipe.inputs);
    await repo.restoreRecipeHeader(companyId, recipe.id, {
      source_type: recipe.source_type,
      workbook_cost_total: recipe.workbook_cost_total,
      workbook_selling_price: recipe.workbook_selling_price,
      workbook_computed_cost: recipe.workbook_computed_cost,
      workbook_cost_match: recipe.workbook_cost_match,
      workbook_variance_amount: recipe.workbook_variance_amount,
      workbook_variance_pct: recipe.workbook_variance_pct,
    });
  }
  for (const component of snap.updated_components ?? []) {
    await repo.replaceComponentRecipeInputs(
      companyId,
      component.id,
      component.inputs
    );
    if (
      component.component_id &&
      component.output_quantity != null &&
      component.output_unit
    ) {
      await repo.updateComponentYield({
        companyId,
        componentId: component.component_id,
        componentRecipeId: component.id,
        outputQuantity: component.output_quantity,
        outputUnit: component.output_unit,
      });
    }
    await repo.restoreComponentRecipeHeader(companyId, component.id, {
      source_type: component.source_type,
      workbook_cost_total: component.workbook_cost_total,
      workbook_unit_price: component.workbook_unit_price,
      workbook_computed_cost: component.workbook_computed_cost,
      workbook_cost_match: component.workbook_cost_match,
      workbook_variance_amount: component.workbook_variance_amount,
      workbook_variance_pct: component.workbook_variance_pct,
    });
  }
  await repo.deletePosMappings(companyId, snap.created_mapping_ids ?? []);
  await repo.deletePosProductLinks(
    companyId,
    snap.created_pos_product_link_ids ?? []
  );
  const previousLinks = snap.updated_pos_product_links ?? [];
  if (previousLinks.length > 0) {
    await repo.restorePosProductLinks(previousLinks.map((row) => row.before));
  }
  await repo.deleteRecipes(companyId, snap.created_recipe_ids ?? []);
  await repo.deleteMenuItems(companyId, snap.created_menu_item_ids ?? []);
  await repo.deleteComponentRecipes(
    companyId,
    snap.created_component_recipe_ids ?? []
  );

  const warnings: string[] = [];
  try {
    await repo.deleteComponents(companyId, snap.created_component_ids ?? []);
  } catch (err) {
    warnings.push(
      `Could not delete prepared items: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const deleted = await repo.deleteCostEntriesByIds(
    companyId,
    snap.inserted_entry_ids
  );
  await repo.restoreCostEntries(
    companyId,
    snap.updated_entries.map((row) => row.before)
  );
  if (snap.created_ingredient_ids.length > 0) {
    try {
      await repo.deleteIngredients(companyId, snap.created_ingredient_ids);
    } catch (err) {
      warnings.push(
        `Could not delete ingredients: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (snap.ingredient_costs_before.length > 0) {
    await repo.updateIngredientCosts(
      snap.ingredient_costs_before.map((row) => ({
        ingredientId: row.id,
        currentUnitCost: row.current_unit_cost,
        currency: row.currency,
      }))
    );
  }
  if ((snap.ingredient_categories_before ?? []).length > 0) {
    await repo.updateIngredientCategories(
      snap.ingredient_categories_before.map((row) => ({
        ingredientId: row.id,
        category: row.category,
      }))
    );
  }
  if (warnings.length > 0) {
    await repo.updateBatchSnapshot(companyId, batchId, {
      ...snap,
      undo_errors: warnings,
    });
  }
  await repo.markBatchUndone(companyId, batchId);
  if (warnings.length > 0) {
    return {
      ok: true,
      deleted,
      restored: snap.updated_entries.length,
      partial: true,
      warnings,
    };
  }
  return { ok: true, deleted, restored: snap.updated_entries.length };
}
