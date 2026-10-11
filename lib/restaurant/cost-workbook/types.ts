// lib/restaurant/cost-workbook/types.ts
//
// Shared types for the multi-tab cost workbook importer (issue #113 step 1).

export const COST_TAB_TYPES = [
  "price_list",
  "category_cost",
  "purchases",
  "recipe",
  "sub_recipe",
  "ignore",
] as const;

export type CostTabType = (typeof COST_TAB_TYPES)[number];

export const HIGH_TAB_CONFIDENCE = 0.8;
export const HIGH_COLUMN_CONFIDENCE = 0.75;

export type MappingSource = "ai" | "saved" | "heuristic";
export type WorkbookMappingSource = "ai" | "saved" | "mixed" | "heuristic";

export interface ColumnBinding {
  column: string;
  confidence: number;
}

export type ColumnMapping = Record<string, ColumnBinding>;

export interface TabClassification {
  type: CostTabType;
  confidence: number;
  notes?: string;
}

export interface SavedLayoutMap {
  layout_key: string;
  tab_name: string;
  tab_type: CostTabType;
  column_mapping: ColumnMapping;
  header_fingerprint: string;
  tab_confidence: number;
}

export interface DetectedSheet {
  name: string;
  headerRowIndex: number;
  headers: string[];
  /** Objects keyed by the detected header names. */
  dataRows: Record<string, unknown>[];
  /** First few raw objects for AI / preview. */
  sampleRows: Record<string, unknown>[];
  headerFingerprint: string;
  layoutKey: string;
  /** Set when the sheet was kept so the headline can count it, but
   *  there was no usable header row to map. */
  emptyReason?: string;
  /** Raw AOA used to parse repeating COSTO RESTAURANTE blocks. */
  aoa?: unknown[][];
}

export interface WorkbookRowCandidate {
  tabName: string;
  rowIndex: number;
  ingredient_name: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_price: number;
  cost_date: string;
  supplier_name: string | null;
  currency: string;
  notes: string | null;
  raw: Record<string, unknown>;
  category?: string | null;
}

export interface ReviewCandidate {
  tabName: string;
  rowIndex: number;
  reason: string;
  raw: Record<string, unknown>;
  suggested: Partial<WorkbookRowCandidate> | null;
}

export interface SkipCandidate {
  tabName: string;
  rowIndex: number;
  reason: string;
  raw: Record<string, unknown>;
}

export interface SkipReasonCount {
  reason: string;
  count: number;
}

export interface TabImportSummary {
  name: string;
  type: CostTabType;
  confidence: number;
  mapping_source: MappingSource | "none";
  column_mapping: ColumnMapping;
  imported_count: number;
  review_count: number;
  skipped_count: number;
  skipped_reasons: SkipReasonCount[];
  preview: Record<string, unknown>[];
  note?: string;
}

export interface WorkbookImportResult {
  kind: "workbook";
  batch_id: string;
  headline: string;
  imported_count: number;
  review_count: number;
  tab_count: number;
  recipe_tab_count: number;
  mapping_source: WorkbookMappingSource;
  default_currency: string;
  file_month: string | null;
  filename: string;
  tabs: TabImportSummary[];
  review_items: Array<{
    id: string;
    tab_name: string;
    row_index: number;
    reason: string;
    raw_values: Record<string, unknown>;
    suggested: Partial<WorkbookRowCandidate> | null;
    status: "pending";
  }>;
  ingredients_created: number;
  costs_updated: number;
  saved_count: number;
  skipped_count: number;
  skipped_reasons: SkipReasonCount[];
  skipped_breakdown: {
    previous_duplicates: number;
    blank_or_title: number;
    other: number;
  };
  skipped_plain: string;
  menu_items_created: number;
  recipes_created: number;
  sub_recipes_created: number;
  pos_links_created: number;
  restaurant_name?: string | null;
  location_id?: string | null;
}

export interface CostWorkbookIngredient {
  id: string;
  name: string;
  default_unit: string | null;
  current_unit_cost: number;
  currency: string;
  category?: string | null;
}

export type CostEntrySourceType = "manual" | "invoice_line" | "import" | "api";

export interface CostWorkbookCostEntry {
  id: string;
  company_id: string;
  ingredient_id: string;
  supplier_id: string | null;
  source_type: CostEntrySourceType;
  source_id: string | null;
  cost_date: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_cost: number;
  normalized_unit: string;
  normalized_unit_cost: number;
  currency: string;
  notes: string | null;
  created_at: string;
}

export interface CostWorkbookReviewItem {
  id: string;
  company_id: string;
  batch_id: string;
  tab_name: string;
  row_index: number;
  reason: string;
  raw_values: Record<string, unknown>;
  suggested: Partial<WorkbookRowCandidate> | null;
  status: "pending" | "approved" | "skipped";
}

