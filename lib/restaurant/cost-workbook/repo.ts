import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import {
  handmadeSourceCorePatch,
  handmadeSourcePatch,
} from "@/lib/restaurant/protect-imported-recipe";
import { snapshotFromUnknown } from "./snapshot";
import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  CostEntrySourceType,
  DetachedRecipeInputSnapshot,
  ImportedComponent,
  ImportedComponentRecipe,
  ImportedMenuItem,
  ImportedRecipe,
  IngredientInputUsage,
  RecipeInputSnapshot,
  SavedLayoutMap,
  SupplierIngredientSnapshot,
  TabImportSummary,
  UndoSnapshot,
  WorkbookMappingSource,
  WorkbookRowCandidate,
  CompanyCostResetSummary,
  CostResetStepId,
} from "./types";
import { emptyUndoSnapshot } from "./types";
import { runResetSteps, summaryFromResetSteps } from "./reset";

const WRITE_CHUNK = 100;

export interface CreateBatchInput {
  companyId: string;
  filename: string;
  fileMonth: string | null;
  currency: string;
  importedCount: number;
  reviewCount: number;
  tabSummaries: TabImportSummary[];
  mappingSource: WorkbookMappingSource;
  createdBy?: string | null;
}

export interface CostWorkbookRepo {
  listIngredients(companyId: string): Promise<CostWorkbookIngredient[]>;
  createIngredients(
    inputs: Array<{
      companyId: string;
      name: string;
      defaultUnit: string;
      currentUnitCost: number;
      currency: string;
      category?: string | null;
    }>
  ): Promise<CostWorkbookIngredient[]>;
  updateIngredientCosts(
    updates: Array<{
      ingredientId: string;
      currentUnitCost: number;
      currency: string;
    }>
  ): Promise<void>;
  updateIngredientCategories(
    updates: Array<{ ingredientId: string; category: string | null }>
  ): Promise<void>;
  restoreIngredients(
    rows: Array<{
      id: string;
      companyId: string;
      name: string;
      category: string | null;
      defaultUnit: string | null;
      currentUnitCost: number;
      currency: string;
    }>
  ): Promise<void>;
  detachIngredientInputs(
    companyId: string,
    ingredientIds: string[]
  ): Promise<void>;
  deleteIngredients(companyId: string, ids: string[]): Promise<number>;
  listBatches(
    companyId: string
  ): Promise<
    Array<Pick<CostWorkbookBatch, "id" | "undone_at" | "undo_snapshot">>
  >;
  listBatchHistory(companyId: string): Promise<CostWorkbookBatch[]>;
  resetCompanyCostCatalog(companyId: string): Promise<CompanyCostResetSummary>;
  listIngredientInputUsages(
    companyId: string,
    ingredientIds: string[]
  ): Promise<IngredientInputUsage[]>;
  listIngredientCostEntries(
    companyId: string,
    ingredientIds: string[]
  ): Promise<CostWorkbookCostEntry[]>;
  listCostEntriesByIds(
    companyId: string,
    ids: string[]
  ): Promise<CostWorkbookCostEntry[]>;
  listSupplierIngredientLinks(
    companyId: string,
    ingredientIds: string[]
  ): Promise<SupplierIngredientSnapshot[]>;
  deleteSupplierIngredientLinks(
    companyId: string,
    ids: string[]
  ): Promise<void>;
  restoreSupplierIngredientLinks(
    rows: SupplierIngredientSnapshot[]
  ): Promise<void>;
  restoreMenuRecipeInputs(rows: DetachedRecipeInputSnapshot[]): Promise<void>;
  restoreComponentRecipeInputs(
    rows: DetachedRecipeInputSnapshot[]
  ): Promise<void>;
  findWorkbookCostEntries(input: {
    companyId: string;
    ingredientIds: string[];
  }): Promise<CostWorkbookCostEntry[]>;
  insertCostEntries(
    entries: Array<Omit<CostWorkbookCostEntry, "id" | "created_at">>
  ): Promise<CostWorkbookCostEntry[]>;
  updateCostEntries(
    companyId: string,
    updates: Array<{ id: string; patch: Partial<CostWorkbookCostEntry> }>
  ): Promise<void>;
  restoreCostEntries(
    companyId: string,
    entries: CostWorkbookCostEntry[]
  ): Promise<void>;
  deleteCostEntriesByIds(companyId: string, ids: string[]): Promise<number>;
  listMappings(companyId: string): Promise<SavedLayoutMap[]>;
  upsertMapping(companyId: string, mapping: SavedLayoutMap): Promise<void>;
  createBatch(input: CreateBatchInput): Promise<CostWorkbookBatch>;
  getBatch(
    companyId: string,
    batchId: string
  ): Promise<CostWorkbookBatch | null>;
  markBatchUndone(companyId: string, batchId: string): Promise<void>;
  updateBatchSnapshot(
    companyId: string,
    batchId: string,
    snapshot: UndoSnapshot
  ): Promise<void>;
  insertReviewItems(
    items: Array<Omit<CostWorkbookReviewItem, "id">>
  ): Promise<CostWorkbookReviewItem[]>;
  listReviewItems(
    companyId: string,
    opts?: { batchId?: string; status?: CostWorkbookReviewItem["status"] }
  ): Promise<CostWorkbookReviewItem[]>;
  getReviewItem(
    companyId: string,
    id: string
  ): Promise<CostWorkbookReviewItem | null>;
  updateReviewItem(
    companyId: string,
    id: string,
    patch: Partial<CostWorkbookReviewItem> & { resolved_at?: string | null }
  ): Promise<void>;
  listMenuItems(companyId: string): Promise<ImportedMenuItem[]>;
  createMenuItem(input: {
    companyId: string;
    name: string;
    currency: string;
    sourceId: string;
    category?: string | null;
    locationId?: string | null;
    brandId?: string | null;
    sellingPrice?: number | null;
  }): Promise<ImportedMenuItem>;
  deleteMenuItems(companyId: string, ids: string[]): Promise<number>;
  listRecipes(companyId: string): Promise<ImportedRecipe[]>;
  createRecipe(input: {
    companyId: string;
    menuItemId: string;
    name: string;
    sourceId: string;
    inputs: RecipeInputSnapshot[];
  }): Promise<ImportedRecipe>;
  listRecipeInputs(
    companyId: string,
    recipeId: string
  ): Promise<RecipeInputSnapshot[]>;
  replaceRecipeInputs(
    companyId: string,
    recipeId: string,
    inputs: RecipeInputSnapshot[]
  ): Promise<void>;
  deleteRecipes(companyId: string, ids: string[]): Promise<number>;
  listComponents(companyId: string): Promise<ImportedComponent[]>;
  createComponent(input: {
    companyId: string;
    name: string;
    outputUnit: string;
    sourceId: string;
  }): Promise<ImportedComponent>;
  deleteComponents(companyId: string, ids: string[]): Promise<number>;
  listComponentRecipes(companyId: string): Promise<ImportedComponentRecipe[]>;
  createComponentRecipe(input: {
    companyId: string;
    componentId: string;
    name: string;
    outputQuantity: number;
    outputUnit: string;
    sourceId: string;
    inputs: RecipeInputSnapshot[];
  }): Promise<ImportedComponentRecipe>;
  listComponentRecipeInputs(
    companyId: string,
    componentRecipeId: string
  ): Promise<RecipeInputSnapshot[]>;
  replaceComponentRecipeInputs(
    companyId: string,
    componentRecipeId: string,
    inputs: RecipeInputSnapshot[]
  ): Promise<void>;
  updateComponentYield(input: {
    companyId: string;
    componentId: string;
    componentRecipeId?: string;
    outputQuantity: number;
    outputUnit: string;
  }): Promise<void>;
  deleteComponentRecipes(companyId: string, ids: string[]): Promise<number>;
  listDistinctPosItemNames(
    companyId: string,
    locationId?: string | null
  ): Promise<string[]>;
  listPosMappings(
    companyId: string
  ): Promise<
    Array<{ id: string; raw_pos_item_name: string; menu_item_id: string }>
  >;
  createPosMappings(
    inputs: Array<{
      companyId: string;
      rawPosItemName: string;
      menuItemId: string;
      locationId?: string | null;
    }>
  ): Promise<Array<{ id: string }>>;
  deletePosMappings(companyId: string, ids: string[]): Promise<number>;
  updateRecipeWorkbookCheck(
    companyId: string,
    recipeId: string,
    patch: {
      workbook_cost_total: number | null;
      workbook_selling_price: number | null;
      workbook_computed_cost: number | null;
      workbook_cost_match: "match" | "mismatch" | null;
    }
  ): Promise<void>;
  updateComponentRecipeWorkbookCheck(
    companyId: string,
    recipeId: string,
    patch: {
      workbook_cost_total: number | null;
      workbook_unit_price: number | null;
      workbook_computed_cost: number | null;
      workbook_cost_match: "match" | "mismatch" | null;
    }
  ): Promise<void>;
  markRecipeManual(companyId: string, recipeId: string): Promise<void>;
  markComponentManual(
    companyId: string,
    componentId: string,
    componentRecipeId?: string | null
  ): Promise<void>;
  /** False when migration 035 workbook_* columns are missing. */
  hasWorkbookCostColumns(companyId: string): Promise<boolean>;
}

