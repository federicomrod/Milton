import {
  calculateComponentCost,
  calculateMenuItemCost,
  type CostingData,
  type CostingRecipeInput,
} from "@/lib/restaurant/costing";
import { nameKey } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import { workbookMatchHeadline, workbookMismatchReason } from "./copy";
import type { CostWorkbookRepo } from "./repo";
import type {
  GroupedRecipe,
  WorkbookCostMatch,
  WorkbookRecipeMatchSummary,
  WorkbookRecipeMismatch,
} from "./types";

/** Match if |Excel − Milton| ≤ max($0.01, 1% of the Excel total). */
export const WORKBOOK_COST_ABS_TOLERANCE = 0.01;
export const WORKBOOK_COST_REL_TOLERANCE = 0.01;

export function workbookCostsMatch(excel: number, milton: number): boolean {
  if (!Number.isFinite(excel) || !Number.isFinite(milton)) return false;
  const tol = Math.max(
    WORKBOOK_COST_ABS_TOLERANCE,
    Math.abs(excel) * WORKBOOK_COST_REL_TOLERANCE
  );
  return Math.abs(excel - milton) <= tol + 1e-9;
}

export function decideWorkbookCostMatch(
  excel: number | null | undefined,
  milton: number | null | undefined
): WorkbookCostMatch | null {
  if (excel == null || !Number.isFinite(excel)) return null;
  if (milton == null || !Number.isFinite(milton)) return "mismatch";
  return workbookCostsMatch(excel, milton) ? "match" : "mismatch";
}

function mismatchReason(
  lang: PreferredLanguage,
  excel: number | null,
  milton: number | null,
  engineMessage?: string
): string {
  const base = workbookMismatchReason(lang, excel, milton);
  if (engineMessage) return `${base} — ${engineMessage}`;
  if (milton == null) {
    return `${base} — ${engineMessage ?? "Milton no pudo costear la receta"}`;
  }
  return base;
}

export async function costingDataFromWorkbookRepo(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<CostingData> {
  const [ingredients, menuItems, recipes, components, componentRecipes] =
    await Promise.all([
      repo.listIngredients(companyId),
      repo.listMenuItems(companyId),
      repo.listRecipes(companyId),
      repo.listComponents(companyId),
      repo.listComponentRecipes(companyId),
    ]);
  const costEntries = await repo.listIngredientCostEntries(
    companyId,
    ingredients.map((row) => row.id)
  );

  const ingredientsById = new Map(
    ingredients.map((row) => [
      row.id,
      { id: row.id, name: row.name, default_unit: row.default_unit },
    ])
  );
  const componentsById = new Map(
    components.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        output_unit: row.output_unit,
        status: "active" as const,
      },
    ])
  );
  const componentRecipesByComponentId = new Map(
    componentRecipes.map((row) => [
      row.component_id,
      {
        id: row.id,
        component_id: row.component_id,
        output_quantity: row.output_quantity,
        output_unit: row.output_unit,
        status: "active" as const,
      },
    ])
  );
  const menuItemsById = new Map(
    menuItems.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        selling_price: row.selling_price ?? null,
        currency: null,
      },
    ])
  );
  const menuRecipesByMenuItemId = new Map(
    recipes.map((row) => [
      row.menu_item_id,
      {
        id: row.id,
        menu_item_id: row.menu_item_id,
        status: "active" as const,
      },
    ])
  );

  const menuRecipeInputsByRecipeId = new Map<string, CostingRecipeInput[]>();
  for (const recipe of recipes) {
    menuRecipeInputsByRecipeId.set(
      recipe.id,
      await repo.listRecipeInputs(companyId, recipe.id)
    );
  }
  const componentRecipeInputsByRecipeId = new Map<
    string,
    CostingRecipeInput[]
  >();
  for (const recipe of componentRecipes) {
    componentRecipeInputsByRecipeId.set(
      recipe.id,
      await repo.listComponentRecipeInputs(companyId, recipe.id)
    );
  }

  const costEntriesByIngredientId = new Map<string, IngredientCostEntry[]>();
  for (const entry of costEntries) {
    const list = costEntriesByIngredientId.get(entry.ingredient_id) ?? [];
    list.push({
      id: entry.id,
      company_id: entry.company_id,
      ingredient_id: entry.ingredient_id,
      supplier_id: entry.supplier_id,
      source_type: entry.source_type,
      source_id: entry.source_id,
      cost_date: entry.cost_date,
      quantity: entry.quantity,
      unit: entry.unit,
      total_cost: entry.total_cost,
      unit_cost: entry.unit_cost,
      normalized_unit: entry.normalized_unit,
      normalized_unit_cost: entry.normalized_unit_cost,
      currency: entry.currency,
      notes: entry.notes ?? undefined,
      created_at: entry.created_at,
    });
    costEntriesByIngredientId.set(entry.ingredient_id, list);
  }

  return {
    ingredientsById,
    componentsById,
    componentRecipesByComponentId,
    componentRecipeInputsByRecipeId,
    menuItemsById,
    menuRecipesByMenuItemId,
    menuRecipeInputsByRecipeId,
    costEntriesByIngredientId,
  };
}

