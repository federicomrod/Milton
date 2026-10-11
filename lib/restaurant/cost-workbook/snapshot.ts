import {
  emptyUndoSnapshot,
  type CostWorkbookCostEntry,
  type DeletedIngredientSnapshot,
  type DetachedRecipeInputSnapshot,
  type SupplierIngredientSnapshot,
  type UndoSnapshot,
} from "./types";

export function costMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function costMonthStart(isoDate: string): string {
  const key = costMonthKey(isoDate);
  return key.length === 7 ? `${key}-01` : isoDate;
}

export function costMonthEndExclusive(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (!year || !month) return isoDate;
  if (month === 12) return `${year + 1}-01-01`;
  const next = month + 1;
  return `${year}-${next < 10 ? `0${next}` : String(next)}-01`;
}

export function cloneCostEntry(
  entry: CostWorkbookCostEntry
): CostWorkbookCostEntry {
  return { ...entry };
}

export function mergeUndoSnapshots(
  base: UndoSnapshot | null | undefined,
  extra: UndoSnapshot
): UndoSnapshot {
  const start = base ?? emptyUndoSnapshot();
  const seenCosts = new Set(start.ingredient_costs_before.map((r) => r.id));
  const ingredientCosts = [...start.ingredient_costs_before];
  for (const row of extra.ingredient_costs_before) {
    if (seenCosts.has(row.id)) continue;
    seenCosts.add(row.id);
    ingredientCosts.push(row);
  }
  return {
    inserted_entry_ids: [
      ...start.inserted_entry_ids,
      ...extra.inserted_entry_ids,
    ],
    updated_entries: [...start.updated_entries, ...extra.updated_entries],
    created_ingredient_ids: [
      ...start.created_ingredient_ids,
      ...extra.created_ingredient_ids,
    ],
    ingredient_costs_before: ingredientCosts,
    created_menu_item_ids: [
      ...start.created_menu_item_ids,
      ...extra.created_menu_item_ids,
    ],
    created_recipe_ids: [
      ...start.created_recipe_ids,
      ...extra.created_recipe_ids,
    ],
    created_component_ids: [
      ...start.created_component_ids,
      ...extra.created_component_ids,
    ],
    created_component_recipe_ids: [
      ...start.created_component_recipe_ids,
      ...extra.created_component_recipe_ids,
    ],
    created_mapping_ids: [
      ...start.created_mapping_ids,
      ...extra.created_mapping_ids,
    ],
    updated_recipes: [...start.updated_recipes, ...extra.updated_recipes],
    updated_components: [
      ...start.updated_components,
      ...extra.updated_components,
    ],
    deleted_ingredients: [
      ...(start.deleted_ingredients ?? []),
      ...(extra.deleted_ingredients ?? []),
    ],
    deleted_cost_entries: [
      ...(start.deleted_cost_entries ?? []),
      ...(extra.deleted_cost_entries ?? []),
    ],
    deleted_menu_recipe_inputs: uniqueById([
      ...(start.deleted_menu_recipe_inputs ?? []),
      ...(extra.deleted_menu_recipe_inputs ?? []),
    ]),
    deleted_component_recipe_inputs: uniqueById([
      ...(start.deleted_component_recipe_inputs ?? []),
      ...(extra.deleted_component_recipe_inputs ?? []),
    ]),
    deleted_supplier_ingredients: uniqueById([
      ...(start.deleted_supplier_ingredients ?? []),
      ...(extra.deleted_supplier_ingredients ?? []),
    ]),
    ingredient_categories_before: uniqueById([
      ...(start.ingredient_categories_before ?? []),
      ...(extra.ingredient_categories_before ?? []),
    ]),
    undo_errors: [...(start.undo_errors ?? []), ...(extra.undo_errors ?? [])],
  };
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function snapshotFromUnknown(value: unknown): UndoSnapshot {
  if (!value || typeof value !== "object") return emptyUndoSnapshot();
  const raw = value as Partial<UndoSnapshot>;
  return {
    inserted_entry_ids: Array.isArray(raw.inserted_entry_ids)
      ? raw.inserted_entry_ids.map(String)
      : [],
    updated_entries: Array.isArray(raw.updated_entries)
      ? raw.updated_entries.filter(
          (row): row is UndoSnapshot["updated_entries"][number] =>
            Boolean(
              row && typeof row === "object" && "id" in row && "before" in row
            )
        )
      : [],
    created_ingredient_ids: Array.isArray(raw.created_ingredient_ids)
      ? raw.created_ingredient_ids.map(String)
      : [],
    ingredient_costs_before: Array.isArray(raw.ingredient_costs_before)
      ? raw.ingredient_costs_before.filter(
          (row): row is UndoSnapshot["ingredient_costs_before"][number] =>
            Boolean(row && typeof row === "object" && "id" in row)
        )
      : [],
    created_menu_item_ids: Array.isArray(raw.created_menu_item_ids)
      ? raw.created_menu_item_ids.map(String)
      : [],
    created_recipe_ids: Array.isArray(raw.created_recipe_ids)
      ? raw.created_recipe_ids.map(String)
      : [],
    created_component_ids: Array.isArray(raw.created_component_ids)
      ? raw.created_component_ids.map(String)
      : [],
    created_component_recipe_ids: Array.isArray(
      raw.created_component_recipe_ids
    )
      ? raw.created_component_recipe_ids.map(String)
      : [],
    created_mapping_ids: Array.isArray(raw.created_mapping_ids)
      ? raw.created_mapping_ids.map(String)
      : [],
    updated_recipes: Array.isArray(raw.updated_recipes)
      ? raw.updated_recipes.filter(
          (row): row is UndoSnapshot["updated_recipes"][number] =>
            Boolean(
              row && typeof row === "object" && "id" in row && "inputs" in row
            )
        )
      : [],
    updated_components: Array.isArray(raw.updated_components)
      ? raw.updated_components.filter(
          (row): row is UndoSnapshot["updated_components"][number] =>
            Boolean(
              row && typeof row === "object" && "id" in row && "inputs" in row
            )
        )
      : [],
    deleted_ingredients: Array.isArray(raw.deleted_ingredients)
      ? raw.deleted_ingredients.filter(
          (row): row is DeletedIngredientSnapshot =>
            Boolean(
              row && typeof row === "object" && "id" in row && "name" in row
            )
        )
      : [],
    deleted_cost_entries: Array.isArray(raw.deleted_cost_entries)
      ? raw.deleted_cost_entries.filter((row): row is CostWorkbookCostEntry =>
          Boolean(
            row &&
            typeof row === "object" &&
            "id" in row &&
            "ingredient_id" in row
          )
        )
      : [],
    deleted_menu_recipe_inputs: Array.isArray(raw.deleted_menu_recipe_inputs)
      ? raw.deleted_menu_recipe_inputs.filter(
          (row): row is DetachedRecipeInputSnapshot =>
            Boolean(row && typeof row === "object" && "id" in row)
        )
      : [],
    deleted_component_recipe_inputs: Array.isArray(
      raw.deleted_component_recipe_inputs
    )
      ? raw.deleted_component_recipe_inputs.filter(
          (row): row is DetachedRecipeInputSnapshot =>
            Boolean(row && typeof row === "object" && "id" in row)
        )
      : [],
    deleted_supplier_ingredients: Array.isArray(
      raw.deleted_supplier_ingredients
    )
      ? raw.deleted_supplier_ingredients.filter(
          (row): row is SupplierIngredientSnapshot =>
            Boolean(
              row &&
              typeof row === "object" &&
              "id" in row &&
              "ingredient_id" in row
            )
        )
      : [],
    undo_errors: Array.isArray(raw.undo_errors)
      ? raw.undo_errors.map(String)
      : [],
    ingredient_categories_before: Array.isArray(
      raw.ingredient_categories_before
    )
      ? raw.ingredient_categories_before.filter(
          (row): row is UndoSnapshot["ingredient_categories_before"][number] =>
            Boolean(row && typeof row === "object" && "id" in row)
        )
      : [],
  };
}