function asIngredient(row: Record<string, unknown>): CostWorkbookIngredient {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    default_unit: (row.default_unit as string | null) ?? null,
    current_unit_cost: Number(row.current_unit_cost ?? 0),
    currency: String(row.currency ?? "USD"),
    category: (row.category as string | null) ?? null,
  };
}

function asCostSourceType(value: unknown): CostEntrySourceType {
  if (
    value === "manual" ||
    value === "invoice_line" ||
    value === "import" ||
    value === "api"
  ) {
    return value;
  }
  return "import";
}

function asCostEntry(row: Record<string, unknown>): CostWorkbookCostEntry {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    ingredient_id: String(row.ingredient_id),
    supplier_id: (row.supplier_id as string | null) ?? null,
    source_type: asCostSourceType(row.source_type),
    source_id: (row.source_id as string | null) ?? null,
    cost_date: String(row.cost_date),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    total_cost: Number(row.total_cost),
    unit_cost: Number(row.unit_cost),
    normalized_unit: String(row.normalized_unit),
    normalized_unit_cost: Number(row.normalized_unit_cost),
    currency: String(row.currency),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

function asReview(row: Record<string, unknown>): CostWorkbookReviewItem {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    batch_id: String(row.batch_id),
    tab_name: String(row.tab_name),
    row_index: Number(row.row_index),
    reason: String(row.reason),
    raw_values: (row.raw_values as Record<string, unknown>) ?? {},
    suggested: (row.suggested as Partial<WorkbookRowCandidate> | null) ?? null,
    status: (row.status as CostWorkbookReviewItem["status"]) ?? "pending",
  };
}

