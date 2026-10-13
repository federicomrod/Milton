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
  effective_date?: string;
  date_source?: import("@/lib/restaurant/price-date").PriceDateSource;
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

export type WorkbookCostMatch = "match" | "mismatch";

export interface CostWorkbookIngredient {
  id: string;
  name: string;
  default_unit: string | null;
  current_unit_cost: number | null;
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
  /** Set when the row knows its own date or a dated price list's date. */
  date_source?: import("@/lib/restaurant/price-date").PriceDateSource;
  effective_date?: string;
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
    current_unit_cost: number | null;
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
    source_type?: string | null;
    workbook_cost_total?: number | null;
    workbook_selling_price?: number | null;
    workbook_computed_cost?: number | null;
    workbook_cost_match?: WorkbookCostMatch | null;
    workbook_variance_amount?: number | null;
    workbook_variance_pct?: number | null;
  }>;
  updated_components: Array<{
    id: string;
    inputs: RecipeInputSnapshot[];
    component_id?: string;
    output_quantity?: number;
    output_unit?: string;
    source_type?: string | null;
    workbook_cost_total?: number | null;
    workbook_unit_price?: number | null;
    workbook_computed_cost?: number | null;
    workbook_cost_match?: WorkbookCostMatch | null;
    workbook_variance_amount?: number | null;
    workbook_variance_pct?: number | null;
  }>;
  created_recipe_version_ids?: string[];
  created_component_recipe_version_ids?: string[];
  created_pos_product_link_ids?: string[];
  updated_pos_product_links?: Array<{
    id: string;
    before: import("@/lib/restaurant/pos-product-links").PosProductLinkRecord;
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
  /** Compact parsed recipe blocks from this upload. Not used by undo. */
  candidate_blocks?: import("./stored-blocks").StoredRecipeBlock[];
}

export interface DeletedIngredientSnapshot {
  id: string;
  company_id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  current_unit_cost: number | null;
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
    created_recipe_version_ids: [],
    created_component_recipe_version_ids: [],
    created_pos_product_link_ids: [],
    updated_pos_product_links: [],
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
  workbook_cost_total?: number | null;
  workbook_selling_price?: number | null;
  workbook_computed_cost?: number | null;
  workbook_cost_match?: WorkbookCostMatch | null;
  workbook_variance_amount?: number | null;
  workbook_variance_pct?: number | null;
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
  workbook_cost_total?: number | null;
  workbook_unit_price?: number | null;
  workbook_computed_cost?: number | null;
  workbook_cost_match?: WorkbookCostMatch | null;
  workbook_variance_amount?: number | null;
  workbook_variance_pct?: number | null;
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
  /** Repeating COSTO RESTAURANTE blocks — yield comes from footers,
   *  not a sum of mixed ingredient lines. */
  block_layout?: boolean;
  /** 1 unit / 1 ORDEN because Excel only printed COSTO TOTAL. Never a
   *  confirmed yield and never a match with Excel. */
  yield_assumed?: boolean;
  selling_price?: number | null;
  /** Printed COSTO TOTAL footer. Never an inferred sum of lines. */
  cost_total?: number | null;
  /** Sum of line totals when the footer is missing. Not cost_total. */
  inferred_cost_total?: number | null;
  cost_total_inferred?: boolean;
  price_per_lb?: number | null;
  price_per_oz?: number | null;
  price_per_unit?: number | null;
  /**
   * True when at least one ingredient line was sent to review and dropped
   * from `lines`. The remaining lines must not be persisted as a complete
   * recipe (that is how a dish like Pollo Empanizado ends up at $0.20).
   */
  incomplete_lines?: boolean;
  /** Lines sent to review (unknown unit, missing cost, …) but still
   *  part of the block so a suggestion can mark them Pendiente. */
  pending_lines?: RecipeLineCandidate[];
  /** 0-based sheet row of the name / first header for this block. */
  start_row_index?: number;
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
  created_at?: string;
  undone_at: string | null;
  undo_snapshot: UndoSnapshot;
}

export type CostResetStepId =
  | "cost_import_review_items"
  | "pos_product_links"
  | "menu_recipe_inputs"
  | "recipe_ingredients"
  | "component_recipe_inputs"
  | "recipes"
  | "component_recipes"
  | "prepared_components"
  | "import_pos_mappings"
  | "costing_menu_items"
  | "ingredient_aliases"
  | "ingredient_cost_entries"
  | "supplier_ingredients"
  | "ingredients"
  | "cost_import_layout_maps"
  | "batches_marked_undone";

export type CostResetStepStatus = "completed" | "failed" | "skipped";

export interface CostResetStepResult {
  id: CostResetStepId;
  label_es: string;
  status: CostResetStepStatus;
  deleted: number;
  error?: string;
}

export interface CompanyCostResetSummary {
  ok: boolean;
  cost_entries: number;
  ingredients: number;
  supplier_ingredient_links: number;
  recipes: number;
  components: number;
  /** POS product links: treatments, suggested and confirmed links. */
  pos_product_links: number;
  /** Menu items the costing flow created (imported or linked to a POS
   *  product); recipes and versions go with them. */
  costing_menu_items: number;
  import_pos_mappings: number;
  ingredient_aliases: number;
  review_items: number;
  layout_maps: number;
  batches_marked_undone: number;
  kept_manual_menu_items: number;
  kept_manual_pos_mappings: number;
  steps: CostResetStepResult[];
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
