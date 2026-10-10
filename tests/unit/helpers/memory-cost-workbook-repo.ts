import type {
  CostWorkbookBatch,
  CostWorkbookCostEntry,
  CostWorkbookIngredient,
  CostWorkbookReviewItem,
  SavedLayoutMap,
} from "@/lib/restaurant/cost-workbook/types";
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
    async createIngredient(input) {
      const row: CostWorkbookIngredient = {
        id: id(),
        name: input.name,
        default_unit: input.defaultUnit,
        current_unit_cost: input.currentUnitCost,
        currency: input.currency,
      };
      store.ingredients.push(row);
      return row;
    },
    async updateIngredientCost(ingredientId, currentUnitCost, currency) {
      const ing = store.ingredients.find((i) => i.id === ingredientId);
      if (ing) {
        ing.current_unit_cost = currentUnitCost;
        ing.currency = currency;
      }
    },
    async findImportCostEntry(input) {
      const matches = store.costEntries
        .filter(
          (e) =>
            e.company_id === input.companyId &&
            e.ingredient_id === input.ingredientId &&
            e.source_type === "import"
        )
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return matches[0] ?? null;
    },
    async insertCostEntry(entry) {
      const row: CostWorkbookCostEntry = {
        ...entry,
        id: id(),
        created_at: new Date().toISOString(),
      };
      store.costEntries.push(row);
      return row;
    },
    async updateCostEntry(entryId, patch) {
      const row = store.costEntries.find((e) => e.id === entryId);
      if (row) Object.assign(row, patch);
    },
    async deleteCostEntriesByBatch(companyId, batchId) {
      const before = store.costEntries.length;
      store.costEntries = store.costEntries.filter(
        (e) =>
          !(
            e.company_id === companyId &&
            e.source_type === "import" &&
            e.source_id === batchId
          )
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
    async updateReviewItem(reviewId, patch) {
      const row = store.reviewItems.find((r) => r.id === reviewId);
      if (row) Object.assign(row, patch);
    },
  };
}
