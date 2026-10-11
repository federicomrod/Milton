import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  ImportedComponent,
  ImportedComponentRecipe,
  ImportedMenuItem,
  ImportedRecipe,
  RecipeInputSnapshot,
  SavedLayoutMap,
  UndoSnapshot,
} from "@/lib/restaurant/cost-workbook/types";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";
import type { CostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";

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
  posMappings: Array<{
    id: string;
    raw_pos_item_name: string;
    menu_item_id: string;
  }>;
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
    posMappings: [],
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
      const before = store.ingredients.length;
      store.ingredients = store.ingredients.filter((i) => !remove.has(i.id));
      return before - store.ingredients.length;
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
    async upsertMapping(_companyId, mapping) {
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
        undone_at: null,
        undo_snapshot: emptyUndoSnapshot(),
      };
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
      const created = items.map((item) => ({
        ...item,
        id: id(),
      }));
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
      };
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
      store.components.push(row);
      return row;
    },
    async deleteComponents(_companyId, ids) {
      const remove = new Set(ids);
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
    async listDistinctPosItemNames() {
      return [...store.posItemNames];
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
        };
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
