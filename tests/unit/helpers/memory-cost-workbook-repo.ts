import type {
  CompanyCostResetSummary,
  CostResetStepId,
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  DetachedRecipeInputSnapshot,
  ImportedComponent,
  ImportedComponentRecipe,
  ImportedMenuItem,
  ImportedRecipe,
  RecipeInputSnapshot,
  SavedLayoutMap,
  SupplierIngredientSnapshot,
  UndoSnapshot,
} from "@/lib/restaurant/cost-workbook/types";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";
import type { CostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { runResetSteps, summaryFromResetSteps } from "@/lib/restaurant/cost-workbook/reset";

export interface MemoryPosSale {
  id: string;
  company_id: string;
  raw_item_name: string;
  menu_item_id: string | null;
}

export interface MemoryCostWorkbookStore {
  ingredients: CostWorkbookIngredient[];
  costEntries: CostWorkbookCostEntry[];
  mappings: SavedLayoutMap[];
  batches: CostWorkbookBatch[];
  reviewItems: CostWorkbookReviewItem[];
  menuItems: ImportedMenuItem[];
  recipes: ImportedRecipe[];
  recipeInputs: Array<RecipeInputSnapshot & { id: string; recipe_id: string }>;
  components: ImportedComponent[];
  componentRecipes: ImportedComponentRecipe[];
  componentRecipeInputs: Array<
    RecipeInputSnapshot & { id: string; component_recipe_id: string }
  >;
  posItemNames: string[];
  posItemLocationIds?: string[];
  posMappings: Array<{
    id: string;
    raw_pos_item_name: string;
    menu_item_id: string;
    location_id?: string | null;
    match_type?: "auto" | "manual" | "suggested";
  }>;
  supplierLinks: SupplierIngredientSnapshot[];
  companyByEntityId: Record<string, string>;
  mappingCompanyIds: Record<string, string>;
  posSalesItems: MemoryPosSale[];
  failResetStep?: CostResetStepId;
}

export function emptyMemoryStore(): MemoryCostWorkbookStore {
  return {
    ingredients: [],
    costEntries: [],
    mappings: [],
    batches: [],
    reviewItems: [],
    menuItems: [],
    recipes: [],
    recipeInputs: [],
    components: [],
    componentRecipes: [],
    componentRecipeInputs: [],
    posItemNames: [],
    posItemLocationIds: [],
    posMappings: [],
    supplierLinks: [],
    companyByEntityId: {},
    mappingCompanyIds: {},
    posSalesItems: [],
  };
}

export function createMemoryCostWorkbookRepo(
  store: MemoryCostWorkbookStore
): CostWorkbookRepo {
  const id = () => crypto.randomUUID();

  return {
    async listIngredients() {
      return [...store.ingredients];
    },
    async createIngredients(inputs) {
      const created = inputs.map((input) => {
        const row: CostWorkbookIngredient = {
          id: id(),
          name: input.name,
          default_unit: input.defaultUnit,
          current_unit_cost: input.currentUnitCost,
          currency: input.currency,
          category: input.category ?? null,
        };
        store.companyByEntityId[row.id] = input.companyId;
        store.ingredients.push(row);
        return row;
      });
      return created;
    },
    async updateIngredientCosts(updates) {
      for (const update of updates) {
        const ing = store.ingredients.find((i) => i.id === update.ingredientId);
        if (ing) {
          ing.current_unit_cost = update.currentUnitCost;
          ing.currency = update.currency;
        }
      }
    },
    async updateIngredientCategories(updates) {
      for (const update of updates) {
        const ing = store.ingredients.find((i) => i.id === update.ingredientId);
        if (ing) ing.category = update.category;
      }
    },
    async restoreIngredients(rows) {
      for (const row of rows) {
        if (store.ingredients.some((item) => item.id === row.id)) continue;
        store.companyByEntityId[row.id] = row.companyId;
        store.ingredients.push({
          id: row.id,
          name: row.name,
          default_unit: row.defaultUnit,
          current_unit_cost: row.currentUnitCost,
          currency: row.currency,
          category: row.category,
        });
      }
    },
    async detachIngredientInputs(_companyId, ingredientIds) {
      const remove = new Set(ingredientIds);
      store.recipeInputs = store.recipeInputs.filter(
        (row) => !row.ingredient_id || !remove.has(row.ingredient_id)
      );
      store.componentRecipeInputs = store.componentRecipeInputs.filter(
        (row) => !row.ingredient_id || !remove.has(row.ingredient_id)
      );
    },
    async deleteIngredients(_companyId, ids) {
      const remove = new Set(ids);
      const blocked =
        store.recipeInputs.some(
          (row) => row.ingredient_id && remove.has(row.ingredient_id)
        ) ||
        store.componentRecipeInputs.some(
          (row) => row.ingredient_id && remove.has(row.ingredient_id)
        );
      if (blocked) {
        throw new Error("ingredient still referenced by a recipe line");
      }
      const before = store.ingredients.length;
      store.ingredients = store.ingredients.filter((i) => !remove.has(i.id));
      return before - store.ingredients.length;
    },
    async listBatches(companyId) {
      return store.batches
        .filter((row) => row.company_id === companyId)
        .map((row) => ({
          id: row.id,
          undone_at: row.undone_at,
          undo_snapshot: row.undo_snapshot,
        }));
    },
    async listBatchHistory(companyId) {
      return store.batches
        .filter((row) => row.company_id === companyId)
        .map((row) => ({ ...row }));
    },
    async resetCompanyCostCatalog(companyId) {
      return resetMemoryCompanyCostCatalog(store, companyId);
    },
    async listIngredientInputUsages(_companyId, ingredientIds) {
      const wanted = new Set(ingredientIds);
      const usages = [];
      for (const row of store.recipeInputs) {
        if (!row.ingredient_id || !wanted.has(row.ingredient_id)) continue;
        const recipe = store.recipes.find((item) => item.id === row.recipe_id);
        usages.push({
          kind: "menu" as const,
          handmade: recipe?.source_type !== "import",
          snapshot: {
            id: row.id,
            company_id: _companyId,
            recipe_id: row.recipe_id,
            component_recipe_id: null,
            input_type: row.input_type,
            ingredient_id: row.ingredient_id,
            component_id: row.component_id,
            quantity: row.quantity,
            unit: row.unit,
            notes: row.notes,
          },
        });
      }
      for (const row of store.componentRecipeInputs) {
        if (!row.ingredient_id || !wanted.has(row.ingredient_id)) continue;
        const recipe = store.componentRecipes.find(
          (item) => item.id === row.component_recipe_id
        );
        usages.push({
          kind: "component" as const,
          handmade: recipe?.source_type !== "import",
          snapshot: {
            id: row.id,
            company_id: _companyId,
            recipe_id: null,
            component_recipe_id: row.component_recipe_id,
            input_type: row.input_type,
            ingredient_id: row.ingredient_id,
            component_id: row.component_id,
            quantity: row.quantity,
            unit: row.unit,
            notes: row.notes,
          },
        });
      }
      return usages;
    },
    async listIngredientCostEntries(companyId, ingredientIds) {
      const wanted = new Set(ingredientIds);
      return store.costEntries.filter(
        (row) => row.company_id === companyId && wanted.has(row.ingredient_id)
      );
    },
    async listCostEntriesByIds(companyId, ids) {
      const wanted = new Set(ids);
      return store.costEntries.filter(
        (row) => row.company_id === companyId && wanted.has(row.id)
      );
    },
    async listSupplierIngredientLinks(companyId, ingredientIds) {
      const wanted = new Set(ingredientIds);
      return store.supplierLinks.filter(
        (row) => row.company_id === companyId && wanted.has(row.ingredient_id)
      );
    },
    async deleteSupplierIngredientLinks(companyId, ids) {
      const remove = new Set(ids);
      store.supplierLinks = store.supplierLinks.filter(
        (row) => !(row.company_id === companyId && remove.has(row.id))
      );
    },
    async restoreSupplierIngredientLinks(rows) {
      for (const row of rows) {
        if (store.supplierLinks.some((item) => item.id === row.id)) continue;
        store.companyByEntityId[row.id] = row.company_id;
        store.supplierLinks.push({ ...row });
      }
    },
    async restoreMenuRecipeInputs(rows: DetachedRecipeInputSnapshot[]) {
      for (const row of rows) {
        if (!row.recipe_id) continue;
        if (store.recipeInputs.some((item) => item.id === row.id)) continue;
        store.recipeInputs.push({
          id: row.id,
          recipe_id: row.recipe_id,
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        });
      }
    },
    async restoreComponentRecipeInputs(rows: DetachedRecipeInputSnapshot[]) {
      for (const row of rows) {
        if (!row.component_recipe_id) continue;
        if (store.componentRecipeInputs.some((item) => item.id === row.id)) {
          continue;
        }
        store.componentRecipeInputs.push({
          id: row.id,
          component_recipe_id: row.component_recipe_id,
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        });
      }
    },
    async findWorkbookCostEntries(input) {
      const wanted = new Set(input.ingredientIds);
      return store.costEntries.filter(
        (e) =>
          e.company_id === input.companyId &&
          wanted.has(e.ingredient_id) &&
          e.source_type === "import" &&
          e.source_id != null
      );
    },
    async insertCostEntries(entries) {
      const created = entries.map((entry) => {
        const row: CostWorkbookCostEntry = {
          ...entry,
          id: id(),
          created_at: new Date().toISOString(),
        };
        store.companyByEntityId[row.id] = row.company_id;
        store.costEntries.push(row);
        return row;
      });
      return created;
    },
    async updateCostEntries(companyId, updates) {
      for (const update of updates) {
        const row = store.costEntries.find(
          (e) => e.company_id === companyId && e.id === update.id
        );
        if (row) Object.assign(row, update.patch);
      }
    },
    async restoreCostEntries(companyId, entries) {
      for (const entry of entries) {
        store.companyByEntityId[entry.id] = companyId;
        const idx = store.costEntries.findIndex(
          (e) => e.company_id === companyId && e.id === entry.id
        );
        if (idx >= 0) store.costEntries[idx] = { ...entry };
        else store.costEntries.push({ ...entry });
      }
    },
    async deleteCostEntriesByIds(companyId, ids) {
      const remove = new Set(ids);
      const before = store.costEntries.length;
      store.costEntries = store.costEntries.filter(
        (e) => !(e.company_id === companyId && remove.has(e.id))
      );
      return before - store.costEntries.length;
    },
    async listMappings() {
      return [...store.mappings];
    },
    async upsertMapping(companyId, mapping) {
      store.mappingCompanyIds[mapping.layout_key] = companyId;
      const idx = store.mappings.findIndex(
        (m) => m.layout_key === mapping.layout_key
      );
      if (idx >= 0) store.mappings[idx] = mapping;
      else store.mappings.push(mapping);
    },
    async createBatch(input) {
      const row: CostWorkbookBatch = {
        id: id(),
        company_id: input.companyId,
        filename: input.filename,
        file_month: input.fileMonth,
        currency: input.currency,
        imported_count: input.importedCount,
        review_count: input.reviewCount,
        tab_summaries: input.tabSummaries,
        mapping_source: input.mappingSource,
        created_at: new Date(Date.now() + store.batches.length).toISOString(),
        undone_at: null,
        undo_snapshot: emptyUndoSnapshot(),
      };
      store.companyByEntityId[row.id] = input.companyId;
      store.batches.push(row);
      return row;
    },
    async getBatch(companyId, batchId) {
      return (
        store.batches.find(
          (b) => b.company_id === companyId && b.id === batchId
        ) ?? null
      );
    },
    async markBatchUndone(companyId, batchId) {
      const batch = store.batches.find(
        (b) => b.company_id === companyId && b.id === batchId
      );
      if (batch) batch.undone_at = new Date().toISOString();
    },
    async updateBatchSnapshot(companyId, batchId, snapshot: UndoSnapshot) {
      const batch = store.batches.find(
        (b) => b.company_id === companyId && b.id === batchId
      );
      if (batch) batch.undo_snapshot = snapshot;
    },
    async insertReviewItems(items) {
      const created = items.map((item) => {
        const row = {
          ...item,
          id: id(),
        };
        store.companyByEntityId[row.id] = row.company_id;
        return row;
      });
      store.reviewItems.push(...created);
      return created;
    },
    async listReviewItems(companyId, opts) {
      return store.reviewItems.filter((r) => {
        if (r.company_id !== companyId) return false;
        if (opts?.batchId && r.batch_id !== opts.batchId) return false;
        if (opts?.status && r.status !== opts.status) return false;
        return true;
      });
    },
    async getReviewItem(companyId, reviewId) {
      return (
        store.reviewItems.find(
          (r) => r.company_id === companyId && r.id === reviewId
        ) ?? null
      );
    },
    async updateReviewItem(companyId, reviewId, patch) {
      const row = store.reviewItems.find(
        (r) => r.company_id === companyId && r.id === reviewId
      );
      if (row) Object.assign(row, patch);
    },
    async listMenuItems() {
      return [...store.menuItems];
    },
    async createMenuItem(input) {
      const row: ImportedMenuItem = {
        id: id(),
        name: input.name,
        source_type: "import",
        source_id: input.sourceId,
        location_id: input.locationId ?? null,
        brand_id: input.brandId ?? null,
        selling_price: input.sellingPrice ?? 0,
      };
      store.companyByEntityId[row.id] = input.companyId;
      store.menuItems.push(row);
      return row;
    },
    async deleteMenuItems(_companyId, ids) {
      const remove = new Set(ids);
      const before = store.menuItems.length;
      const recipeIds = new Set(
        store.recipes
          .filter((row) => remove.has(row.menu_item_id))
          .map((row) => row.id)
      );
      store.menuItems = store.menuItems.filter((row) => !remove.has(row.id));
      store.recipes = store.recipes.filter(
        (row) => !remove.has(row.menu_item_id)
      );
      store.recipeInputs = store.recipeInputs.filter(
        (row) => !recipeIds.has(row.recipe_id)
      );
      store.posMappings = store.posMappings.filter(
        (row) => !remove.has(row.menu_item_id)
      );
      return before - store.menuItems.length;
    },
    async listRecipes() {
      return [...store.recipes];
    },
    async createRecipe(input) {
      const row: ImportedRecipe = {
        id: id(),
        menu_item_id: input.menuItemId,
        name: input.name,
        source_type: "import",
        source_id: input.sourceId,
      };
      store.companyByEntityId[row.id] = input.companyId;
      store.recipes.push(row);
      store.recipeInputs.push(
        ...input.inputs.map((line) => ({
          ...line,
          id: id(),
          recipe_id: row.id,
        }))
      );
      return row;
    },
    async listRecipeInputs(_companyId, recipeId) {
      return store.recipeInputs
        .filter((row) => row.recipe_id === recipeId)
        .map((row) => ({
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        }));
    },
    async replaceRecipeInputs(_companyId, recipeId, inputs) {
      store.recipeInputs = store.recipeInputs.filter(
        (row) => row.recipe_id !== recipeId
      );
      store.recipeInputs.push(
        ...inputs.map((line) => ({ ...line, id: id(), recipe_id: recipeId }))
      );
    },
    async deleteRecipes(_companyId, ids) {
      const remove = new Set(ids);
      const before = store.recipes.length;
      store.recipes = store.recipes.filter((row) => !remove.has(row.id));
      store.recipeInputs = store.recipeInputs.filter(
        (row) => !remove.has(row.recipe_id)
      );
      return before - store.recipes.length;
    },
    async listComponents() {
      return [...store.components];
    },
    async createComponent(input) {
      const row: ImportedComponent = {
        id: id(),
        name: input.name,
        output_unit: input.outputUnit,
        source_type: "import",
        source_id: input.sourceId,
      };
      store.companyByEntityId[row.id] = input.companyId;
      store.components.push(row);
      return row;
    },
    async deleteComponents(_companyId, ids) {
      const remove = new Set(ids);
      const blocked =
        store.recipeInputs.some(
          (row) => row.component_id && remove.has(row.component_id)
        ) ||
        store.componentRecipeInputs.some(
          (row) => row.component_id && remove.has(row.component_id)
        );
      if (blocked) {
        throw new Error("component still referenced by a recipe line");
      }
      const before = store.components.length;
      const recipeIds = new Set(
        store.componentRecipes
          .filter((row) => remove.has(row.component_id))
          .map((row) => row.id)
      );
      store.components = store.components.filter((row) => !remove.has(row.id));
      store.componentRecipes = store.componentRecipes.filter(
        (row) => !remove.has(row.component_id)
      );
      store.componentRecipeInputs = store.componentRecipeInputs.filter(
        (row) => !recipeIds.has(row.component_recipe_id)
      );
      return before - store.components.length;
    },
    async listComponentRecipes() {
      return [...store.componentRecipes];
    },
    async createComponentRecipe(input) {
      const row: ImportedComponentRecipe = {
        id: id(),
        component_id: input.componentId,
        name: input.name,
        output_quantity: input.outputQuantity,
        output_unit: input.outputUnit,
        source_type: "import",
        source_id: input.sourceId,
      };
      store.companyByEntityId[row.id] = input.companyId;
      store.componentRecipes.push(row);
      store.componentRecipeInputs.push(
        ...input.inputs.map((line) => ({
          ...line,
          id: id(),
          component_recipe_id: row.id,
        }))
      );
      return row;
    },
    async listComponentRecipeInputs(_companyId, componentRecipeId) {
      return store.componentRecipeInputs
        .filter((row) => row.component_recipe_id === componentRecipeId)
        .map((row) => ({
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        }));
    },
    async updateComponentYield(input) {
      const component = store.components.find(
        (row) => row.id === input.componentId
      );
      if (component) component.output_unit = input.outputUnit;
      if (!input.componentRecipeId) return;
      const recipe = store.componentRecipes.find(
        (row) => row.id === input.componentRecipeId
      );
      if (recipe) {
        recipe.output_quantity = input.outputQuantity;
        recipe.output_unit = input.outputUnit;
      }
    },
    async replaceComponentRecipeInputs(_companyId, componentRecipeId, inputs) {
      store.componentRecipeInputs = store.componentRecipeInputs.filter(
        (row) => row.component_recipe_id !== componentRecipeId
      );
      store.componentRecipeInputs.push(
        ...inputs.map((line) => ({
          ...line,
          id: id(),
          component_recipe_id: componentRecipeId,
        }))
      );
    },
    async deleteComponentRecipes(_companyId, ids) {
      const remove = new Set(ids);
      const before = store.componentRecipes.length;
      store.componentRecipes = store.componentRecipes.filter(
        (row) => !remove.has(row.id)
      );
      store.componentRecipeInputs = store.componentRecipeInputs.filter(
        (row) => !remove.has(row.component_recipe_id)
      );
      return before - store.componentRecipes.length;
    },
    async listDistinctPosItemNames(_companyId, locationId) {
      if (!locationId || !store.posItemLocationIds?.length) {
        return [...store.posItemNames];
      }
      return store.posItemNames.filter(
        (_, i) => store.posItemLocationIds?.[i] === locationId
      );
    },
    async listPosMappings() {
      return [...store.posMappings];
    },
    async createPosMappings(inputs) {
      const created = inputs.map((input) => {
        const row = {
          id: id(),
          raw_pos_item_name: input.rawPosItemName,
          menu_item_id: input.menuItemId,
          location_id: input.locationId ?? null,
          match_type: "auto" as const,
        };
        store.companyByEntityId[row.id] = input.companyId;
        store.posMappings.push(row);
        return { id: row.id };
      });
      return created;
    },
    async deletePosMappings(_companyId, ids) {
      const remove = new Set(ids);
      const before = store.posMappings.length;
      store.posMappings = store.posMappings.filter(
        (row) => !remove.has(row.id)
      );
      return before - store.posMappings.length;
    },
  };
}

async function resetMemoryCompanyCostCatalog(
  store: MemoryCostWorkbookStore,
  companyId: string
): Promise<CompanyCostResetSummary> {
  const ours = (id: string, rowCompany?: string | null) =>
    (rowCompany != null && rowCompany === companyId) ||
    store.companyByEntityId[id] === companyId;

  const importMenuItems = store.menuItems.filter(
    (row) => ours(row.id) && row.source_type === "import"
  );
  const importMenuIds = new Set(importMenuItems.map((row) => row.id));
  const keptManualMenuItems = store.menuItems.filter(
    (row) => ours(row.id) && row.source_type !== "import"
  ).length;

  const importMappings = store.posMappings.filter(
    (row) =>
      ours(row.id) &&
      (row.match_type === "auto" || importMenuIds.has(row.menu_item_id))
  );
  const importMappingIds = new Set(importMappings.map((row) => row.id));
  const keptManualPosMappings = store.posMappings.filter(
    (row) =>
      ours(row.id) &&
      !importMappingIds.has(row.id) &&
      !importMenuIds.has(row.menu_item_id)
  ).length;

  const steps = await runResetSteps(async (id: CostResetStepId) => {
    if (store.failResetStep === id) {
      throw new Error(`forced ${id} failure`);
    }
    switch (id) {
      case "menu_recipe_inputs": {
        const recipeIds = new Set(
          store.recipes.filter((row) => ours(row.id)).map((row) => row.id)
        );
        const before = store.recipeInputs.length;
        store.recipeInputs = store.recipeInputs.filter(
          (row) => !recipeIds.has(row.recipe_id)
        );
        return before - store.recipeInputs.length;
      }
      case "recipe_ingredients":
        return 0;
      case "component_recipe_inputs": {
        const componentRecipeIds = new Set(
          store.componentRecipes
            .filter((row) => ours(row.id))
            .map((row) => row.id)
        );
        const before = store.componentRecipeInputs.length;
        store.componentRecipeInputs = store.componentRecipeInputs.filter(
          (row) => !componentRecipeIds.has(row.component_recipe_id)
        );
        return before - store.componentRecipeInputs.length;
      }
      case "recipes": {
        const before = store.recipes.filter((row) => ours(row.id)).length;
        store.recipes = store.recipes.filter((row) => !ours(row.id));
        return before;
      }
      case "component_recipes": {
        const before = store.componentRecipes.filter((row) =>
          ours(row.id)
        ).length;
        store.componentRecipes = store.componentRecipes.filter(
          (row) => !ours(row.id)
        );
        return before;
      }
      case "prepared_components": {
        const before = store.components.filter((row) => ours(row.id)).length;
        store.components = store.components.filter((row) => !ours(row.id));
        return before;
      }
      case "import_pos_mappings": {
        const before = store.posMappings.length;
        store.posMappings = store.posMappings.filter(
          (row) => !importMappingIds.has(row.id)
        );
        return before - store.posMappings.length;
      }
      case "import_menu_items": {
        const before = store.menuItems.length;
        store.menuItems = store.menuItems.filter(
          (row) => !importMenuIds.has(row.id)
        );
        return before - store.menuItems.length;
      }
      case "ingredient_cost_entries": {
        const before = store.costEntries.filter(
          (row) => row.company_id === companyId
        ).length;
        store.costEntries = store.costEntries.filter(
          (row) => row.company_id !== companyId
        );
        return before;
      }
      case "supplier_ingredients": {
        const before = store.supplierLinks.filter(
          (row) => row.company_id === companyId
        ).length;
        store.supplierLinks = store.supplierLinks.filter(
          (row) => row.company_id !== companyId
        );
        return before;
      }
      case "ingredients": {
        const before = store.ingredients.filter((row) => ours(row.id)).length;
        store.ingredients = store.ingredients.filter((row) => !ours(row.id));
        return before;
      }
      case "cost_import_review_items": {
        const before = store.reviewItems.filter(
          (row) => row.company_id === companyId
        ).length;
        store.reviewItems = store.reviewItems.filter(
          (row) => row.company_id !== companyId
        );
        return before;
      }
      case "cost_import_layout_maps": {
        const before = store.mappings.filter(
          (row) => store.mappingCompanyIds[row.layout_key] === companyId
        ).length;
        store.mappings = store.mappings.filter(
          (row) => store.mappingCompanyIds[row.layout_key] !== companyId
        );
        return before;
      }
      case "batches_marked_undone": {
        const liveBatches = store.batches.filter(
          (row) => row.company_id === companyId && !row.undone_at
        );
        const now = new Date().toISOString();
        for (const batch of liveBatches) {
          batch.undone_at = now;
        }
        return liveBatches.length;
      }
    }
  });

  return summaryFromResetSteps(steps, {
    kept_manual_menu_items: keptManualMenuItems,
    kept_manual_pos_mappings: keptManualPosMappings,
  });
}
