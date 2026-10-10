import {
  buildIngredientCostEntryInsert,
  nameKey,
} from "@/lib/restaurant/cost-import";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { WorkbookAi } from "./ai";
import { evaluateWorkbookRow } from "./parse";
import type { CostWorkbookRepo } from "./repo";
import { inferWorkbookDate } from "./date";
import { readWorkbookSheets } from "./sheets";
import {
  HIGH_TAB_CONFIDENCE,
  type ColumnMapping,
  type CostTabType,
  type MappingSource,
  type ReviewCandidate,
  type SavedLayoutMap,
  type TabImportSummary,
  type WorkbookImportResult,
  type WorkbookRowCandidate,
} from "./types";

export function buildImportHeadline(input: {
  imported: number;
  tabs: number;
  review: number;
}): string {
  const look =
    input.review === 1 ? "1 needs a look." : `${input.review} need a look.`;
  return `Imported ${input.imported} items from ${input.tabs} tabs. ${look}`;
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

export async function importCostWorkbook(input: {
  companyId: string;
  filename: string;
  buffer: Buffer;
  currency: string;
  repo: CostWorkbookRepo;
  ai: WorkbookAi;
  createdBy?: string | null;
}): Promise<WorkbookImportResult> {
  const sheets = readWorkbookSheets(input.buffer);
  const fileMonth =
    inferWorkbookDate(
      input.filename,
      sheets.map((s) => s.name)
    ) ?? new Date().toISOString().slice(0, 10);

  const savedMaps = await input.repo.listMappings(input.companyId);
  const savedByKey = new Map(savedMaps.map((m) => [m.layout_key, m]));

  const toSave: WorkbookRowCandidate[] = [];
  const toReview: ReviewCandidate[] = [];
  const tabSummaries: TabImportSummary[] = [];
  const mapsToPersist: SavedLayoutMap[] = [];
  const sources: Array<MappingSource | "none"> = [];
  let recipeTabCount = 0;
  let costTabCount = 0;

  for (const sheet of sheets) {
    const saved = savedByKey.get(sheet.layoutKey);
    let tabType: CostTabType;
    let tabConfidence: number;
    let mapping: ColumnMapping = {};
    let mappingSource: MappingSource | "none" = "none";
    let note: string | undefined;

    if (saved && saved.tab_confidence >= HIGH_TAB_CONFIDENCE) {
      tabType = saved.tab_type;
      tabConfidence = saved.tab_confidence;
      mapping = saved.column_mapping;
      mappingSource = "saved";
    } else {
      const classified = await input.ai.classifyTab({
        sheetName: sheet.name,
        headers: sheet.headers,
        sampleRows: sheet.sampleRows,
      });
      tabType = classified.type;
      tabConfidence = classified.confidence;
      note = classified.notes;
      mappingSource = "ai";
      if (tabType !== "recipe" && tabType !== "ignore") {
        mapping = await input.ai.mapColumns({
          tabType,
          headers: sheet.headers,
          sampleRows: sheet.sampleRows,
        });
      }
    }

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
      if (mappingSource !== "saved") {
        mapsToPersist.push({
          layout_key: sheet.layoutKey,
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
      if (mappingSource !== "saved") {
        mapsToPersist.push({
          layout_key: sheet.layoutKey,
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
    importedCount: toSave.length,
    reviewCount: toReview.length,
    tabSummaries,
    mappingSource,
    createdBy: input.createdBy ?? null,
  });

  const persistStats = await persistSavedRows({
    companyId: input.companyId,
    currency: input.currency,
    batchId: batch.id,
    rows: toSave,
    repo: input.repo,
  });

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

  return {
    kind: "workbook",
    batch_id: batch.id,
    headline: buildImportHeadline({
      imported: toSave.length,
      tabs: costTabCount,
      review: toReview.length,
    }),
    imported_count: toSave.length,
    review_count: toReview.length,
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
    costs_updated: persistStats.updated,
  };
}

async function persistSavedRows(input: {
  companyId: string;
  currency: string;
  batchId: string;
  rows: WorkbookRowCandidate[];
  repo: CostWorkbookRepo;
}): Promise<{ ingredientsCreated: number; updated: number }> {
  const ingredients = await input.repo.listIngredients(input.companyId);
  const byName = new Map(
    ingredients.filter((i) => i.name).map((i) => [nameKey(i.name), i])
  );
  let ingredientsCreated = 0;
  let updated = 0;

  for (const row of input.rows) {
    const key = nameKey(row.ingredient_name);
    let ingredient = byName.get(key);
    const defaultUnit = normalizeUnit(row.unit) ?? row.unit;
    if (!ingredient) {
      ingredient = await input.repo.createIngredient({
        companyId: input.companyId,
        name: row.ingredient_name,
        defaultUnit,
        currentUnitCost: row.unit_price,
        currency: input.currency,
      });
      byName.set(key, ingredient);
      ingredientsCreated += 1;
    }

    const built = buildIngredientCostEntryInsert({
      companyId: input.companyId,
      ingredientId: ingredient.id,
      ingredientDefaultUnit: ingredient.default_unit,
      supplierId: null,
      sourceId: input.batchId,
      row: {
        rowIndex: row.rowIndex,
        cost_date: row.cost_date,
        supplier_name: row.supplier_name ?? "",
        ingredient_name: row.ingredient_name,
        quantity: row.quantity,
        unit: row.unit,
        total_cost: row.total_cost,
        currency: input.currency,
        notes: row.notes,
        supplier_item_name: null,
        supplier_sku: null,
      },
    });
    if (!built.ok) {
      continue;
    }

    const existing = await input.repo.findImportCostEntry({
      companyId: input.companyId,
      ingredientId: ingredient.id,
      costDate: row.cost_date,
    });
    if (existing) {
      await input.repo.updateCostEntry(existing.id, {
        ...built.insert,
        source_id: input.batchId,
      });
      updated += 1;
    } else {
      await input.repo.insertCostEntry(built.insert);
    }
    await input.repo.updateIngredientCost(
      ingredient.id,
      built.insert.normalized_unit_cost,
      input.currency
    );
  }

  return { ingredientsCreated, updated };
}

export async function undoCostImportBatch(
  repo: CostWorkbookRepo,
  companyId: string,
  batchId: string
): Promise<{ ok: true; deleted: number } | { ok: false; reason: string }> {
  const batch = await repo.getBatch(companyId, batchId);
  if (!batch) return { ok: false, reason: "Import batch not found" };
  if (batch.undone_at) return { ok: false, reason: "Import already undone" };
  const deleted = await repo.deleteCostEntriesByBatch(companyId, batchId);
  await repo.markBatchUndone(companyId, batchId);
  return { ok: true, deleted };
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
  await repo.updateReviewItem(reviewId, {
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
    quantity?: number;
    total_cost?: number;
    cost_date?: string;
  }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = await repo.getReviewItem(companyId, reviewId);
  if (!item) return { ok: false, reason: "Review item not found" };
  if (item.status !== "pending") {
    return { ok: false, reason: "Review item already resolved" };
  }
  const suggested = item.suggested ?? {};
  const name = edits.ingredient_name ?? suggested.ingredient_name ?? null;
  const unit = edits.unit ?? suggested.unit ?? null;
  const quantity = edits.quantity ?? suggested.quantity ?? 1;
  const total = edits.total_cost ?? suggested.total_cost ?? null;
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

  await persistSavedRows({
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
  await repo.updateReviewItem(reviewId, {
    status: "approved",
    resolved_at: new Date().toISOString(),
  });
  return { ok: true };
}
