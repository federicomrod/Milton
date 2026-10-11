import { nameKey } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { isImportProtectedSource } from "@/lib/restaurant/protect-imported-recipe";
import { isSubRecipePortionUnit } from "@/lib/restaurant/units";
import {
  handmadeRecipeExistsReason,
  selfReferenceReason,
  uncertainSubRecipeReason,
  unknownIngredientReason,
  unknownUnitReason,
} from "./copy";
import { canAutoLinkNames, resolveAliasName } from "./duplicates";
import { rawLineUnit } from "./portion-unit";
import {
  AUTO_NAME_SCORE,
  REVIEW_NAME_SCORE,
  bestNameMatch,
  nameMatchScore,
} from "./names";
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
  aliases: Map<string, string> = new Map(),
  lang: PreferredLanguage = "en",
  parentName?: string
): { ok: true; input: RecipeInputSnapshot } | { ok: false; reason: string } {
  const resolvedName = resolveAliasName(lineName, aliases);
  if (parentName && nameKey(lineName) === nameKey(parentName)) {
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
    return { ok: false, reason: selfReferenceReason(lang, lineName) };
  }
  const exactComponents = components.filter(
    (item) =>
      nameKey(item.name) === nameKey(lineName) ||
      nameKey(item.name) === nameKey(resolvedName)
  );
  if (exactComponents.length > 1) {
    return {
      ok: false,
      reason: uncertainSubRecipeReason(lang, lineName),
    };
  }
  const exactComponent = exactComponents[0];
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
  if (componentHit && componentHit.score >= AUTO_NAME_SCORE) {
    return {
      ok: false,
      reason: uncertainSubRecipeReason(
        lang,
        `${lineName} ↔ ${componentHit.item.name}`
      ),
    };
  }
  const ingredientHit = bestNameMatch(
    resolvedName,
    ingredients,
    (item) => item.name
  );
  const best = ingredientHit
    ? { kind: "ingredient" as const, hit: ingredientHit }
    : null;

  if (best && canAutoLinkNames(resolvedName, best.hit.item.name)) {
    return {
      ok: true,
      input: {
        input_type: "ingredient",
        ingredient_id: best.hit.item.id,
        component_id: null,
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
  return { ok: false, reason: unknownIngredientReason(lang, lineName) };
}

export function withQty(
  input: RecipeInputSnapshot,
  line: RecipeLineCandidate
): RecipeInputSnapshot {
  return {
    ...input,
    quantity: line.quantity,
    unit: line.unit,
  };
}

/** Pick the restaurant-scoped menu item when the schema has location_id. */
export function pickMenuItemForLocation<
  T extends { name: string; location_id?: string | null },
>(items: T[], name: string, locationId?: string | null): T | undefined {
  const key = nameKey(name);
  const sameName = items.filter((row) => nameKey(row.name) === key);
  if (sameName.length === 0) return undefined;
  if (locationId) {
    return (
      sameName.find((row) => row.location_id === locationId) ??
      sameName.find((row) => row.location_id == null)
    );
  }
  return sameName.find((row) => row.location_id == null) ?? sameName[0];
}

function isImported(sourceType: string | null | undefined): boolean {
  return !isImportProtectedSource(sourceType);
}

export async function persistWorkbookRecipes(input: {
  companyId: string;
  batchId: string;
  currency: string;
  groups: GroupedRecipe[];
  repo: CostWorkbookRepo;
  aliases?: Map<string, string>;
  locationId?: string | null;
  brandId?: string | null;
  lang?: PreferredLanguage;
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

  const locationId = input.locationId ?? null;
  const brandId = input.brandId ?? null;
  const menuKey = (name: string, loc: string | null | undefined) =>
    `${nameKey(name)}|${loc ?? ""}`;
  const menuByName = new Map<string, (typeof menuItems)[number]>();
  for (const item of menuItems) {
    menuByName.set(menuKey(item.name, item.location_id), item);
    if (!item.location_id && !menuByName.has(menuKey(item.name, locationId))) {
      menuByName.set(menuKey(item.name, locationId), item);
    }
  }
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

  const lang = input.lang ?? "en";
  const resolveGroup = (group: GroupedRecipe): RecipeInputSnapshot[] | null => {
    const inputs: RecipeInputSnapshot[] = [];
    let incomplete = Boolean(group.incomplete_lines);
    for (const line of group.lines) {
      const resolved = resolveCatalogInput(
        line.ingredient_name,
        liveIngredients,
        liveComponents,
        input.aliases ?? new Map(),
        lang,
        group.name
      );
      if (!resolved.ok) {
        incomplete = true;
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
      const rawUnit = rawLineUnit(line);
      if (isSubRecipePortionUnit(rawUnit)) {
        if (resolved.input.input_type !== "component") {
          incomplete = true;
          review.push({
            tabName: line.tabName,
            rowIndex: line.rowIndex,
            reason: unknownUnitReason(lang, rawUnit),
            raw: line.raw,
            suggested: {
              ingredient_name: line.ingredient_name,
              unit: rawUnit,
              quantity: line.quantity,
            },
          });
          continue;
        }
        const componentId = resolved.input.component_id;
        const yieldRecipe = componentId
          ? componentRecipeByComponentId.get(componentId)
          : undefined;
        if (
          yieldRecipe &&
          yieldRecipe.output_quantity > 0 &&
          yieldRecipe.output_unit
        ) {
          // 1 ORDEN / CONVOY is one plated prep of the sub-recipe: the
          // Excel unit cost is that sub's COSTO TOTAL, not cost-per-lb.
          // Storing qty × yield in the yield unit makes Milton's portion
          // cost equal N × batch (see DEDOS DE QUESO / GUARNICION 1).
          inputs.push(
            withQty(resolved.input, {
              ...line,
              quantity: line.quantity * yieldRecipe.output_quantity,
              unit: yieldRecipe.output_unit,
            })
          );
          continue;
        }
        inputs.push(withQty(resolved.input, { ...line, unit: "portion" }));
        continue;
      }
      inputs.push(withQty(resolved.input, line));
    }
    if (incomplete) {
      return null;
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
    const yieldResult = resolveSubRecipeYield(group, lang);
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
    if (!inputs) continue;
    const existing = componentByName.get(nameKey(group.name));
    if (existing && !isImported(existing.source_type)) {
      skipped.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: handmadeRecipeExistsReason(lang),
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
          component_id: existing.id,
          output_quantity: previous.output_quantity,
          output_unit: previous.output_unit,
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
    const existingMenu =
      menuByName.get(menuKey(group.name, locationId)) ??
      menuByName.get(menuKey(group.name, null));
    const existingRecipe = existingMenu
      ? recipeByMenuId.get(existingMenu.id)
      : undefined;

    if (existingRecipe && !isImported(existingRecipe.source_type)) {
      skipped.push({
        tabName: group.tabName,
        rowIndex: 0,
        reason: handmadeRecipeExistsReason(lang),
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
        locationId,
        brandId,
        sellingPrice: group.selling_price ?? 0,
      });
      changes.created_menu_item_ids.push(menuItem.id);
      menuByName.set(menuKey(menuItem.name, menuItem.location_id), menuItem);
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
  locationId?: string | null;
}): Promise<{
  linked: number;
  review: ReviewCandidate[];
  skipped: SkipCandidate[];
  mappingIds: string[];
  unlinkedDishes: string[];
  unmatchedPosNames: string[];
}> {
  if (input.menuItems.length === 0) {
    return {
      linked: 0,
      review: [],
      skipped: [],
      mappingIds: [],
      unlinkedDishes: [],
      unmatchedPosNames: [],
    };
  }
  const [posNames, existing] = await Promise.all([
    input.repo.listDistinctPosItemNames(
      input.companyId,
      input.locationId ?? null
    ),
    input.repo.listPosMappings(input.companyId),
  ]);
  const mapped = new Set(existing.map((row) => row.raw_pos_item_name));
  const alreadyLinkedMenuIds = new Set(existing.map((row) => row.menu_item_id));
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
      locationId: input.locationId ?? null,
    }))
  );

  const newlyLinked = new Set(toCreate.map((row) => row.menuItemId));
  const unlinkedDishes = input.menuItems
    .filter(
      (item) => !alreadyLinkedMenuIds.has(item.id) && !newlyLinked.has(item.id)
    )
    .map((item) => item.name);
  const unmatchedPosNames = posNames.filter((posName) => {
    if (mapped.has(posName)) return false;
    return !toCreate.some((row) => row.rawPosItemName === posName);
  });

  return {
    linked: created.length,
    review,
    skipped,
    mappingIds: created.map((row) => row.id),
    unlinkedDishes,
    unmatchedPosNames,
  };
}

export function posMatchScore(posName: string, menuName: string): number {
  return nameMatchScore(posName, menuName);
}
