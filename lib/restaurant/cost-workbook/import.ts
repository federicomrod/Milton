import { normalizeUnit } from "@/lib/restaurant/units";
import type { WorkbookAi } from "./ai";
import { classifyCostTabHeuristic } from "./ai";
import { categoryForTab } from "./categories";
import { retireImportedPreparedIngredients } from "./convert";
import { inferWorkbookDate } from "./date";
import { mergeTypoDuplicates } from "./duplicates";
import { layoutKeyForSheet } from "./header";
import { evaluateWorkbookRow } from "./parse";
import { dedupeWorkbookRows, persistSavedRows } from "./persist";
import { linkMenuItemsToPos, persistWorkbookRecipes } from "./persist-recipes";
import { mapPool, WORKBOOK_AI_CONCURRENCY } from "./pool";
import { matchesPreparedName, preparedNamesFromGroups } from "./prepared";
import type { CostWorkbookRepo } from "./repo";
import { collectRecipeLines } from "./recipes";
import { mappingPassesSanity } from "./sanity";
import { readWorkbookSheets } from "./sheets";
import {
  groupSkipReasons,
  isNoPriceReviewReason,
  skipReasonForWorkbookRow,
} from "./skip";
import { mergeUndoSnapshots } from "./snapshot";
import {
  HIGH_TAB_CONFIDENCE,
  emptyUndoSnapshot,
  type ColumnMapping,
  type CostTabType,
  type DetectedSheet,
  type GroupedRecipe,
  type MappingSource,
  type ReviewCandidate,
  type SavedLayoutMap,
  type SkipCandidate,
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
  if (type === "recipe" || type === "sub_recipe") {
    return Boolean(
      mapping.ingredient_name?.column &&
      mapping.quantity?.column &&
      mapping.unit?.column
    );
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
  if (classified.type !== "ignore") {
    mapping = await ai.mapColumns({
      tabType: classified.type,
      headers: sheet.headers,
      sampleRows: sheet.sampleRows,
    });
  }

  const sane =
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

  const existingIngredients = await input.repo.listIngredients(input.companyId);
  const existingCategories = [
    ...new Set(
      existingIngredients
        .map((item) => item.category)
        .filter((value): value is string => Boolean(value?.trim()))
    ),
  ];

  const toSave: WorkbookRowCandidate[] = [];
  const toReview: ReviewCandidate[] = [];
  const skipped: SkipCandidate[] = [];
  const recipeGroups: GroupedRecipe[] = [];
  const tabSummaries: TabImportSummary[] = [];
  const mapsToPersist: SavedLayoutMap[] = [];
  const sources: Array<MappingSource | "none"> = [];
  let recipeTabCount = 0;
  let costTabCount = 0;

  const rememberMapping = (
    resolved: ResolvedTab,
    tabType: CostTabType,
    mapping: ColumnMapping
  ) => {
    if (resolved.mappingSource === "saved" || !resolved.persistMapping) return;
    if (
      !mappingPassesSanity({
        tabType,
        dataRows: resolved.sheet.dataRows,
        mapping,
        currency: input.currency,
        defaultDate: fileMonth,
      })
    ) {
      return;
    }
    mapsToPersist.push({
      layout_key: layoutKeyForSheet(resolved.sheet.headers, tabType),
      tab_name: resolved.sheet.name,
      tab_type: tabType,
      column_mapping: mapping,
      header_fingerprint: resolved.sheet.headerFingerprint,
      tab_confidence: resolved.tabConfidence,
    });
  };

  const processRecipeTab = (resolved: ResolvedTab) => {
    const { sheet, tabType, tabConfidence, mapping, mappingSource, note } =
      resolved;
    recipeTabCount += 1;
    const collected = collectRecipeLines({
      tabName: sheet.name,
      tabKind: tabType === "sub_recipe" ? "sub_recipe" : "recipe",
      dataRows: sheet.dataRows,
      mapping,
    });
    recipeGroups.push(...collected.groups);
    toReview.push(...collected.review);
    skipped.push(...collected.skipped);
    rememberMapping(resolved, tabType, mapping);
    tabSummaries.push({
      name: sheet.name,
      type: tabType,
      confidence: tabConfidence,
      mapping_source: mappingSource,
      column_mapping: mapping,
      imported_count: collected.groups.reduce(
        (sum, group) => sum + group.lines.length,
        0
      ),
      review_count: collected.review.length,
      skipped_count: collected.skipped.length,
      skipped_reasons: groupSkipReasons(collected.skipped),
      preview: sheet.sampleRows,
      note:
        note ??
        (tabType === "sub_recipe" ? "sub-recipe / prep item" : "recipe"),
    });
  };

  for (const resolved of resolvedTabs) {
    sources.push(resolved.mappingSource);
    if (resolved.tabType === "ignore") {
      tabSummaries.push({
        name: resolved.sheet.name,
        type: resolved.tabType,
        confidence: resolved.tabConfidence,
        mapping_source: resolved.mappingSource,
        column_mapping: resolved.mapping,
        imported_count: 0,
        review_count: 0,
        skipped_count: 0,
        skipped_reasons: [],
        preview: resolved.sheet.sampleRows,
        note: "skipped",
      });
      continue;
    }
    if (resolved.tabType === "recipe" || resolved.tabType === "sub_recipe") {
      processRecipeTab(resolved);
    }
  }

  const preparedNames = preparedNamesFromGroups(recipeGroups);

  for (const resolved of resolvedTabs) {
    const { sheet, tabType, tabConfidence, mapping, mappingSource, note } =
      resolved;
    if (
      tabType === "ignore" ||
      tabType === "recipe" ||
      tabType === "sub_recipe"
    ) {
      continue;
    }

    costTabCount += 1;
    let imported = 0;
    let review = 0;
    const tabSkips: SkipCandidate[] = [];
    const category = categoryForTab(tabType, sheet.name, existingCategories);

    for (const [i, row] of sheet.dataRows.entries()) {
      const skipReason = skipReasonForWorkbookRow(tabType, row, mapping);
      if (skipReason) {
        tabSkips.push({
          tabName: sheet.name,
          rowIndex: i,
          reason: skipReason,
          raw: row,
        });
        continue;
      }
      if (!requiredMapped(tabType, mapping)) {
        tabSkips.push({
          tabName: sheet.name,
          rowIndex: i,
          reason: "no price",
          raw: row,
        });
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
        const prepared = matchesPreparedName(
          result.value.ingredient_name,
          preparedNames
        );
        if (prepared) {
          tabSkips.push({
            tabName: sheet.name,
            rowIndex: i,
            reason: "prepared item / sub-recipe",
            raw: row,
          });
          continue;
        }
        toSave.push({
          ...result.value,
          category,
        });
        imported += 1;
        continue;
      }
      if (isNoPriceReviewReason(result.review.reason)) {
        tabSkips.push({
          tabName: sheet.name,
          rowIndex: i,
          reason: "no price",
          raw: row,
        });
        continue;
      }
      toReview.push(result.review);
      review += 1;
    }

    skipped.push(...tabSkips);
    rememberMapping(resolved, tabType, mapping);
    tabSummaries.push({
      name: sheet.name,
      type: tabType,
      confidence: tabConfidence,
      mapping_source: mappingSource,
      column_mapping: mapping,
      imported_count: imported,
      review_count: review,
      skipped_count: tabSkips.length,
      skipped_reasons: groupSkipReasons(tabSkips),
      preview: sheet.sampleRows,
      note,
    });
  }

  const accountSkip = (skip: ReviewCandidate | SkipCandidate) => {
    skipped.push({
      tabName: skip.tabName,
      rowIndex: skip.rowIndex,
      reason: skip.reason,
      raw: skip.raw,
    });
    const tab = tabSummaries.find((t) => t.name === skip.tabName);
    if (tab && tab.imported_count > 0) tab.imported_count -= 1;
    if (tab) {
      tab.skipped_count += 1;
      tab.skipped_reasons = groupSkipReasons(
        skipped.filter((row) => row.tabName === tab.name)
      );
    }
  };

  const accountReview = (item: ReviewCandidate) => {
    toReview.push(item);
    const tab = tabSummaries.find((t) => t.name === item.tabName);
    if (tab) tab.review_count += 1;
  };

  const deduped = dedupeWorkbookRows(toSave);
  for (const skip of deduped.skipped) accountSkip(skip);

  const merged = mergeTypoDuplicates(deduped.rows, existingIngredients);
  for (const skip of merged.skipped) accountSkip(skip);
  for (const hint of merged.hints) accountReview(hint);

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
    importedCount: merged.rows.length,
    reviewCount: toReview.length,
    tabSummaries,
    mappingSource,
    createdBy: input.createdBy ?? null,
  });

  const retired = await retireImportedPreparedIngredients({
    companyId: input.companyId,
    preparedNames,
    repo: input.repo,
  });
  if (
    retired.deleted_ingredients.length > 0 ||
    retired.deleted_cost_entries.length > 0
  ) {
    await input.repo.updateBatchSnapshot(input.companyId, batch.id, retired);
  }

  const persistStats = await persistSavedRows({
    companyId: input.companyId,
    currency: input.currency,
    batchId: batch.id,
    rows: merged.rows,
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

  const recipeStats = await persistWorkbookRecipes({
    companyId: input.companyId,
    batchId: batch.id,
    currency: input.currency,
    groups: recipeGroups,
    repo: input.repo,
    aliases: merged.aliases,
  });
  toReview.push(...recipeStats.review);
  skipped.push(...recipeStats.skipped);

  const createdMenuItems = await input.repo.listMenuItems(input.companyId);
  const importedMenuItems = createdMenuItems.filter(
    (item) =>
      item.source_id === batch.id ||
      recipeStats.changes.created_menu_item_ids.includes(item.id)
  );
  const posStats = await linkMenuItemsToPos({
    companyId: input.companyId,
    menuItems:
      importedMenuItems.length > 0 ? importedMenuItems : createdMenuItems,
    repo: input.repo,
  });
  toReview.push(...posStats.review);
  skipped.push(...posStats.skipped);
  recipeStats.changes.created_mapping_ids.push(...posStats.mappingIds);

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

  const snapshot = mergeUndoSnapshots(
    mergeUndoSnapshots(retired, persistStats.changes),
    recipeStats.changes
  );
  await input.repo.updateBatchSnapshot(input.companyId, batch.id, snapshot);

  const saved = persistStats.inserted;
  const updated = persistStats.updated;
  const review = toReview.length;
  const skippedReasons = groupSkipReasons(skipped);

  return {
    kind: "workbook",
    batch_id: batch.id,
    headline: buildImportHeadline({
      saved,
      updated,
      tabs: costTabCount,
      review,
      skipped: skipped.length,
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
    skipped_count: skipped.length,
    skipped_reasons: skippedReasons,
    menu_items_created: recipeStats.menuItemsCreated,
    recipes_created: recipeStats.recipesCreated,
    sub_recipes_created: recipeStats.subRecipesCreated,
    pos_links_created: posStats.linked,
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

  if ((snap.deleted_ingredients ?? []).length > 0) {
    await repo.restoreIngredients(
      snap.deleted_ingredients.map((row) => ({
        id: row.id,
        companyId: companyId,
        name: row.name,
        category: row.category,
        defaultUnit: row.default_unit,
        currentUnitCost: row.current_unit_cost,
        currency: row.currency,
      }))
    );
  }
  if ((snap.deleted_cost_entries ?? []).length > 0) {
    await repo.restoreCostEntries(companyId, snap.deleted_cost_entries);
  }
  for (const recipe of snap.updated_recipes ?? []) {
    await repo.replaceRecipeInputs(companyId, recipe.id, recipe.inputs);
  }
  for (const component of snap.updated_components ?? []) {
    await repo.replaceComponentRecipeInputs(
      companyId,
      component.id,
      component.inputs
    );
  }
  await repo.deletePosMappings(companyId, snap.created_mapping_ids ?? []);
  await repo.deleteRecipes(companyId, snap.created_recipe_ids ?? []);
  await repo.deleteMenuItems(companyId, snap.created_menu_item_ids ?? []);
  await repo.deleteComponentRecipes(
    companyId,
    snap.created_component_recipe_ids ?? []
  );
  await repo.deleteComponents(companyId, snap.created_component_ids ?? []);

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
  if ((snap.ingredient_categories_before ?? []).length > 0) {
    await repo.updateIngredientCategories(
      snap.ingredient_categories_before.map((row) => ({
        ingredientId: row.id,
        category: row.category,
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
  if (item.reason.startsWith("POS name unsure")) {
    const menuName = edits.ingredient_name ?? suggested.ingredient_name ?? null;
    const posName =
      (typeof suggested.notes === "string" && suggested.notes) ||
      (typeof item.raw_values.raw_pos_item_name === "string"
        ? item.raw_values.raw_pos_item_name
        : null);
    if (!menuName || !posName) {
      return { ok: false, reason: "Missing POS match" };
    }
    const menuItems = await repo.listMenuItems(companyId);
    const menu = menuItems.find(
      (row) => row.name.trim().toLowerCase() === menuName.trim().toLowerCase()
    );
    if (!menu) return { ok: false, reason: "Menu item not found" };
    const created = await repo.createPosMappings([
      {
        companyId,
        rawPosItemName: posName,
        menuItemId: menu.id,
      },
    ]);
    if (created[0]) {
      await repo.updateBatchSnapshot(
        companyId,
        item.batch_id,
        mergeUndoSnapshots(batch.undo_snapshot, {
          ...emptyUndoSnapshot(),
          created_mapping_ids: [created[0].id],
        })
      );
    }
    await repo.updateReviewItem(companyId, reviewId, {
      status: "approved",
      resolved_at: new Date().toISOString(),
    });
    return { ok: true };
  }

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
