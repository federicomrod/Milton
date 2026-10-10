import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
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
  };
}