function asMapping(row: Record<string, unknown>): SavedLayoutMap {
  return {
    layout_key: String(row.layout_key),
    tab_name: String(row.tab_name),
    tab_type: row.tab_type as SavedLayoutMap["tab_type"],
    column_mapping:
      (row.column_mapping as SavedLayoutMap["column_mapping"]) ?? {},
    header_fingerprint: String(row.header_fingerprint),
    tab_confidence: Number(row.tab_confidence ?? 0),
  };
}

function asBatch(row: Record<string, unknown>): CostWorkbookBatch {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    filename: String(row.filename),
    file_month: (row.file_month as string | null) ?? null,
    currency: String(row.currency),
    imported_count: Number(row.imported_count ?? 0),
    review_count: Number(row.review_count ?? 0),
    tab_summaries: (row.tab_summaries as TabImportSummary[]) ?? [],
    mapping_source:
      (row.mapping_source as CostWorkbookBatch["mapping_source"]) ?? "ai",
    created_at: (row.created_at as string | null) ?? undefined,
    undone_at: (row.undone_at as string | null) ?? null,
    undo_snapshot:
      snapshotFromUnknown(row.undo_snapshot) ?? emptyUndoSnapshot(),
  };
}

const COST_ENTRY_SELECT =
  "id, company_id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at";

async function mapChunks<T>(
  items: T[],
  fn: (chunk: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_CHUNK) {
    await fn(items.slice(i, i + WRITE_CHUNK));
  }
}

