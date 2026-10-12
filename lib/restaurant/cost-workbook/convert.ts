import { matchesPreparedName } from "./prepared";
import type { CostWorkbookRepo } from "./repo";
import { looksLikePreparedItemReason } from "./copy";
import type {
  DeletedIngredientSnapshot,
  ReviewCandidate,
  UndoSnapshot,
} from "./types";
import { emptyUndoSnapshot } from "./types";

export async function retireImportedPreparedIngredients(input: {
  companyId: string;
  preparedNames: string[];
  importedIngredientIds: string[];
  repo: CostWorkbookRepo;
}): Promise<{ changes: UndoSnapshot; hints: ReviewCandidate[] }> {
  const changes = emptyUndoSnapshot();
  const hints: ReviewCandidate[] = [];
  if (input.preparedNames.length === 0) {
    return { changes, hints };
  }

  const ingredients = await input.repo.listIngredients(input.companyId);
  const matches = ingredients.filter((item) =>
    matchesPreparedName(item.name, input.preparedNames)
  );
  if (matches.length === 0) return { changes, hints };

  const importedIds = new Set(input.importedIngredientIds);
  const hintFor = (name: string): ReviewCandidate => ({
    tabName: "ingredients",
    rowIndex: 0,
    reason: looksLikePreparedItemReason("es"),
    raw: { ingredient_name: name },
    suggested: { ingredient_name: name },
  });

  const retireIds: string[] = [];
  for (const item of matches) {
    if (!importedIds.has(item.id)) {
      hints.push(hintFor(item.name));
      continue;
    }
    const usages = await input.repo.listIngredientInputUsages(input.companyId, [
      item.id,
    ]);
    if (usages.some((row) => row.handmade)) {
      hints.push(hintFor(item.name));
      continue;
    }
    const costs = await input.repo.listIngredientCostEntries(input.companyId, [
      item.id,
    ]);
    const handmadeCost = costs.some(
      (row) => row.source_type !== "import" || row.source_id == null
    );
    if (handmadeCost) {
      hints.push(hintFor(item.name));
      continue;
    }
    const links = await input.repo.listSupplierIngredientLinks(
      input.companyId,
      [item.id]
    );
    if (links.length > 0) {
      hints.push(hintFor(item.name));
      continue;
    }

    retireIds.push(item.id);
    const deleted: DeletedIngredientSnapshot = {
      id: item.id,
      company_id: input.companyId,
      name: item.name,
      category: item.category ?? null,
      default_unit: item.default_unit,
      current_unit_cost: item.current_unit_cost,
      currency: item.currency,
    };
    changes.deleted_ingredients.push(deleted);
    changes.deleted_cost_entries.push(...costs.map((row) => ({ ...row })));
    changes.deleted_menu_recipe_inputs.push(
      ...usages.filter((row) => row.kind === "menu").map((row) => row.snapshot)
    );
    changes.deleted_component_recipe_inputs.push(
      ...usages
        .filter((row) => row.kind === "component")
        .map((row) => row.snapshot)
    );
    changes.deleted_supplier_ingredients.push(
      ...links.map((row) => ({ ...row }))
    );
  }

  if (retireIds.length === 0) return { changes, hints };

  await input.repo.detachIngredientInputs(input.companyId, retireIds);
  await input.repo.deleteSupplierIngredientLinks(
    input.companyId,
    changes.deleted_supplier_ingredients.map((row) => row.id)
  );
  await input.repo.deleteCostEntriesByIds(
    input.companyId,
    changes.deleted_cost_entries.map((row) => row.id)
  );
  await input.repo.deleteIngredients(input.companyId, retireIds);
  return { changes, hints };
}

export function importedIngredientIdsFromBatches(
  batches: Array<{ undo_snapshot?: { created_ingredient_ids?: string[] } }>
): string[] {
  const ids = new Set<string>();
  for (const batch of batches) {
    for (const id of batch.undo_snapshot?.created_ingredient_ids ?? []) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
