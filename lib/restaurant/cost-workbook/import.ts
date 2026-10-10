import { normalizeUnit } from "@/lib/restaurant/units";
import type { WorkbookAi } from "./ai";
import { classifyCostTabHeuristic } from "./ai";
import { layoutKeyForSheet } from "./header";
import { evaluateWorkbookRow, isSkippableWorkbookRow } from "./parse";
import { dedupeWorkbookRows, persistSavedRows } from "./persist";
import { mapPool, WORKBOOK_AI_CONCURRENCY } from "./pool";
import type { CostWorkbookRepo } from "./repo";
import { inferWorkbookDate } from "./date";
import { mappingPassesSanity } from "./sanity";
import { readWorkbookSheets } from "./sheets";
import { mergeUndoSnapshots } from "./snapshot";
import {
  HIGH_TAB_CONFIDENCE,
  type ColumnMapping,
  type CostTabType,
  type DetectedSheet,
  type MappingSource,
  type ReviewCandidate,
  type SavedLayoutMap,
  type TabImportSummary,
  type WorkbookImportResult,
  type WorkbookRowCandidate,
} from "./types";

export function buildImportHeadline(input: {
  saved: number;
  updated: number;
  tabs: number;
  review: number;
  skipped: number;
}): string {
  const look =
    input.review === 1 ? "1 needs a look." : `${input.review} need a look.`;
  const skip = input.skipped === 1 ? "1 skipped." : `${input.skipped} skipped.`;
  return `Saved ${input.saved}, updated ${input.updated} from ${input.tabs} tabs. ${look} ${skip}`;
}

function requiredMapped(type: CostTabType, mapping: ColumnMapping): boolean {
  if (type === "price_list") {
    return Boolean(
      mapping.ingredient_name?.column &&
      (mapping.price_per_lb?.column ||
        mapping.price_per_oz?.column ||
        mapping.price_per_unit?.column)
    );
  }
  if (type === "purchases" || type === "category_cost") {
    return Boolean(mapping.ingredient_name?.column);
  }
  return false;
}

function optionalNumber(
  value: unknown,
  label: string
): { ok: true; value?: number } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: `${label} must be a number` };
  }
  return { ok: true, value };
}

interface ResolvedTab {
  sheet: DetectedSheet;
  tabType: CostTabType;
  tabConfidence: number;
  mapping: ColumnMapping;
  mappingSource: MappingSource | "none";
  note?: string;
  persistMapping: boolean;
}

async function resolveTab(input: {
  sheet: DetectedSheet;
  savedByKey: Map<string, SavedLayoutMap>;
  ai: WorkbookAi;
  currency: string;
  defaultDate: string;
}): Promise<ResolvedTab> {
  const { sheet, savedByKey, ai, currency, defaultDate } = input;
  const heuristic = classifyCostTabHeuristic({
    sheetName: sheet.name,
    headers: sheet.headers,
    sampleRows: sheet.sampleRows,
  });
  const trySaved = (type: CostTabType): SavedLayoutMap | undefined => {
    const saved = savedByKey.get(layoutKeyForSheet(sheet.headers, type));
    if (!saved || saved.tab_confidence < HIGH_TAB_CONFIDENCE) return undefined;
    if (
      saved.tab_type !== "recipe" &&
      saved.tab_type !== "ignore" &&
      !mappingPassesSanity({
        tabType: saved.tab_type,
        dataRows: sheet.dataRows,
        mapping: saved.column_mapping,
        currency,
        defaultDate,
      })
    ) {
      return undefined;
    }
    return saved;
  };

  const savedHeuristic = trySaved(heuristic.type);
  if (savedHeuristic) {
    return {
      sheet,
      tabType: savedHeuristic.tab_type,
      tabConfidence: savedHeuristic.tab_confidence,
      mapping: savedHeuristic.column_mapping,
      mappingSource: "saved",
      persistMapping: false,
    };
  }

  const classified = await ai.classifyTab({
    sheetName: sheet.name,
    headers: sheet.headers,
    sampleRows: sheet.sampleRows,
  });
  const savedClassified = trySaved(classified.type);
  if (savedClassified) {
    return {
      sheet,
      tabType: savedClassified.tab_type,
      tabConfidence: savedClassified.tab_confidence,
      mapping: savedClassified.column_mapping,
      mappingSource: "saved",
      note: classified.notes,
      persistMapping: false,
    };
  }

  let mapping: ColumnMapping = {};
  if (classified.type !== "recipe" && classified.type !== "ignore") {
    mapping = await ai.mapColumns({
      tabType: classified.type,
      headers: sheet.headers,
      sampleRows: sheet.sampleRows,
    });
  }

  const sane =
    classified.type === "recipe" ||
    classified.type === "ignore" ||
    mappingPassesSanity({
      tabType: classified.type,
      dataRows: sheet.dataRows,
      mapping,
      currency,
      defaultDate,
    });

  return {
    sheet,
    tabType: classified.type,
    tabConfidence: classified.confidence,
    mapping,
    mappingSource: "ai",
    note: classified.notes,
    persistMapping: sane && classified.type !== "ignore",
  };
}

