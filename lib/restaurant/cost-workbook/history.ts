import { undoCostImportBatch } from "./import";
import type { CostWorkbookRepo } from "./repo";
import type {
  CostImportBatchStatus,
  CostImportHistoryItem,
  CostWorkbookBatch,
  UndoAllCostImportsResult,
} from "./types";

export function costImportBatchStatus(
  batch: Pick<CostWorkbookBatch, "undone_at" | "undo_snapshot">
): CostImportBatchStatus {
  if (!batch.undone_at) return "live";
  if ((batch.undo_snapshot.undo_errors ?? []).length > 0) {
    return "partially_undone";
  }
  return "undone";
}

export function sortBatchesNewestFirst<
  T extends { created_at?: string; id: string },
>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    const byDate = (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (byDate !== 0) return byDate;
    return b.id.localeCompare(a.id);
  });
}

export function toCostImportHistoryItem(
  batch: CostWorkbookBatch
): CostImportHistoryItem {
  const snap = batch.undo_snapshot;
  return {
    id: batch.id,
    filename: batch.filename,
    created_at: batch.created_at ?? null,
    imported_count: batch.imported_count,
    review_count: batch.review_count,
    ingredients_created: snap.created_ingredient_ids.length,
    menu_items_created: snap.created_menu_item_ids.length,
    recipes_created: snap.created_recipe_ids.length,
    sub_recipes_created: snap.created_component_ids.length,
    pos_links_created: snap.created_mapping_ids.length,
    status: costImportBatchStatus(batch),
    undone_at: batch.undone_at,
  };
}

export async function listCostImportHistory(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<CostImportHistoryItem[]> {
  const batches = await repo.listBatchHistory(companyId);
  return sortBatchesNewestFirst(batches).map(toCostImportHistoryItem);
}

export async function undoAllCostImportBatches(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<UndoAllCostImportsResult> {
  const batches = sortBatchesNewestFirst(
    await repo.listBatchHistory(companyId)
  );
  const live = batches.filter((batch) => !batch.undone_at);
  const skipped = batches.length - live.length;
  let undone = 0;
  const warnings: string[] = [];

  for (const batch of live) {
    const result = await undoCostImportBatch(repo, companyId, batch.id);
    if (!result.ok) {
      return {
        ok: false,
        undone,
        skipped,
        reason: result.reason,
        failed_batch_id: batch.id,
        failed_filename: batch.filename,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
    undone += 1;
    if (result.warnings?.length) warnings.push(...result.warnings);
  }

  return {
    ok: true,
    undone,
    skipped,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