async function deleteCompanyRows(
  supabase: SupabaseClient,
  table: string,
  companyId: string
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq("company_id", companyId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

async function loadImportMenuAndMappingIds(
  supabase: SupabaseClient,
  companyId: string
): Promise<{
  importMenuIds: string[];
  importMappingIds: string[];
  keptManualMenuItems: number;
  keptManualPosMappings: number;
  loadError: string | null;
}> {
  try {
    const menus = await supabase
      .from("menu_items")
      .select("id, source_type")
      .eq("company_id", companyId);
    if (menus.error) throw new Error(menus.error.message);
    const importMenuIds = (
      (menus.data ?? []) as Array<{ id: string; source_type: string | null }>
    )
      .filter((row) => row.source_type === "import")
      .map((row) => String(row.id));
    const keptManualMenuItems = (
      (menus.data ?? []) as Array<{ source_type: string | null }>
    ).filter((row) => row.source_type !== "import").length;

    const mappings = await supabase
      .from("pos_item_mappings")
      .select("id, menu_item_id, match_type")
      .eq("company_id", companyId);
    if (mappings.error) throw new Error(mappings.error.message);
    const importMenuSet = new Set(importMenuIds);
    const importMappingIds = (
      (mappings.data ?? []) as Array<{
        id: string;
        menu_item_id: string;
        match_type: string | null;
      }>
    )
      .filter(
        (row) =>
          row.match_type === "auto" ||
          importMenuSet.has(String(row.menu_item_id))
      )
      .map((row) => String(row.id));
    const keptManualPosMappings = (
      (mappings.data ?? []) as Array<{
        id: string;
        menu_item_id: string;
        match_type: string | null;
      }>
    ).filter(
      (row) =>
        row.match_type !== "auto" &&
        !importMenuSet.has(String(row.menu_item_id))
    ).length;

    return {
      importMenuIds,
      importMappingIds,
      keptManualMenuItems,
      keptManualPosMappings,
      loadError: null,
    };
  } catch (err) {
    return {
      importMenuIds: [],
      importMappingIds: [],
      keptManualMenuItems: 0,
      keptManualPosMappings: 0,
      loadError: err instanceof Error ? err.message : "Error",
    };
  }
}

async function resetSupabaseCompanyCostCatalog(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyCostResetSummary> {
  const loaded = await loadImportMenuAndMappingIds(supabase, companyId);

  const steps = await runResetSteps(async (id: CostResetStepId) => {
    switch (id) {
      case "menu_recipe_inputs":
        return deleteCompanyRows(supabase, "menu_recipe_inputs", companyId);
      case "recipe_ingredients":
        return deleteCompanyRows(supabase, "recipe_ingredients", companyId);
      case "component_recipe_inputs":
        return deleteCompanyRows(
          supabase,
          "component_recipe_inputs",
          companyId
        );
      case "recipes":
        return deleteCompanyRows(supabase, "recipes", companyId);
      case "component_recipes":
        return deleteCompanyRows(supabase, "component_recipes", companyId);
      case "prepared_components":
        return deleteCompanyRows(supabase, "prepared_components", companyId);
      case "import_pos_mappings": {
        if (loaded.loadError) throw new Error(loaded.loadError);
        let importPosMappings = 0;
        await mapChunks(loaded.importMappingIds, async (chunk) => {
          const { data, error } = await supabase
            .from("pos_item_mappings")
            .delete()
            .eq("company_id", companyId)
            .in("id", chunk)
            .select("id");
          if (error) throw new Error(error.message);
          importPosMappings += (data ?? []).length;
        });
        return importPosMappings;
      }
      case "import_menu_items": {
        if (loaded.loadError) throw new Error(loaded.loadError);
        let importMenuItems = 0;
        await mapChunks(loaded.importMenuIds, async (chunk) => {
          const { data, error } = await supabase
            .from("menu_items")
            .delete()
            .eq("company_id", companyId)
            .eq("source_type", "import")
            .in("id", chunk)
            .select("id");
          if (error) throw new Error(error.message);
          importMenuItems += (data ?? []).length;
        });
        return importMenuItems;
      }
      case "ingredient_cost_entries":
        return deleteCompanyRows(
          supabase,
          "ingredient_cost_entries",
          companyId
        );
      case "supplier_ingredients":
        return deleteCompanyRows(supabase, "supplier_ingredients", companyId);
      case "ingredients":
        return deleteCompanyRows(supabase, "ingredients", companyId);
      case "cost_import_review_items":
        return deleteCompanyRows(
          supabase,
          "cost_import_review_items",
          companyId
        );
      case "cost_import_layout_maps":
        return deleteCompanyRows(
          supabase,
          "cost_import_layout_maps",
          companyId
        );
      case "batches_marked_undone": {
        const now = new Date().toISOString();
        const { data: marked, error: batchError } = await supabase
          .from("cost_import_batches")
          .update({ undone_at: now })
          .eq("company_id", companyId)
          .is("undone_at", null)
          .select("id");
        if (batchError) throw new Error(batchError.message);
        return (marked ?? []).length;
      }
    }
  });

  return summaryFromResetSteps(steps, {
    kept_manual_menu_items: loaded.keptManualMenuItems,
    kept_manual_pos_mappings: loaded.keptManualPosMappings,
  });
}

export function createSupabaseCostWorkbookRepo(
  supabase: SupabaseClient
): CostWorkbookRepo {
  return {
    async listIngredients(companyId) {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, category, default_unit, current_unit_cost, currency")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asIngredient);
    },

    async createIngredients(inputs) {
      if (inputs.length === 0) return [];
      const created: CostWorkbookIngredient[] = [];
      await mapChunks(inputs, async (chunk) => {
        const { data, error } = await supabase
          .from("ingredients")
          .insert(
            chunk.map((input) => ({
              company_id: input.companyId,
              name: input.name,
              category: input.category ?? null,
              default_unit: input.defaultUnit,
              current_unit_cost: input.currentUnitCost,
              currency: input.currency,
            }))
          )
          .select(
            "id, name, category, default_unit, current_unit_cost, currency"
          );
        if (error) throw new Error(error.message);
        created.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asIngredient)
        );
      });
      return created;
    },

    async updateIngredientCosts(updates) {
      await Promise.all(
        updates.map(async (update) => {
          const { error } = await supabase
            .from("ingredients")
            .update({
              current_unit_cost: update.currentUnitCost,
              currency: update.currency,
            })
            .eq("id", update.ingredientId);
          if (error) throw new Error(error.message);
        })
      );
    },

    async updateIngredientCategories(updates) {
      await Promise.all(
        updates.map(async (update) => {
          const { error } = await supabase
            .from("ingredients")
            .update({ category: update.category })
            .eq("id", update.ingredientId);
          if (error) throw new Error(error.message);
        })
      );
    },

    async restoreIngredients(rows) {
      if (rows.length === 0) return;
      await mapChunks(rows, async (chunk) => {
        const { error } = await supabase.from("ingredients").insert(
          chunk.map((row) => ({
            id: row.id,
            company_id: row.companyId,
            name: row.name,
            category: row.category,
            default_unit: row.defaultUnit ?? "unit",
            current_unit_cost: row.currentUnitCost,
            currency: row.currency,
          }))
        );
        if (error) throw new Error(error.message);
      });
    },

    async detachIngredientInputs(companyId, ingredientIds) {
      if (ingredientIds.length === 0) return;
      await mapChunks(ingredientIds, async (chunk) => {
        const recipeErr = await supabase
          .from("menu_recipe_inputs")
          .delete()
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (recipeErr.error) throw new Error(recipeErr.error.message);
        const componentErr = await supabase
          .from("component_recipe_inputs")
          .delete()
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (componentErr.error) throw new Error(componentErr.error.message);
      });
    },

    async listBatches(companyId) {
      const { data, error } = await supabase
        .from("cost_import_batches")
        .select("id, undone_at, undo_snapshot")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        undone_at: (row.undone_at as string | null) ?? null,
        undo_snapshot:
          snapshotFromUnknown(row.undo_snapshot) ?? emptyUndoSnapshot(),
      }));
    },

    async listBatchHistory(companyId) {
      const { data, error } = await supabase
        .from("cost_import_batches")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asBatch);
    },

    async resetCompanyCostCatalog(companyId) {
      return resetSupabaseCompanyCostCatalog(supabase, companyId);
    },

    async listIngredientInputUsages(companyId, ingredientIds) {
      if (ingredientIds.length === 0) return [];
      const usages: IngredientInputUsage[] = [];
      await mapChunks(ingredientIds, async (chunk) => {
        const menu = await supabase
          .from("menu_recipe_inputs")
          .select(
            "id, company_id, recipe_id, input_type, ingredient_id, component_id, quantity, unit, notes, recipes!inner(source_type)"
          )
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (menu.error) throw new Error(menu.error.message);
        for (const row of (menu.data ?? []) as Record<string, unknown>[]) {
          const recipe = row.recipes as { source_type?: string | null } | null;
          usages.push({
            kind: "menu",
            handmade: recipe?.source_type !== "import",
            snapshot: asDetachedInput(row, "menu"),
          });
        }
        const component = await supabase
          .from("component_recipe_inputs")
          .select(
            "id, company_id, component_recipe_id, input_type, ingredient_id, component_id, quantity, unit, notes, component_recipes!inner(source_type)"
          )
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (component.error) throw new Error(component.error.message);
        for (const row of (component.data ?? []) as Record<string, unknown>[]) {
          const parent = row.component_recipes as {
            source_type?: string | null;
          } | null;
          usages.push({
            kind: "component",
            handmade: parent?.source_type !== "import",
            snapshot: asDetachedInput(row, "component"),
          });
        }
      });
      return usages;
    },

    async listIngredientCostEntries(companyId, ingredientIds) {
      if (ingredientIds.length === 0) return [];
      const found: CostWorkbookCostEntry[] = [];
      await mapChunks(ingredientIds, async (chunk) => {
        const { data, error } = await supabase
          .from("ingredient_cost_entries")
          .select(COST_ENTRY_SELECT)
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (error) throw new Error(error.message);
        found.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asCostEntry)
        );
      });
      return found;
    },

    async listCostEntriesByIds(companyId, ids) {
      if (ids.length === 0) return [];
      const found: CostWorkbookCostEntry[] = [];
      await mapChunks(ids, async (chunk) => {
        const { data, error } = await supabase
          .from("ingredient_cost_entries")
          .select(COST_ENTRY_SELECT)
          .eq("company_id", companyId)
          .in("id", chunk);
        if (error) throw new Error(error.message);
        found.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asCostEntry)
        );
      });
      return found;
    },

    async listSupplierIngredientLinks(companyId, ingredientIds) {
      if (ingredientIds.length === 0) return [];
      const found: SupplierIngredientSnapshot[] = [];
      await mapChunks(ingredientIds, async (chunk) => {
        const { data, error } = await supabase
          .from("supplier_ingredients")
          .select(
            "id, company_id, supplier_id, ingredient_id, supplier_item_name, supplier_sku, preferred"
          )
          .eq("company_id", companyId)
          .in("ingredient_id", chunk);
        if (error) throw new Error(error.message);
        found.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asSupplierLink)
        );
      });
      return found;
    },

    async deleteSupplierIngredientLinks(companyId, ids) {
      if (ids.length === 0) return;
      await mapChunks(ids, async (chunk) => {
        const { error } = await supabase
          .from("supplier_ingredients")
          .delete()
          .eq("company_id", companyId)
          .in("id", chunk);
        if (error) throw new Error(error.message);
      });
    },

    async restoreSupplierIngredientLinks(rows) {
      if (rows.length === 0) return;
      await mapChunks(rows, async (chunk) => {
        const { error } = await supabase.from("supplier_ingredients").insert(
          chunk.map((row) => ({
            id: row.id,
            company_id: row.company_id,
            supplier_id: row.supplier_id,
            ingredient_id: row.ingredient_id,
            supplier_item_name: row.supplier_item_name,
            supplier_sku: row.supplier_sku,
            preferred: row.preferred,
          }))
        );
        if (error) throw new Error(error.message);
      });
    },

    async restoreMenuRecipeInputs(rows) {
      if (rows.length === 0) return;
      await mapChunks(rows, async (chunk) => {
        const { error } = await supabase.from("menu_recipe_inputs").insert(
          chunk.map((row) => ({
            id: row.id,
            company_id: row.company_id,
            recipe_id: row.recipe_id,
            input_type: row.input_type,
            ingredient_id: row.ingredient_id,
            component_id: row.component_id,
            quantity: row.quantity,
            unit: row.unit,
            notes: row.notes,
          }))
        );
        if (error) throw new Error(error.message);
      });
    },

    async restoreComponentRecipeInputs(rows) {
      if (rows.length === 0) return;
      await mapChunks(rows, async (chunk) => {
        const { error } = await supabase.from("component_recipe_inputs").insert(
          chunk.map((row) => ({
            id: row.id,
            company_id: row.company_id,
            component_recipe_id: row.component_recipe_id,
            input_type: row.input_type,
            ingredient_id: row.ingredient_id,
            component_id: row.component_id,
            quantity: row.quantity,
            unit: row.unit,
            notes: row.notes,
          }))
        );
        if (error) throw new Error(error.message);
      });
    },

    async deleteIngredients(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("ingredients")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async findWorkbookCostEntries(input) {
      if (input.ingredientIds.length === 0) return [];
      const found: CostWorkbookCostEntry[] = [];
      await mapChunks(input.ingredientIds, async (chunk) => {
        const { data, error } = await supabase
          .from("ingredient_cost_entries")
          .select(COST_ENTRY_SELECT)
          .eq("company_id", input.companyId)
          .eq("source_type", "import")
          .not("source_id", "is", null)
          .in("ingredient_id", chunk);
        if (error) throw new Error(error.message);
        found.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asCostEntry)
        );
      });
      return found;
    },

    async insertCostEntries(entries) {
      if (entries.length === 0) return [];
      const inserted: CostWorkbookCostEntry[] = [];
      await mapChunks(entries, async (chunk) => {
        const { data, error } = await supabase
          .from("ingredient_cost_entries")
          .insert(chunk)
          .select(COST_ENTRY_SELECT);
        if (error) throw new Error(error.message);
        inserted.push(
          ...((data ?? []) as Record<string, unknown>[]).map(asCostEntry)
        );
      });
      return inserted;
    },

    async updateCostEntries(companyId, updates) {
      await Promise.all(
        updates.map(async (update) => {
          const { error } = await supabase
            .from("ingredient_cost_entries")
            .update(update.patch)
            .eq("company_id", companyId)
            .eq("id", update.id);
          if (error) throw new Error(error.message);
        })
      );
    },

    async restoreCostEntries(companyId, entries) {
      await Promise.all(
        entries.map(async (entry) => {
          const { id, created_at: _createdAt, ...patch } = entry;
          const { data, error } = await supabase
            .from("ingredient_cost_entries")
            .update(patch)
            .eq("company_id", companyId)
            .eq("id", id)
            .select("id");
          if (error) throw new Error(error.message);
          if ((data ?? []).length > 0) return;
          const { error: insertError } = await supabase
            .from("ingredient_cost_entries")
            .insert({
              ...patch,
              id,
              created_at: entry.created_at,
            });
          if (insertError) throw new Error(insertError.message);
        })
      );
    },

    async deleteCostEntriesByIds(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("ingredient_cost_entries")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async listMappings(companyId) {
      const { data, error } = await supabase
        .from("cost_import_layout_maps")
        .select(
          "layout_key, tab_name, tab_type, column_mapping, header_fingerprint, tab_confidence"
        )
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asMapping);
    },

    async upsertMapping(companyId, mapping) {
      const { error } = await supabase.from("cost_import_layout_maps").upsert(
        {
          company_id: companyId,
          layout_key: mapping.layout_key,
          tab_name: mapping.tab_name,
          tab_type: mapping.tab_type,
          column_mapping: mapping.column_mapping,
          header_fingerprint: mapping.header_fingerprint,
          tab_confidence: mapping.tab_confidence,
        },
        { onConflict: "company_id,layout_key" }
      );
      if (error) throw new Error(error.message);
    },

    async createBatch(input) {
      const { data, error } = await supabase
        .from("cost_import_batches")
        .insert({
          company_id: input.companyId,
          filename: input.filename,
          file_month: input.fileMonth,
          currency: input.currency,
          imported_count: input.importedCount,
          review_count: input.reviewCount,
          tab_summaries: input.tabSummaries,
          mapping_source: input.mappingSource,
          created_by: input.createdBy ?? null,
          undo_snapshot: emptyUndoSnapshot(),
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "batch insert failed");
      }
      return asBatch(data as Record<string, unknown>);
    },

    async getBatch(companyId, batchId) {
      const { data, error } = await supabase
        .from("cost_import_batches")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", batchId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asBatch(data as Record<string, unknown>) : null;
    },

    async markBatchUndone(companyId, batchId) {
      const { error } = await supabase
        .from("cost_import_batches")
        .update({ undone_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", batchId);
      if (error) throw new Error(error.message);
    },

    async updateBatchSnapshot(companyId, batchId, snapshot) {
      const { error } = await supabase
        .from("cost_import_batches")
        .update({ undo_snapshot: snapshot })
        .eq("company_id", companyId)
        .eq("id", batchId);
      if (error) throw new Error(error.message);
    },

    async insertReviewItems(items) {
      if (items.length === 0) return [];
      const { data, error } = await supabase
        .from("cost_import_review_items")
        .insert(items)
        .select("*");
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asReview);
    },

    async listReviewItems(companyId, opts) {
      let q = supabase
        .from("cost_import_review_items")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (opts?.batchId) q = q.eq("batch_id", opts.batchId);
      if (opts?.status) q = q.eq("status", opts.status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asReview);
    },

    async getReviewItem(companyId, id) {
      const { data, error } = await supabase
        .from("cost_import_review_items")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asReview(data as Record<string, unknown>) : null;
    },

    async updateReviewItem(companyId, id, patch) {
      const { error } = await supabase
        .from("cost_import_review_items")
        .update(patch)
        .eq("company_id", companyId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async listMenuItems(companyId) {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, name, source_type, source_id, location_id, brand_id")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        source_type: (row.source_type as string | null) ?? null,
        source_id: (row.source_id as string | null) ?? null,
        location_id: (row.location_id as string | null) ?? null,
        brand_id: (row.brand_id as string | null) ?? null,
      }));
    },

    async createMenuItem(input) {
      const { data, error } = await supabase
        .from("menu_items")
        .insert({
          company_id: input.companyId,
          name: input.name,
          category: input.category ?? null,
          selling_price: input.sellingPrice ?? 0,
          currency: input.currency,
          source_type: "import",
          source_id: input.sourceId,
          location_id: input.locationId ?? null,
          brand_id: input.brandId ?? null,
        })
        .select("id, name, source_type, source_id, location_id, brand_id")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "menu item insert failed");
      }
      return {
        id: String(data.id),
        name: String(data.name ?? input.name),
        source_type: (data.source_type as string | null) ?? "import",
        source_id: (data.source_id as string | null) ?? input.sourceId,
        location_id:
          (data.location_id as string | null) ?? input.locationId ?? null,
        brand_id: (data.brand_id as string | null) ?? input.brandId ?? null,
        selling_price: input.sellingPrice ?? 0,
      };
    },

    async deleteMenuItems(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("menu_items")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async listRecipes(companyId) {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, menu_item_id, name, source_type, source_id")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        menu_item_id: String(row.menu_item_id),
        name: String(row.name ?? ""),
        source_type: (row.source_type as string | null) ?? null,
        source_id: (row.source_id as string | null) ?? null,
      }));
    },

    async createRecipe(input) {
      const { data, error } = await supabase
        .from("recipes")
        .insert({
          company_id: input.companyId,
          menu_item_id: input.menuItemId,
          name: input.name,
          status: "active",
          serving_quantity: 1,
          serving_unit: "portion",
          source_type: "import",
          source_id: input.sourceId,
        })
        .select("id, menu_item_id, name, source_type, source_id")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "recipe insert failed");
      }
      if (input.inputs.length > 0) {
        const { error: inputError } = await supabase
          .from("menu_recipe_inputs")
          .insert(
            input.inputs.map((row) => ({
              company_id: input.companyId,
              recipe_id: data.id,
              input_type: row.input_type,
              ingredient_id: row.ingredient_id,
              component_id: row.component_id,
              quantity: row.quantity,
              unit: row.unit,
              notes: row.notes,
            }))
          );
        if (inputError) throw new Error(inputError.message);
      }
      return {
        id: String(data.id),
        menu_item_id: String(data.menu_item_id),
        name: String(data.name ?? input.name),
        source_type: (data.source_type as string | null) ?? "import",
        source_id: (data.source_id as string | null) ?? input.sourceId,
      };
    },

    async listRecipeInputs(companyId, recipeId) {
      const { data, error } = await supabase
        .from("menu_recipe_inputs")
        .select(
          "input_type, ingredient_id, component_id, quantity, unit, notes"
        )
        .eq("company_id", companyId)
        .eq("recipe_id", recipeId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asRecipeInput);
    },

    async replaceRecipeInputs(companyId, recipeId, inputs) {
      const { error: delError } = await supabase
        .from("menu_recipe_inputs")
        .delete()
        .eq("company_id", companyId)
        .eq("recipe_id", recipeId);
      if (delError) throw new Error(delError.message);
      if (inputs.length === 0) return;
      const { error } = await supabase.from("menu_recipe_inputs").insert(
        inputs.map((row) => ({
          company_id: companyId,
          recipe_id: recipeId,
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        }))
      );
      if (error) throw new Error(error.message);
    },

    async deleteRecipes(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("recipes")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async listComponents(companyId) {
      const { data, error } = await supabase
        .from("prepared_components")
        .select("id, name, output_unit, source_type, source_id")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        output_unit: String(row.output_unit ?? "unit"),
        source_type: (row.source_type as string | null) ?? null,
        source_id: (row.source_id as string | null) ?? null,
      }));
    },

    async createComponent(input) {
      const { data, error } = await supabase
        .from("prepared_components")
        .insert({
          company_id: input.companyId,
          name: input.name,
          output_unit: input.outputUnit,
          status: "active",
          source_type: "import",
          source_id: input.sourceId,
        })
        .select("id, name, output_unit, source_type, source_id")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "component insert failed");
      }
      return {
        id: String(data.id),
        name: String(data.name ?? input.name),
        output_unit: String(data.output_unit ?? input.outputUnit),
        source_type: (data.source_type as string | null) ?? "import",
        source_id: (data.source_id as string | null) ?? input.sourceId,
      };
    },

    async deleteComponents(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("prepared_components")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async listComponentRecipes(companyId) {
      const { data, error } = await supabase
        .from("component_recipes")
        .select(
          "id, component_id, name, output_quantity, output_unit, source_type, source_id"
        )
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        component_id: String(row.component_id),
        name: String(row.name ?? ""),
        output_quantity: Number(row.output_quantity ?? 1),
        output_unit: String(row.output_unit ?? "unit"),
        source_type: (row.source_type as string | null) ?? null,
        source_id: (row.source_id as string | null) ?? null,
      }));
    },

    async createComponentRecipe(input) {
      const { data, error } = await supabase
        .from("component_recipes")
        .insert({
          company_id: input.companyId,
          component_id: input.componentId,
          name: input.name,
          output_quantity: input.outputQuantity,
          output_unit: input.outputUnit,
          status: "active",
          source_type: "import",
          source_id: input.sourceId,
        })
        .select(
          "id, component_id, name, output_quantity, output_unit, source_type, source_id"
        )
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "component recipe insert failed");
      }
      if (input.inputs.length > 0) {
        const { error: inputError } = await supabase
          .from("component_recipe_inputs")
          .insert(
            input.inputs.map((row) => ({
              company_id: input.companyId,
              component_recipe_id: data.id,
              input_type: row.input_type,
              ingredient_id: row.ingredient_id,
              component_id: row.component_id,
              quantity: row.quantity,
              unit: row.unit,
              notes: row.notes,
            }))
          );
        if (inputError) throw new Error(inputError.message);
      }
      return {
        id: String(data.id),
        component_id: String(data.component_id),
        name: String(data.name ?? input.name),
        output_quantity: Number(data.output_quantity ?? input.outputQuantity),
        output_unit: String(data.output_unit ?? input.outputUnit),
        source_type: (data.source_type as string | null) ?? "import",
        source_id: (data.source_id as string | null) ?? input.sourceId,
      };
    },

    async listComponentRecipeInputs(companyId, componentRecipeId) {
      const { data, error } = await supabase
        .from("component_recipe_inputs")
        .select(
          "input_type, ingredient_id, component_id, quantity, unit, notes"
        )
        .eq("company_id", companyId)
        .eq("component_recipe_id", componentRecipeId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asRecipeInput);
    },

    async updateComponentYield(input) {
      const { error: componentError } = await supabase
        .from("prepared_components")
        .update({ output_unit: input.outputUnit })
        .eq("company_id", input.companyId)
        .eq("id", input.componentId);
      if (componentError) throw new Error(componentError.message);
      if (!input.componentRecipeId) return;
      const { error } = await supabase
        .from("component_recipes")
        .update({
          output_quantity: input.outputQuantity,
          output_unit: input.outputUnit,
        })
        .eq("company_id", input.companyId)
        .eq("id", input.componentRecipeId);
      if (error) throw new Error(error.message);
    },

    async replaceComponentRecipeInputs(companyId, componentRecipeId, inputs) {
      const { error: delError } = await supabase
        .from("component_recipe_inputs")
        .delete()
        .eq("company_id", companyId)
        .eq("component_recipe_id", componentRecipeId);
      if (delError) throw new Error(delError.message);
      if (inputs.length === 0) return;
      const { error } = await supabase.from("component_recipe_inputs").insert(
        inputs.map((row) => ({
          company_id: companyId,
          component_recipe_id: componentRecipeId,
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
        }))
      );
      if (error) throw new Error(error.message);
    },

    async deleteComponentRecipes(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("component_recipes")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async listDistinctPosItemNames(companyId, locationId) {
      const names = new Set<string>();
      const page = 1000;
      let from = 0;
      for (;;) {
        let q = supabase
          .from("pos_sales_items")
          .select("raw_item_name")
          .eq("company_id", companyId);
        if (locationId) q = q.eq("location_id", locationId);
        const { data, error } = await q.range(from, from + page - 1);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        for (const row of rows) {
          const name = String(row.raw_item_name ?? "").trim();
          if (name) names.add(name);
        }
        if (rows.length < page) break;
        from += page;
      }
      return [...names];
    },

    async listPosMappings(companyId) {
      const { data, error } = await supabase
        .from("pos_item_mappings")
        .select("id, raw_pos_item_name, menu_item_id")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        raw_pos_item_name: String(row.raw_pos_item_name ?? ""),
        menu_item_id: String(row.menu_item_id),
      }));
    },

    async createPosMappings(inputs) {
      if (inputs.length === 0) return [];
      const created: Array<{ id: string }> = [];
      await mapChunks(inputs, async (chunk) => {
        const { data, error } = await supabase
          .from("pos_item_mappings")
          .insert(
            chunk.map((row) => ({
              company_id: row.companyId,
              raw_pos_item_name: row.rawPosItemName,
              menu_item_id: row.menuItemId,
              match_type: "auto",
              location_id: row.locationId ?? null,
            }))
          )
          .select("id");
        if (error) throw new Error(error.message);
        created.push(
          ...((data ?? []) as Array<{ id: string }>).map((row) => ({
            id: String(row.id),
          }))
        );
      });
      return created;
    },

    async deletePosMappings(companyId, ids) {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("pos_item_mappings")
        .delete()
        .eq("company_id", companyId)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async updateRecipeWorkbookCheck(companyId, recipeId, patch) {
      const { error } = await supabase
        .from("recipes")
        .update(patch)
        .eq("company_id", companyId)
        .eq("id", recipeId);
      if (error) throw new Error(error.message);
    },

    async updateComponentRecipeWorkbookCheck(companyId, recipeId, patch) {
      const { error } = await supabase
        .from("component_recipes")
        .update(patch)
        .eq("company_id", companyId)
        .eq("id", recipeId);
      if (error) throw new Error(error.message);
    },

    async markRecipeManual(companyId, recipeId) {
      const { error } = await supabase
        .from("recipes")
        .update(handmadeSourcePatch())
        .eq("company_id", companyId)
        .eq("id", recipeId);
      if (error && errorMentionsColumn(error, "workbook_cost_match")) {
        const retry = await supabase
          .from("recipes")
          .update(handmadeSourceCorePatch())
          .eq("company_id", companyId)
          .eq("id", recipeId);
        if (retry.error) throw new Error(retry.error.message);
        return;
      }
      if (error) throw new Error(error.message);
    },

    async markComponentManual(companyId, componentId, componentRecipeId) {
      const { error: componentError } = await supabase
        .from("prepared_components")
        .update(handmadeSourceCorePatch())
        .eq("company_id", companyId)
        .eq("id", componentId);
      if (componentError) throw new Error(componentError.message);
      if (!componentRecipeId) return;
      const { error } = await supabase
        .from("component_recipes")
        .update(handmadeSourcePatch())
        .eq("company_id", companyId)
        .eq("id", componentRecipeId);
      if (error && errorMentionsColumn(error, "workbook_cost_match")) {
        const retry = await supabase
          .from("component_recipes")
          .update(handmadeSourceCorePatch())
          .eq("company_id", companyId)
          .eq("id", componentRecipeId);
        if (retry.error) throw new Error(retry.error.message);
        return;
      }
      if (error) throw new Error(error.message);
    },

    async hasWorkbookCostColumns(companyId) {
      const { error } = await supabase
        .from("recipes")
        .select("id, workbook_cost_match")
        .eq("company_id", companyId)
        .limit(1);
      if (!error) return true;
      if (errorMentionsColumn(error, "workbook_cost_match")) return false;
      throw new Error(error.message);
    },
  };
}

