import type { SupabaseClient } from "@supabase/supabase-js";
import { snapshotFromUnknown } from "./snapshot";
import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  SavedLayoutMap,
  TabImportSummary,
  UndoSnapshot,
  WorkbookRowCandidate,
} from "./types";
import { emptyUndoSnapshot } from "./types";

const WRITE_CHUNK = 100;

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
  deleteIngredients(companyId: string, ids: string[]): Promise<number>;
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
          .select("id, name, default_unit, current_unit_cost, currency");
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
          const { error } = await supabase
            .from("ingredient_cost_entries")
            .update(patch)
            .eq("company_id", companyId)
            .eq("id", id);
          if (error) throw new Error(error.message);
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
  };
}
