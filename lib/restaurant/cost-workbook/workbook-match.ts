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
import { pickMenuItemForLocation } from "./persist-recipes";
import type { CostWorkbookRepo } from "./repo";
import type {
  GroupedRecipe,
  WorkbookCostMatch,
  WorkbookRecipeMatchSummary,
  WorkbookRecipeMismatch,
} from "./types";

function subYieldUnconfirmed(group: GroupedRecipe): boolean {
  if (group.kind !== "sub_recipe") return false;
  return Boolean(
    group.yield_assumed || group.output_quantity == null || !group.output_unit
  );
}
import {
  decideWorkbookCostMatch,
  workbookCostsMatch,
  workbookVarianceFields,
  WORKBOOK_COST_ABS_TOLERANCE,
  WORKBOOK_COST_REL_TOLERANCE,
} from "./variance";

export {
  decideWorkbookCostMatch,
  workbookCostsMatch,
  workbookVarianceFields,
  WORKBOOK_COST_ABS_TOLERANCE,
  WORKBOOK_COST_REL_TOLERANCE,
};

function mismatchReason(
  lang: PreferredLanguage,
  excel: number | null,
  milton: number | null,
  engineMessage?: string
): string {
  const base = workbookMismatchReason(lang, excel, milton);
  const extra =
    engineMessage?.trim() ||
    (milton == null
      ? lang === "es"
        ? "No pude costear la receta."
        : "I could not cost the recipe."
      : "");
  if (!extra) return base;
  return `${base} ${extra}`.replace(/\s+/g, " ").trim();
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
        source_type: row.source_type,
        // Recompute the Excel check from live costs. A stored mismatch
        // would otherwise block costing and lock the recipe as mismatch.
        workbook_cost_match: null,
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
      effective_date: entry.effective_date ?? entry.cost_date,
      date_source: entry.date_source ?? "upload",
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
  locationId?: string | null;
}): Promise<WorkbookRecipeMatchSummary> {
  const lang = input.lang ?? "en";
  const data = await costingDataFromWorkbookRepo(input.repo, input.companyId);
  const [menuItems, recipes, components, componentRecipes] = await Promise.all([
    input.repo.listMenuItems(input.companyId),
    input.repo.listRecipes(input.companyId),
    input.repo.listComponents(input.companyId),
    input.repo.listComponentRecipes(input.companyId),
  ]);
  const recipeByMenuId = new Map(recipes.map((row) => [row.menu_item_id, row]));
  // prepared_components have no location_id in the schema, so sub-recipe
  // match stays company-wide. Menu dishes are scoped to the selected
  // restaurant when menu_items.location_id is set.
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
  const unconfirmedSubs = new Set(
    input.groups.filter(subYieldUnconfirmed).map((group) => nameKey(group.name))
  );
  const usesUnconfirmedSub = (group: GroupedRecipe) =>
    group.lines.some((line) =>
      unconfirmedSubs.has(nameKey(line.ingredient_name))
    );

  for (const group of input.groups) {
    if (
      group.cost_total_inferred ||
      group.cost_total == null ||
      !Number.isFinite(group.cost_total)
    ) {
      continue;
    }
    if (group.kind === "sub_recipe") {
      const component = componentByName.get(nameKey(group.name));
      const recipe = component
        ? componentRecipeByComponentId.get(component.id)
        : undefined;
      if (!component || !recipe) continue;
      if (recipe.source_type !== "import") continue;
      if (subYieldUnconfirmed(group)) {
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
            workbook_computed_cost: null,
            workbook_cost_match: null,
            workbook_variance_amount: null,
            workbook_variance_pct: null,
          }
        );
        continue;
      }
      subsTotal += 1;
      const costed = calculateComponentCost(component.id, data);
      const milton =
        costed.status === "complete" && costed.batch_cost != null
          ? costed.batch_cost
          : null;
      const match = decideWorkbookCostMatch(group.cost_total, milton);
      const variance = workbookVarianceFields(group.cost_total, milton);
      if (match === "match") subsMatched += 1;
      else {
        mismatches.push({
          kind: "sub_recipe",
          name: group.name,
          excel_cost: group.cost_total,
          milton_cost: milton,
          variance_amount: variance.workbook_variance_amount,
          variance_pct: variance.workbook_variance_pct,
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
          workbook_variance_amount: variance.workbook_variance_amount,
          workbook_variance_pct: variance.workbook_variance_pct,
        }
      );
      continue;
    }

    const menu = pickMenuItemForLocation(
      menuItems,
      group.name,
      input.locationId
    );
    const recipe = menu ? recipeByMenuId.get(menu.id) : undefined;
    if (!menu || !recipe) continue;
    if (recipe.source_type !== "import") continue;
    if (usesUnconfirmedSub(group)) {
      await input.repo.updateRecipeWorkbookCheck(input.companyId, recipe.id, {
        workbook_cost_total: group.cost_total,
        workbook_selling_price: group.selling_price ?? null,
        workbook_computed_cost: null,
        workbook_cost_match: null,
        workbook_variance_amount: null,
        workbook_variance_pct: null,
      });
      continue;
    }
    dishesTotal += 1;
    const costed = calculateMenuItemCost(menu.id, data);
    const milton =
      costed.status === "complete" && costed.cost != null ? costed.cost : null;
    const match = decideWorkbookCostMatch(group.cost_total, milton);
    const variance = workbookVarianceFields(group.cost_total, milton);
    if (match === "match") dishesMatched += 1;
    else {
      mismatches.push({
        kind: "recipe",
        name: group.name,
        excel_cost: group.cost_total,
        milton_cost: milton,
        variance_amount: variance.workbook_variance_amount,
        variance_pct: variance.workbook_variance_pct,
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
      workbook_variance_amount: variance.workbook_variance_amount,
      workbook_variance_pct: variance.workbook_variance_pct,
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