export async function importCostWorkbook(input: {
  companyId: string;
  filename: string;
  buffer?: Buffer;
  sheets?: DetectedSheet[];
  currency: string;
  repo: CostWorkbookRepo;
  ai: WorkbookAi;
  createdBy?: string | null;
}): Promise<WorkbookImportResult> {
  const sheets =
    input.sheets ?? (input.buffer ? readWorkbookSheets(input.buffer) : []);
  const fileMonth =
    inferWorkbookDate(
      input.filename,
      sheets.map((s) => s.name)
    ) ?? new Date().toISOString().slice(0, 10);

  const savedMaps = await input.repo.listMappings(input.companyId);
  const savedByKey = new Map(savedMaps.map((m) => [m.layout_key, m]));

  const resolvedTabs = await mapPool(sheets, WORKBOOK_AI_CONCURRENCY, (sheet) =>
    resolveTab({
      sheet,
      savedByKey,
      ai: input.ai,
      currency: input.currency,
      defaultDate: fileMonth,
    })
  );

  const toSave: WorkbookRowCandidate[] = [];
  const toReview: ReviewCandidate[] = [];
  const tabSummaries: TabImportSummary[] = [];
  const mapsToPersist: SavedLayoutMap[] = [];
  const sources: Array<MappingSource | "none"> = [];
  let recipeTabCount = 0;
  let costTabCount = 0;
  let skippedCount = 0;

  for (const resolved of resolvedTabs) {
    const { sheet, tabType, tabConfidence, mapping, mappingSource, note } =
      resolved;
    sources.push(mappingSource);

    if (tabType === "recipe") {
      recipeTabCount += 1;
      tabSummaries.push({
        name: sheet.name,
        type: tabType,
        confidence: tabConfidence,
        mapping_source: mappingSource,
        column_mapping: mapping,
        imported_count: 0,
        review_count: 0,
        preview: sheet.sampleRows,
        note: "recipes, coming soon",
      });
      if (resolved.persistMapping && mappingSource !== "saved") {
        mapsToPersist.push({
          layout_key: layoutKeyForSheet(sheet.headers, "recipe"),
          tab_name: sheet.name,
          tab_type: "recipe",
          column_mapping: {},
          header_fingerprint: sheet.headerFingerprint,
          tab_confidence: tabConfidence,
        });
      }
      continue;
    }

    if (tabType === "ignore") {
      tabSummaries.push({
        name: sheet.name,
        type: tabType,
        confidence: tabConfidence,
        mapping_source: mappingSource,
        column_mapping: mapping,
        imported_count: 0,
        review_count: 0,
        preview: sheet.sampleRows,
        note: "skipped",
      });
      continue;
    }

    costTabCount += 1;
    const tabLow =
      tabConfidence < HIGH_TAB_CONFIDENCE || !requiredMapped(tabType, mapping);
    let imported = 0;
    let review = 0;

    if (tabLow) {
      toReview.push({
        tabName: sheet.name,
        rowIndex: sheet.headerRowIndex,
        reason: "column unsure",
        raw: { headers: sheet.headers, sample: sheet.sampleRows },
        suggested: null,
      });
      review += 1;
      for (const [i, row] of sheet.dataRows.entries()) {
        if (isSkippableWorkbookRow(tabType, row, mapping)) {
          skippedCount += 1;
          continue;
        }
        toReview.push({
          tabName: sheet.name,
          rowIndex: i,
          reason: "column unsure",
          raw: row,
          suggested: null,
        });
        review += 1;
      }
    } else {
      for (const [i, row] of sheet.dataRows.entries()) {
        if (isSkippableWorkbookRow(tabType, row, mapping)) {
          skippedCount += 1;
          continue;
        }
        const result = evaluateWorkbookRow({
          tabType,
          tabName: sheet.name,
          rowIndex: i,
          row,
          mapping,
          currency: input.currency,
          defaultDate: fileMonth,
        });
        if (result.ok) {
          toSave.push(result.value);
          imported += 1;
        } else {
          toReview.push(result.review);
          review += 1;
        }
      }
      if (
        resolved.persistMapping &&
        mappingSource !== "saved" &&
        mappingPassesSanity({
          tabType,
          dataRows: sheet.dataRows,
          mapping,
          currency: input.currency,
          defaultDate: fileMonth,
        })
      ) {
        mapsToPersist.push({
          layout_key: layoutKeyForSheet(sheet.headers, tabType),
          tab_name: sheet.name,
          tab_type: tabType,
          column_mapping: mapping,
          header_fingerprint: sheet.headerFingerprint,
          tab_confidence: tabConfidence,
        });
      }
    }

    tabSummaries.push({
      name: sheet.name,
      type: tabType,
      confidence: tabConfidence,
      mapping_source: mappingSource,
      column_mapping: mapping,
      imported_count: imported,
      review_count: review,
      preview: sheet.sampleRows,
      note,
    });
  }

  const deduped = dedupeWorkbookRows(toSave);
  skippedCount += deduped.skipped.length;
  for (const skip of deduped.skipped) {
    const tab = tabSummaries.find((t) => t.name === skip.tabName);
    if (tab && tab.imported_count > 0) tab.imported_count -= 1;
  }

  const usedSources = sources.filter((s) => s === "ai" || s === "saved");
  const mappingSource: "ai" | "saved" | "mixed" =
    usedSources.length === 0
      ? "ai"
      : usedSources.every((s) => s === "saved")
        ? "saved"
        : usedSources.every((s) => s === "ai")
          ? "ai"
          : "mixed";

  const batch = await input.repo.createBatch({
    companyId: input.companyId,
    filename: input.filename,
    fileMonth,
    currency: input.currency,
    importedCount: deduped.rows.length,
    reviewCount: toReview.length,
    tabSummaries,
    mappingSource,
    createdBy: input.createdBy ?? null,
  });

  const persistStats = await persistSavedRows({
    companyId: input.companyId,
    currency: input.currency,
    batchId: batch.id,
    rows: deduped.rows,
    repo: input.repo,
  });

  for (const fail of persistStats.failed) {
    toReview.push(fail);
    const tab = tabSummaries.find((t) => t.name === fail.tabName);
    if (tab) {
      if (tab.imported_count > 0) tab.imported_count -= 1;
      tab.review_count += 1;
    }
  }

  const reviewItems = await input.repo.insertReviewItems(
    toReview.map((r) => ({
      company_id: input.companyId,
      batch_id: batch.id,
      tab_name: r.tabName,
      row_index: r.rowIndex,
      reason: r.reason,
      raw_values: r.raw,
      suggested: r.suggested,
      status: "pending" as const,
    }))
  );

  for (const map of mapsToPersist) {
    await input.repo.upsertMapping(input.companyId, map);
  }

  await input.repo.updateBatchSnapshot(
    input.companyId,
    batch.id,
    persistStats.changes
  );

  const saved = persistStats.inserted;
  const updated = persistStats.updated;
  const review = toReview.length;

  return {
    kind: "workbook",
    batch_id: batch.id,
    headline: buildImportHeadline({
      saved,
      updated,
      tabs: costTabCount,
      review,
      skipped: skippedCount,
    }),
    imported_count: saved + updated,
    review_count: review,
    tab_count: costTabCount,
    recipe_tab_count: recipeTabCount,
    mapping_source: mappingSource,
    default_currency: input.currency,
    file_month: fileMonth,
    filename: input.filename,
    tabs: tabSummaries,
    review_items: reviewItems.map((r) => ({
      id: r.id,
      tab_name: r.tab_name,
      row_index: r.row_index,
      reason: r.reason,
      raw_values: r.raw_values,
      suggested: r.suggested,
      status: "pending" as const,
    })),
    ingredients_created: persistStats.ingredientsCreated,
    costs_updated: updated,
    saved_count: saved,
    skipped_count: skippedCount,
  };
}

