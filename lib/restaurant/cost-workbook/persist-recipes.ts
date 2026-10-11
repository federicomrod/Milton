import { nameKey } from "@/lib/restaurant/cost-import";
import { canAutoLinkNames, resolveAliasName } from "./duplicates";
import { REVIEW_NAME_SCORE, bestNameMatch, nameMatchScore } from "./names";
import { resolveSubRecipeYield } from "./recipes";
import type { CostWorkbookRepo } from "./repo";
import type {
  GroupedRecipe,
  ImportedComponent,
  ImportedMenuItem,
  RecipeInputSnapshot,
  RecipeLineCandidate,
  ReviewCandidate,
  SkipCandidate,
  UndoSnapshot,
} from "./types";
import { emptyUndoSnapshot } from "./types";

export function resolveCatalogInput(
  lineName: string,
  ingredients: Array<{ id: string; name: string }>,
  components: Array<{ id: string; name: string }>,
  aliases: Map<string, string> = new Map()
): { ok: true; input: RecipeInputSnapshot } | { ok: false; reason: string } {
  const resolvedName = resolveAliasName(lineName, aliases);
  const exactComponent = components.find(
    (item) =>
      nameKey(item.name) === nameKey(lineName) ||
      nameKey(item.name) === nameKey(resolvedName)
  );
  if (exactComponent) {
    return {
      ok: true,
      input: {
        input_type: "component",
        ingredient_id: null,
        component_id: exactComponent.id,
        quantity: 0,
        unit: "",
        notes: null,
      },
    };
  }
  const exactIngredient = ingredients.find(
    (item) =>
      nameKey(item.name) === nameKey(lineName) ||
      nameKey(item.name) === nameKey(resolvedName)
  );
  if (exactIngredient) {
    return {
      ok: true,
      input: {
        input_type: "ingredient",
        ingredient_id: exactIngredient.id,
        component_id: null,
        quantity: 0,
        unit: "",
        notes: null,
      },
    };
  }

  const componentHit = bestNameMatch(
    resolvedName,
    components,
    (item) => item.name
  );
  const ingredientHit = bestNameMatch(
    resolvedName,
    ingredients,
    (item) => item.name
  );
  const best =
    (componentHit?.score ?? 0) >= (ingredientHit?.score ?? 0)
      ? componentHit
        ? { kind: "component" as const, hit: componentHit }
        : null
      : ingredientHit
        ? { kind: "ingredient" as const, hit: ingredientHit }
        : null;

  if (best && canAutoLinkNames(resolvedName, best.hit.item.name)) {
    return {
      ok: true,
      input: {
        input_type: best.kind,
        ingredient_id: best.kind === "ingredient" ? best.hit.item.id : null,
        component_id: best.kind === "component" ? best.hit.item.id : null,
        quantity: 0,
        unit: "",
        notes: null,
      },
    };
  }
  if (best && best.hit.score >= REVIEW_NAME_SCORE) {
    return {
      ok: false,
      reason: `ingredient name unsure (${lineName} ↔ ${best.hit.item.name})`,
    };
  }
  return { ok: false, reason: `unknown ingredient (${lineName})` };
}

function withQty(
  input: RecipeInputSnapshot,
  line: RecipeLineCandidate
): RecipeInputSnapshot {
  return {
    ...input,
    quantity: line.quantity,
    unit: line.unit,
  };
}

function isImported(sourceType: string | null | undefined): boolean {
  return sourceType === "import";
}