function asRecipeInput(row: Record<string, unknown>): RecipeInputSnapshot {
  return {
    input_type: row.input_type === "component" ? "component" : "ingredient",
    ingredient_id: (row.ingredient_id as string | null) ?? null,
    component_id: (row.component_id as string | null) ?? null,
    quantity: Number(row.quantity ?? 0),
    unit: String(row.unit ?? ""),
    notes: (row.notes as string | null) ?? null,
  };
}

function asDetachedInput(
  row: Record<string, unknown>,
  kind: "menu" | "component"
): DetachedRecipeInputSnapshot {
  return {
    id: String(row.id),
    company_id: String(row.company_id ?? ""),
    recipe_id: kind === "menu" ? String(row.recipe_id ?? "") : null,
    component_recipe_id:
      kind === "component" ? String(row.component_recipe_id ?? "") : null,
    input_type: row.input_type === "component" ? "component" : "ingredient",
    ingredient_id: (row.ingredient_id as string | null) ?? null,
    component_id: (row.component_id as string | null) ?? null,
    quantity: Number(row.quantity ?? 0),
    unit: String(row.unit ?? ""),
    notes: (row.notes as string | null) ?? null,
  };
}

function asSupplierLink(
  row: Record<string, unknown>
): SupplierIngredientSnapshot {
  return {
    id: String(row.id),
    company_id: String(row.company_id ?? ""),
    supplier_id: String(row.supplier_id ?? ""),
    ingredient_id: String(row.ingredient_id ?? ""),
    supplier_item_name: (row.supplier_item_name as string | null) ?? null,
    supplier_sku: (row.supplier_sku as string | null) ?? null,
    preferred: Boolean(row.preferred),
  };
}