export async function undoCostImportBatch(
  repo: CostWorkbookRepo,
  companyId: string,
  batchId: string
): Promise<
  | { ok: true; deleted: number; restored: number }
  | { ok: false; reason: string }
> {
  const batch = await repo.getBatch(companyId, batchId);
  if (!batch) return { ok: false, reason: "Import batch not found" };
  if (batch.undone_at) return { ok: false, reason: "Import already undone" };

  const snap = batch.undo_snapshot;
  const deleted = await repo.deleteCostEntriesByIds(
    companyId,
    snap.inserted_entry_ids
  );
  await repo.restoreCostEntries(
    companyId,
    snap.updated_entries.map((row) => row.before)
  );
  if (snap.created_ingredient_ids.length > 0) {
    try {
      await repo.deleteIngredients(companyId, snap.created_ingredient_ids);
    } catch (err) {
      console.error("[cost-workbook undo ingredients]", err);
    }
  }
  if (snap.ingredient_costs_before.length > 0) {
    await repo.updateIngredientCosts(
      snap.ingredient_costs_before.map((row) => ({
        ingredientId: row.id,
        currentUnitCost: row.current_unit_cost,
        currency: row.currency,
      }))
    );
  }
  await repo.markBatchUndone(companyId, batchId);
  return { ok: true, deleted, restored: snap.updated_entries.length };
}