export async function persistWorkbookRecipes(input: {
  companyId: string;
  batchId: string;
  currency: string;
  groups: GroupedRecipe[];
  repo: CostWorkbookRepo;
  aliases?: Map<string, string>;
}): Promise<{
  menuItemsCreated: number;
  recipesCreated: number;
  subRecipesCreated: number;
  review: ReviewCandidate[];
  skipped: SkipCandidate[];
  changes: UndoSnapshot;
}> {
  const [ingredients, menuItems, recipes, components, componentRecipes] =
    await Promise.all([
      input.repo.listIngredients(input.companyId),
      input.repo.listMenuItems(input.companyId),
      input.repo.listRecipes(input.companyId),
      input.repo.listComponents(input.companyId),
      input.repo.listComponentRecipes(input.companyId),
    ]);

  const menuByName = new Map(
    menuItems.map((item) => [nameKey(item.name), item])
  );
  const recipeByMenuId = new Map(recipes.map((row) => [row.menu_item_id, row]));
  const componentByName = new Map(
    components.map((item) => [nameKey(item.name), item])
  );
  const componentRecipeByComponentId = new Map(
    componentRecipes.map((row) => [row.component_id, row])
  );

  const liveIngredients = ingredients.map((item) => ({
    id: item.id,
    name: item.name,
  }));
  const liveComponents: Array<{ id: string; name: string }> = components.map(
    (item) => ({ id: item.id, name: item.name })
  );

  const review: ReviewCandidate[] = [];
  const skipped: SkipCandidate[] = [];
  const changes = emptyUndoSnapshot();

  const resolveGroup = (group: GroupedRecipe): RecipeInputSnapshot[] | null => {
    const inputs: RecipeInputSnapshot[] = [];
    for (const line of group.lines) {
      const resolved = resolveCatalogInput(
        line.ingredient_name,
        liveIngredients,
        liveComponents,
        input.aliases ?? new Map()
      );
      if (!resolved.ok) {
        review.push({
          tabName: line.tabName,
          rowIndex: line.rowIndex,
          reason: resolved.reason,
          raw: line.raw,
          suggested: {
            ingredient_name: line.ingredient_name,
            unit: line.unit,
            quantity: line.quantity,
          },
        });
        continue;
      }
      inputs.push(withQty(resolved.input, line));
    }
    if (inputs.length === 0) {
      skipped.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: "no usable recipe lines",
        raw: { recipe: group.name },
      });
      return null;
    }
    return inputs;
  };

  const subGroups = input.groups.filter((group) => group.kind === "sub_recipe");
  const menuGroups = input.groups.filter((group) => group.kind === "recipe");

  for (const group of subGroups) {
    const inputs = resolveGroup(group);
    if (!inputs) continue;
    const yieldResult = resolveSubRecipeYield(group);
    if (!yieldResult.ok) {
      review.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: yieldResult.reason,
        raw: { recipe: group.name },
        suggested: { ingredient_name: group.name },
      });
      continue;
    }
    const existing = componentByName.get(nameKey(group.name));
    if (existing && !isImported(existing.source_type)) {
      skipped.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: "handmade recipe exists",
        raw: { recipe: group.name },
      });
      continue;
    }

    let component: ImportedComponent;
    if (existing && isImported(existing.source_type)) {
      component = existing;
      const previous = componentRecipeByComponentId.get(existing.id);
      if (previous) {
        const previousInputs = await input.repo.listComponentRecipeInputs(
          input.companyId,
          previous.id
        );
        changes.updated_components.push({
          id: previous.id,
          inputs: previousInputs,
        });
        await input.repo.replaceComponentRecipeInputs(
          input.companyId,
          previous.id,
          inputs
        );
        await input.repo.updateComponentYield({
          companyId: input.companyId,
          componentId: existing.id,
          componentRecipeId: previous.id,
          outputQuantity: yieldResult.quantity,
          outputUnit: yieldResult.unit,
        });
      } else {
        const createdRecipe = await input.repo.createComponentRecipe({
          companyId: input.companyId,
          componentId: existing.id,
          name: `${group.name} recipe`,
          outputQuantity: yieldResult.quantity,
          outputUnit: yieldResult.unit,
          sourceId: input.batchId,
          inputs,
        });
        await input.repo.updateComponentYield({
          companyId: input.companyId,
          componentId: existing.id,
          outputQuantity: yieldResult.quantity,
          outputUnit: yieldResult.unit,
        });
        changes.created_component_recipe_ids.push(createdRecipe.id);
        componentRecipeByComponentId.set(existing.id, createdRecipe);
      }
    } else {
      component = await input.repo.createComponent({
        companyId: input.companyId,
        name: group.name,
        outputUnit: yieldResult.unit,
        sourceId: input.batchId,
      });
      changes.created_component_ids.push(component.id);
      componentByName.set(nameKey(group.name), component);
      liveComponents.push({ id: component.id, name: component.name });
      const createdRecipe = await input.repo.createComponentRecipe({
        companyId: input.companyId,
        componentId: component.id,
        name: `${group.name} recipe`,
        outputQuantity: yieldResult.quantity,
        outputUnit: yieldResult.unit,
        sourceId: input.batchId,
        inputs,
      });
      changes.created_component_recipe_ids.push(createdRecipe.id);
      componentRecipeByComponentId.set(component.id, createdRecipe);
    }
  }

  for (const group of menuGroups) {
    const inputs = resolveGroup(group);
    if (!inputs) continue;
    const existingMenu = menuByName.get(nameKey(group.name));
    const existingRecipe = existingMenu
      ? recipeByMenuId.get(existingMenu.id)
      : undefined;

    if (existingRecipe && !isImported(existingRecipe.source_type)) {
      skipped.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: "handmade recipe exists",
        raw: { recipe: group.name },
      });
      continue;
    }

    let menuItem: ImportedMenuItem;
    if (existingMenu) {
      menuItem = existingMenu;
    } else {
      menuItem = await input.repo.createMenuItem({
        companyId: input.companyId,
        name: group.name,
        currency: input.currency,
        sourceId: input.batchId,
      });
      changes.created_menu_item_ids.push(menuItem.id);
      menuByName.set(nameKey(menuItem.name), menuItem);
    }

    if (existingRecipe && isImported(existingRecipe.source_type)) {
      const previousInputs = await input.repo.listRecipeInputs(
        input.companyId,
        existingRecipe.id
      );
      changes.updated_recipes.push({
        id: existingRecipe.id,
        inputs: previousInputs,
      });
      await input.repo.replaceRecipeInputs(
        input.companyId,
        existingRecipe.id,
        inputs
      );
    } else {
      const created = await input.repo.createRecipe({
        companyId: input.companyId,
        menuItemId: menuItem.id,
        name: group.name,
        sourceId: input.batchId,
        inputs,
      });
      changes.created_recipe_ids.push(created.id);
      recipeByMenuId.set(menuItem.id, created);
    }
  }

  return {
    menuItemsCreated: changes.created_menu_item_ids.length,
    recipesCreated: changes.created_recipe_ids.length,
    subRecipesCreated: changes.created_component_ids.length,
    review,
    skipped,
    changes,
  };
}