export interface RecipeInputSnapshot {
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

export interface UndoSnapshot {
  inserted_entry_ids: string[];
  updated_entries: Array<{
    id: string;
    before: CostWorkbookCostEntry;
  }>;
  created_ingredient_ids: string[];
  ingredient_costs_before: Array<{
    id: string;
    current_unit_cost: number;
    currency: string;
  }>;
  created_menu_item_ids: string[];
  created_recipe_ids: string[];
  created_component_ids: string[];
  created_component_recipe_ids: string[];
  created_mapping_ids: string[];
  updated_recipes: Array<{
    id: string;
    inputs: RecipeInputSnapshot[];
  }>;
  updated_components: Array<{
    id: string;
    inputs: RecipeInputSnapshot[];
    component_id?: string;
    output_quantity?: number;
    output_unit?: string;
  }>;
  deleted_ingredients: DeletedIngredientSnapshot[];
  deleted_cost_entries: CostWorkbookCostEntry[];
  deleted_menu_recipe_inputs: DetachedRecipeInputSnapshot[];
  deleted_component_recipe_inputs: DetachedRecipeInputSnapshot[];
  deleted_supplier_ingredients: SupplierIngredientSnapshot[];
  ingredient_categories_before: Array<{
    id: string;
    category: string | null;
  }>;
  undo_errors?: string[];
}

export interface DeletedIngredientSnapshot {
  id: string;
  company_id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  current_unit_cost: number;
  currency: string;
}

export interface DetachedRecipeInputSnapshot {
  id: string;
  company_id: string;
  recipe_id: string | null;
  component_recipe_id: string | null;
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

export interface SupplierIngredientSnapshot {
  id: string;
  company_id: string;
  supplier_id: string;
  ingredient_id: string;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  preferred: boolean;
}

export interface IngredientInputUsage {
  kind: "menu" | "component";
  handmade: boolean;
  snapshot: DetachedRecipeInputSnapshot;
}

export function emptyUndoSnapshot(): UndoSnapshot {
  return {
    inserted_entry_ids: [],
    updated_entries: [],
    created_ingredient_ids: [],
    ingredient_costs_before: [],
    created_menu_item_ids: [],
    created_recipe_ids: [],
    created_component_ids: [],
    created_component_recipe_ids: [],
    created_mapping_ids: [],
    updated_recipes: [],
    updated_components: [],
    deleted_ingredients: [],
    deleted_cost_entries: [],
    deleted_menu_recipe_inputs: [],
    deleted_component_recipe_inputs: [],
    deleted_supplier_ingredients: [],
    ingredient_categories_before: [],
  };
}

export interface ImportedMenuItem {
  id: string;
  name: string;
  source_type: string | null;
  source_id: string | null;
  location_id?: string | null;
  brand_id?: string | null;
  selling_price?: number | null;
}

export interface ImportedRecipe {
  id: string;
  menu_item_id: string;
  name: string;
  source_type: string | null;
  source_id: string | null;
}

export interface ImportedComponent {
  id: string;
  name: string;
  output_unit: string;
  source_type: string | null;
  source_id: string | null;
}

export interface ImportedComponentRecipe {
  id: string;
  component_id: string;
  name: string;
  output_quantity: number;
  output_unit: string;
  source_type: string | null;
  source_id: string | null;
}

export interface RecipeLineCandidate {
  tabName: string;
  rowIndex: number;
  recipeName: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  raw: Record<string, unknown>;
}

export interface GroupedRecipe {
  name: string;
  tabName: string;
  kind: "recipe" | "sub_recipe";
  lines: RecipeLineCandidate[];
  output_quantity: number | null;
  output_unit: string | null;
  /** Repeating COSTO RESTAURANTE blocks — do not invent a yield. */
  block_layout?: boolean;
  selling_price?: number | null;
  cost_total?: number | null;
  price_per_lb?: number | null;
  price_per_oz?: number | null;
}

export interface CostWorkbookBatch {
  id: string;
  company_id: string;
  filename: string;
  file_month: string | null;
  currency: string;
  imported_count: number;
  review_count: number;
  tab_summaries: TabImportSummary[];
  mapping_source: WorkbookMappingSource;
  undone_at: string | null;
  undo_snapshot: UndoSnapshot;
}

export const PRICE_LIST_FIELDS = [
  { name: "ingredient_name", required: true },
  { name: "price_per_lb", type: "number" },
  { name: "price_per_oz", type: "number" },
  { name: "price_per_unit", type: "number" },
] as const;

export const CATEGORY_COST_FIELDS = [
  { name: "ingredient_name", required: true },
  { name: "unit" },
  { name: "unit_price", type: "number" },
  { name: "quantity", type: "number" },
  { name: "total_cost", type: "number" },
  { name: "supplier_name" },
  { name: "cost_date", type: "date" },
  { name: "currency" },
] as const;

export const PURCHASE_FIELDS = [
  { name: "ingredient_name", required: true },
  { name: "unit", required: true },
  { name: "quantity", type: "number", required: true },
  { name: "total_cost", type: "number", required: true },
  { name: "unit_price", type: "number" },
  { name: "supplier_name" },
  { name: "cost_date", type: "date" },
  { name: "currency" },
] as const;

export const RECIPE_FIELDS = [
  { name: "recipe_name" },
  { name: "ingredient_name", required: true },
  { name: "quantity", type: "number", required: true },
  { name: "unit", required: true },
  { name: "output_quantity", type: "number" },
  { name: "output_unit" },
] as const;

export function targetFieldsForTab(type: CostTabType) {
  if (type === "price_list") return [...PRICE_LIST_FIELDS];
  if (type === "purchases") return [...PURCHASE_FIELDS];
  if (type === "category_cost") return [...CATEGORY_COST_FIELDS];
  if (type === "recipe" || type === "sub_recipe") return [...RECIPE_FIELDS];
  return [];
}