export async function skipReviewItem(
  repo: CostWorkbookRepo,
  companyId: string,
  reviewId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = await repo.getReviewItem(companyId, reviewId);
  if (!item) return { ok: false, reason: "Review item not found" };
  if (item.status !== "pending") {
    return { ok: false, reason: "Review item already resolved" };
  }
  await repo.updateReviewItem(companyId, reviewId, {
    status: "skipped",
    resolved_at: new Date().toISOString(),
  });
  return { ok: true };
}

export async function approveReviewItem(
  repo: CostWorkbookRepo,
  companyId: string,
  reviewId: string,
  currency: string,
  edits: {
    ingredient_name?: string;
    unit?: string;
    quantity?: number | unknown;
    total_cost?: number | unknown;
    cost_date?: string;
  }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = await repo.getReviewItem(companyId, reviewId);
  if (!item) return { ok: false, reason: "Review item not found" };
  if (item.status !== "pending") {
    return { ok: false, reason: "Review item already resolved" };
  }
  const batch = await repo.getBatch(companyId, item.batch_id);
  if (!batch) return { ok: false, reason: "Import batch not found" };
  if (batch.undone_at) {
    return { ok: false, reason: "Import already undone" };
  }

  const quantityCheck = optionalNumber(edits.quantity, "quantity");
  if (!quantityCheck.ok) return quantityCheck;
  const totalCheck = optionalNumber(edits.total_cost, "total_cost");
  if (!totalCheck.ok) return totalCheck;

  const suggested = item.suggested ?? {};
  const name = edits.ingredient_name ?? suggested.ingredient_name ?? null;
  const unit = edits.unit ?? suggested.unit ?? null;
  const quantity = quantityCheck.value ?? suggested.quantity ?? 1;
  const total = totalCheck.value ?? suggested.total_cost ?? null;
  const costDate =
    edits.cost_date ??
    suggested.cost_date ??
    new Date().toISOString().slice(0, 10);
  if (!name) return { ok: false, reason: "Missing ingredient name" };
  if (!unit) return { ok: false, reason: "Missing unit" };
  if (!normalizeUnit(unit))
    return { ok: false, reason: `unknown unit (${unit})` };
  if (!total || total < 0) return { ok: false, reason: "Missing cost" };
  if (quantity <= 0)
    return { ok: false, reason: "Quantity must be a positive number" };

  const persistStats = await persistSavedRows({
    companyId,
    currency,
    batchId: item.batch_id,
    rows: [
      {
        tabName: item.tab_name,
        rowIndex: item.row_index,
        ingredient_name: name,
        quantity,
        unit,
        total_cost: total,
        unit_price: total / quantity,
        cost_date: costDate,
        supplier_name: suggested.supplier_name ?? null,
        currency,
        notes: null,
        raw: item.raw_values,
      },
    ],
    repo,
  });
  if (persistStats.failed[0]) {
    return { ok: false, reason: persistStats.failed[0].reason };
  }
  await repo.updateBatchSnapshot(
    companyId,
    item.batch_id,
    mergeUndoSnapshots(batch.undo_snapshot, persistStats.changes)
  );
  await repo.updateReviewItem(companyId, reviewId, {
    status: "approved",
    resolved_at: new Date().toISOString(),
  });
  return { ok: true };
}
