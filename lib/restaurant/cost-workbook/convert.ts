import { matchesPreparedName } from "./prepared";
import type { CostWorkbookRepo } from "./repo";
import type { DeletedIngredientSnapshot, UndoSnapshot } from "./types";
import { emptyUndoSnapshot } from "./types";

export async function retireImportedPreparedIngredients(input: {
  companyId: string;
  preparedNames: string[];
  repo: CostWorkbookRepo;
}): Promise<UndoSnapshot> {
  const changes = emptyUndoSnapshot();
  if (input.preparedNames.length === 0) return changes;

  const ingredients = await input.repo.listIngredients(input.companyId);
  const matches = ingredients.filter((item) =>
    matchesPreparedName(item.name, input.preparedNames)
  );
  if (matches.length === 0) return changes;

  const importedEntries = await input.repo.findWorkbookCostEntries({
    companyId: input.companyId,
    ingredientIds: matches.map((item) => item.id),
  });
  const importedIds = new Set(importedEntries.map((row) => row.ingredient_id));
  const toRetire = matches.filter((item) => importedIds.has(item.id));
  if (toRetire.length === 0) return changes;

  const retireIds = toRetire.map((item) => item.id);
  const entries = importedEntries.filter((row) =>
    retireIds.includes(row.ingredient_id)
  );
  changes.deleted_ingredients = toRetire.map(
    (item): DeletedIngredientSnapshot => ({
      id: item.id,
      company_id: input.companyId,
      name: item.name,
      category: item.category ?? null,
      default_unit: item.default_unit,
      current_unit_cost: item.current_unit_cost,
      currency: item.currency,
    })
  );
  changes.deleted_cost_entries = entries.map((row) => ({ ...row }));

  await input.repo.detachIngredientInputs(input.companyId, retireIds);
  await input.repo.deleteCostEntriesByIds(
    input.companyId,
    entries.map((row) => row.id)
  );
  await input.repo.deleteIngredients(input.companyId, retireIds);
  return changes;
}