export async function reconcileImportedWorkbookCosts(input: {
  companyId: string;
  repo: CostWorkbookRepo;
  groups: GroupedRecipe[];
  lang?: PreferredLanguage;
}): Promise<WorkbookRecipeMatchSummary> {
  const lang = input.lang ?? "en";
  const data = await costingDataFromWorkbookRepo(input.repo, input.companyId);
  const [menuItems, recipes, components, componentRecipes] = await Promise.all([
    input.repo.listMenuItems(input.companyId),
    input.repo.listRecipes(input.companyId),
    input.repo.listComponents(input.companyId),
    input.repo.listComponentRecipes(input.companyId),
  ]);
  const menuByName = new Map(menuItems.map((row) => [nameKey(row.name), row]));
  const recipeByMenuId = new Map(recipes.map((row) => [row.menu_item_id, row]));
  const componentByName = new Map(
    components.map((row) => [nameKey(row.name), row])
  );
  const componentRecipeByComponentId = new Map(
    componentRecipes.map((row) => [row.component_id, row])
  );

  const mismatches: WorkbookRecipeMismatch[] = [];
  let dishesMatched = 0;
  let dishesTotal = 0;
  let subsMatched = 0;
  let subsTotal = 0;

  for (const group of input.groups) {
    if (group.cost_total == null || !Number.isFinite(group.cost_total)) {
      continue;
    }
    if (group.kind === "sub_recipe") {
      const component = componentByName.get(nameKey(group.name));
      const recipe = component
        ? componentRecipeByComponentId.get(component.id)
        : undefined;
      if (!component || !recipe) continue;
      subsTotal += 1;
      const costed = calculateComponentCost(component.id, data);
      const milton =
        costed.status === "complete" && costed.batch_cost != null
          ? costed.batch_cost
          : null;
      const match = decideWorkbookCostMatch(group.cost_total, milton);
      if (match === "match") subsMatched += 1;
      else {
        mismatches.push({
          kind: "sub_recipe",
          name: group.name,
          excel_cost: group.cost_total,
          milton_cost: milton,
          reason: mismatchReason(
            lang,
            group.cost_total,
            milton,
            costed.issues[0]?.message
          ),
        });
      }
      await input.repo.updateComponentRecipeWorkbookCheck(
        input.companyId,
        recipe.id,
        {
          workbook_cost_total: group.cost_total,
          workbook_unit_price:
            group.price_per_unit ??
            group.price_per_lb ??
            group.price_per_oz ??
            null,
          workbook_computed_cost: milton,
          workbook_cost_match: match,
        }
      );
      continue;
    }

    const menu = menuByName.get(nameKey(group.name));
    const recipe = menu ? recipeByMenuId.get(menu.id) : undefined;
    if (!menu || !recipe) continue;
    dishesTotal += 1;
    const costed = calculateMenuItemCost(menu.id, data);
    const milton =
      costed.status === "complete" && costed.cost != null ? costed.cost : null;
    const match = decideWorkbookCostMatch(group.cost_total, milton);
    if (match === "match") dishesMatched += 1;
    else {
      mismatches.push({
        kind: "recipe",
        name: group.name,
        excel_cost: group.cost_total,
        milton_cost: milton,
        reason: mismatchReason(
          lang,
          group.cost_total,
          milton,
          costed.issues[0]?.message
        ),
      });
    }
    await input.repo.updateRecipeWorkbookCheck(input.companyId, recipe.id, {
      workbook_cost_total: group.cost_total,
      workbook_selling_price: group.selling_price ?? null,
      workbook_computed_cost: milton,
      workbook_cost_match: match,
    });
  }

  return {
    dishes_matched: dishesMatched,
    dishes_total: dishesTotal,
    subs_matched: subsMatched,
    subs_total: subsTotal,
    mismatches,
    headline: workbookMatchHeadline({
      lang,
      dishesMatched,
      dishesTotal,
      subsMatched,
      subsTotal,
    }),
  };
}
