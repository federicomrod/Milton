// R1-15i: which ingredients are en uso. An ingredient is in use when an
// ACTIVE recipe line references it: a dish's recipe, or a preparation that an
// active dish uses (directly or through other preparations). Active = the
// newest version of each recipe (approved or still being reviewed: someone
// is working on it). Pure, so the rules are pinned by tests.

import type {
  CostingComponentRecipeVersion,
  CostingMenuRecipeVersion,
  CostingRecipeInput,
} from "@/lib/restaurant/costing";

export interface UsageInput {
  menuVersionsByMenuItemId: ReadonlyMap<
    string,
    readonly Pick<
      CostingMenuRecipeVersion,
      "id" | "version_number" | "status"
    >[]
  >;
  menuInputsByVersionId: ReadonlyMap<string, readonly CostingRecipeInput[]>;
  componentVersionsByComponentId: ReadonlyMap<
    string,
    readonly Pick<
      CostingComponentRecipeVersion,
      "id" | "version_number" | "status"
    >[]
  >;
  componentInputsByVersionId: ReadonlyMap<
    string,
    readonly CostingRecipeInput[]
  >;
}

const active = <T extends { version_number: number; status: string }>(
  versions: readonly T[] | undefined
): T | null => {
  const live = (versions ?? []).filter((v) => v.status !== "archived");
  return live.sort((a, b) => b.version_number - a.version_number)[0] ?? null;
};

export interface IngredientUsage {
  /** Ingredient ids referenced by an active recipe line. */
  inUse: Set<string>;
  /** How many active dishes use each ingredient (directly or through a preparation). */
  dishCount: Map<string, number>;
}

export function computeIngredientUsage(input: UsageInput): IngredientUsage {
  // Ingredients each preparation needs (its own lines + nested preparations),
  // memoised; a loop in the data cannot hang it.
  const compIngredients = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const ingredientsOfComponent = (componentId: string): Set<string> => {
    const known = compIngredients.get(componentId);
    if (known) return known;
    const out = new Set<string>();
    if (visiting.has(componentId)) return out;
    visiting.add(componentId);
    const version = active(
      input.componentVersionsByComponentId.get(componentId)
    );
    for (const line of version
      ? (input.componentInputsByVersionId.get(version.id) ?? [])
      : []) {
      if (line.input_type === "ingredient" && line.ingredient_id)
        out.add(line.ingredient_id);
      if (line.input_type === "component" && line.component_id)
        for (const id of ingredientsOfComponent(line.component_id)) out.add(id);
    }
    visiting.delete(componentId);
    compIngredients.set(componentId, out);
    return out;
  };

  const inUse = new Set<string>();
  const dishCount = new Map<string, number>();
  for (const versions of input.menuVersionsByMenuItemId.values()) {
    const version = active(versions);
    if (!version) continue;
    const used = new Set<string>();
    for (const line of input.menuInputsByVersionId.get(version.id) ?? []) {
      if (line.input_type === "ingredient" && line.ingredient_id)
        used.add(line.ingredient_id);
      if (line.input_type === "component" && line.component_id)
        for (const id of ingredientsOfComponent(line.component_id))
          used.add(id);
    }
    for (const id of used) {
      inUse.add(id);
      dishCount.set(id, (dishCount.get(id) ?? 0) + 1);
    }
  }
  return { inUse, dishCount };
}

export type UsageFilter = "en_uso" | "sin_uso" | "todos";

export interface UsageItem {
  id: string;
  price: number | null;
  inUse: boolean;
  archived: boolean;
}

/** An archived ingredient that a recipe uses again is simply in use (it comes back by itself). */
export function usageState(
  ingredientId: string,
  usage: Pick<IngredientUsage, "inUse">,
  archivedIds: ReadonlySet<string>
): { inUse: boolean; archived: boolean } {
  const inUse = usage.inUse.has(ingredientId);
  return { inUse, archived: !inUse && archivedIds.has(ingredientId) };
}

export function usageCounts(items: readonly UsageItem[]) {
  const inUse = items.filter((i) => i.inUse);
  const unused = items.filter((i) => !i.inUse);
  return {
    en_uso: inUse.length,
    sin_uso: unused.length,
    todos: items.length,
    /** "Falta precio" counts only ingredients that are in use. */
    falta_precio: inUse.filter((i) => i.price === null).length,
    /** What "Archivar sin uso (N)" would archive. */
    archivable: unused.filter((i) => !i.archived).length,
    archived: unused.filter((i) => i.archived).length,
  };
}

export function matchesUsage(item: UsageItem, filter: UsageFilter): boolean {
  if (filter === "todos") return true;
  return filter === "en_uso" ? item.inUse : !item.inUse;
}