export async function linkMenuItemsToPos(input: {
  companyId: string;
  menuItems: ImportedMenuItem[];
  repo: CostWorkbookRepo;
}): Promise<{
  linked: number;
  review: ReviewCandidate[];
  skipped: SkipCandidate[];
  mappingIds: string[];
}> {
  if (input.menuItems.length === 0) {
    return { linked: 0, review: [], skipped: [], mappingIds: [] };
  }
  const [posNames, existing] = await Promise.all([
    input.repo.listDistinctPosItemNames(input.companyId),
    input.repo.listPosMappings(input.companyId),
  ]);
  const mapped = new Set(existing.map((row) => row.raw_pos_item_name));
  const review: ReviewCandidate[] = [];
  const skipped: SkipCandidate[] = [];
  const toCreate: Array<{ rawPosItemName: string; menuItemId: string }> = [];

  for (const posName of posNames) {
    if (mapped.has(posName)) continue;
    const hit = bestNameMatch(posName, input.menuItems, (item) => item.name);
    if (!hit || hit.score < REVIEW_NAME_SCORE) continue;
    if (canAutoLinkNames(posName, hit.item.name)) {
      toCreate.push({ rawPosItemName: posName, menuItemId: hit.item.id });
      continue;
    }
    review.push({
      tabName: "POS",
      rowIndex: 0,
      reason: `POS name unsure (${posName} ↔ ${hit.item.name})`,
      raw: { raw_pos_item_name: posName, menu_item_name: hit.item.name },
      suggested: {
        ingredient_name: hit.item.name,
        notes: posName,
      },
    });
  }

  const created = await input.repo.createPosMappings(
    toCreate.map((row) => ({
      companyId: input.companyId,
      rawPosItemName: row.rawPosItemName,
      menuItemId: row.menuItemId,
    }))
  );

  return {
    linked: created.length,
    review,
    skipped,
    mappingIds: created.map((row) => row.id),
  };
}

export function posMatchScore(posName: string, menuName: string): number {
  return nameMatchScore(posName, menuName);
}
