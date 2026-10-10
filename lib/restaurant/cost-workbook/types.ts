// lib/restaurant/cost-workbook/types.ts
//
// Shared types for the multi-tab cost workbook importer (issue #113 step 1).

export const COST_TAB_TYPES = [
  "price_list",
  "category_cost",
  "purchases",
  "recipe",
  "ignore",
] as const;

export type CostTabType = (typeof COST_TAB_TYPES)[number];

export const HIGH_TAB_CONFIDENCE = 0.8;
export const HIGH_COLUMN_CONFIDENCE = 0.75;

export type MappingSource = "ai" | "saved" | "heuristic";

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
}

export interface ReviewCandidate {
  tabName: string;
  rowIndex: number;
  reason: string;
  raw: Record<string, unknown>;
  suggested: Partial<WorkbookRowCandidate> | null;
}

export interface TabImportSummary {
  name: string;
  type: CostTabType;
  confidence: number;
  mapping_source: MappingSource | "none";
  column_mapping: ColumnMapping;
  imported_count: number;
  review_count: number;
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
  mapping_source: "ai" | "saved" | "mixed";
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
}

export interface CostWorkbookIngredient {
  id: string;
  name: string;
  default_unit: string | null;
  current_unit_cost: number;
  currency: string;
}

export interface CostWorkbookCostEntry {
  id: string;
  company_id: string;
  ingredient_id: string;
  supplier_id: string | null;
  source_type: "import";
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

export interface CostWorkbookBatch {
  id: string;
  company_id: string;
  filename: string;
  file_month: string | null;
  currency: string;
  imported_count: number;
  review_count: number;
  tab_summaries: TabImportSummary[];
  mapping_source: "ai" | "saved" | "mixed";
  undone_at: string | null;
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
] as const;

export const PURCHASE_FIELDS = [
  { name: "ingredient_name", required: true },
  { name: "unit", required: true },
  { name: "quantity", type: "number", required: true },
  { name: "total_cost", type: "number", required: true },
  { name: "unit_price", type: "number" },
  { name: "supplier_name" },
  { name: "cost_date", type: "date" },
] as const;

export function targetFieldsForTab(type: CostTabType) {
  if (type === "price_list") return [...PRICE_LIST_FIELDS];
  if (type === "purchases") return [...PURCHASE_FIELDS];
  if (type === "category_cost") return [...CATEGORY_COST_FIELDS];
  return [];
}
