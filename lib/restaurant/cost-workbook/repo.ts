import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  SavedLayoutMap,
  TabImportSummary,
  WorkbookRowCandidate,
} from "./types";

export interface CreateBatchInput {
  companyId: string;
  filename: string;
  fileMonth: string | null;
  currency: string;
  importedCount: number;
  reviewCount: number;
  tabSummaries: TabImportSummary[];
  mappingSource: "ai" | "saved" | "mixed";
  createdBy?: string | null;
}

export interface CostWorkbookRepo {
  listIngredients(companyId: string): Promise<CostWorkbookIngredient[]>;
  createIngredient(input: {
    companyId: string;
    name: string;
    defaultUnit: string;
    currentUnitCost: number;
    currency: string;
    category?: string | null;
  }): Promise<CostWorkbookIngredient>;
  updateIngredientCost(
    ingredientId: string,
    currentUnitCost: number,
    currency: string
  ): Promise<void>;
  findImportCostEntry(input: {
    companyId: string;
    ingredientId: string;
    costDate: string;
  }): Promise<CostWorkbookCostEntry | null>;
  insertCostEntry(
    entry: Omit<CostWorkbookCostEntry, "id" | "created_at">
  ): Promise<CostWorkbookCostEntry>;
  updateCostEntry(
    id: string,
    patch: Partial<CostWorkbookCostEntry>
  ): Promise<void>;
  deleteCostEntriesByBatch(companyId: string, batchId: string): Promise<number>;
  listMappings(companyId: string): Promise<SavedLayoutMap[]>;
  upsertMapping(companyId: string, mapping: SavedLayoutMap): Promise<void>;
  createBatch(input: CreateBatchInput): Promise<CostWorkbookBatch>;
  getBatch(
    companyId: string,
    batchId: string
  ): Promise<CostWorkbookBatch | null>;
  markBatchUndone(companyId: string, batchId: string): Promise<void>;
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
    id: string,
    patch: Partial<CostWorkbookReviewItem> & { resolved_at?: string | null }
  ): Promise<void>;
}

function asIngredient(row: Record<string, unknown>): CostWorkbookIngredient {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    default_unit: (row.default_unit as string | null) ?? null,
    current_unit_cost: Number(row.current_unit_cost ?? 0),
    currency: String(row.currency ?? "USD"),
  };
}

function asCostEntry(row: Record<string, unknown>): CostWorkbookCostEntry {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    ingredient_id: String(row.ingredient_id),
    supplier_id: (row.supplier_id as string | null) ?? null,
    source_type: "import",
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
    undone_at: (row.undone_at as string | null) ?? null,
  };
}

export function createSupabaseCostWorkbookRepo(
  supabase: SupabaseClient
): CostWorkbookRepo {
  return {
    async listIngredients(companyId) {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, default_unit, current_unit_cost, currency")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(asIngredient);
    },

    async createIngredient(input) {
      const { data, error } = await supabase
        .from("ingredients")
        .insert({
          company_id: input.companyId,
          name: input.name,
          category: input.category ?? null,
          default_unit: input.defaultUnit,
          current_unit_cost: input.currentUnitCost,
          currency: input.currency,
        })
        .select("id, name, default_unit, current_unit_cost, currency")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "ingredient insert failed");
      }
      return asIngredient(data as Record<string, unknown>);
    },

    async updateIngredientCost(ingredientId, currentUnitCost, currency) {
      const { error } = await supabase
        .from("ingredients")
        .update({ current_unit_cost: currentUnitCost, currency })
        .eq("id", ingredientId);
      if (error) throw new Error(error.message);
    },

    async findImportCostEntry(input) {
      const { data, error } = await supabase
        .from("ingredient_cost_entries")
        .select(
          "id, company_id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
        )
        .eq("company_id", input.companyId)
        .eq("ingredient_id", input.ingredientId)
        .eq("source_type", "import")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asCostEntry(data as Record<string, unknown>) : null;
    },

    async insertCostEntry(entry) {
      const { data, error } = await supabase
        .from("ingredient_cost_entries")
        .insert(entry)
        .select(
          "id, company_id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
        )
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "cost entry insert failed");
      }
      return asCostEntry(data as Record<string, unknown>);
    },

    async updateCostEntry(id, patch) {
      const { error } = await supabase
        .from("ingredient_cost_entries")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async deleteCostEntriesByBatch(companyId, batchId) {
      const { data, error } = await supabase
        .from("ingredient_cost_entries")
        .delete()
        .eq("company_id", companyId)
        .eq("source_type", "import")
        .eq("source_id", batchId)
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

    async updateReviewItem(id, patch) {
      const { error } = await supabase
        .from("cost_import_review_items")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
