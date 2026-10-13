// Save a reviewed price catalog, and record a person's choice when the
// price list and the recipe sheets disagree.
//
// Rules this file enforces:
// - A price is only saved when its unit was read directly, or a person
//   confirmed it. Anything uncertain stays pending.
// - Preparations are not ingredients: they are never created here.
// - Both values of a conflict are preserved (the unchosen one in the
//   review item). Only a chosen value ever becomes a cost entry, so the
//   latest-cost lookup cannot silently prefer a recipe-sheet number.
// - Every row is written in the company currency, never a DB default.

import { buildIngredientCostEntryInsert } from "@/lib/restaurant/cost-import";
import { inferDateFromName } from "@/lib/restaurant/cost-workbook/date";
import { persistSavedRows } from "@/lib/restaurant/cost-workbook/persist";
import type { CostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { mergeUndoSnapshots } from "@/lib/restaurant/cost-workbook/snapshot";
import { compactCandidateBlocks } from "@/lib/restaurant/cost-workbook/stored-blocks";
import {
  emptyUndoSnapshot,
  type GroupedRecipe,
  type ReviewCandidate,
  type UndoSnapshot,
  type WorkbookRowCandidate,
} from "@/lib/restaurant/cost-workbook/types";
import { resolveIngredientPriceDate } from "@/lib/restaurant/price-date";
import {
  findCostConflicts,
  type CostConflict,
  type RecipeCostObservation,
} from "./conflicts";
import type { CatalogUnit, PriceCatalogRead, PriceCatalogRow } from "./reader";

export const COST_CONFLICT_KIND = "cost_conflict";

export interface RowDecision {
  /** Treat this row as an ingredient, a preparation, or leave it out. */
  kind?: "ingredient" | "preparation" | "skip";
  /** A person's confirmed unit and price for an uncertain row. */
  unit?: CatalogUnit;
  unitCost?: number;
  /** Keep a row that repeats an earlier name. */
  keepDuplicate?: boolean;
}

export interface PriceCatalogDecisions {
  rows?: Record<string, RowDecision>;
  /** Conflict key -> "catalog" or the index of the chosen candidate. */
  conflicts?: Record<string, "catalog" | number>;
}

const UNITS: readonly CatalogUnit[] = ["oz", "lb", "unit", "g"];

function isUnit(value: unknown): value is CatalogUnit {
  return typeof value === "string" && UNITS.includes(value as CatalogUnit);
}

function validCost(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 100000
  );
}

/** Parse the decisions a client sent. Unknown or invalid input is dropped. */
export function parseDecisions(raw: unknown): PriceCatalogDecisions {
  const out: PriceCatalogDecisions = { rows: {}, conflicts: {} };
  if (!raw || typeof raw !== "object") return out;
  const body = raw as Record<string, unknown>;
  const rows = body.rows;
  if (rows && typeof rows === "object") {
    for (const [key, value] of Object.entries(rows)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const decision: RowDecision = {};
      if (
        v.kind === "ingredient" ||
        v.kind === "preparation" ||
        v.kind === "skip"
      ) {
        decision.kind = v.kind;
      }
      if (isUnit(v.unit)) decision.unit = v.unit;
      if (validCost(v.unitCost)) decision.unitCost = v.unitCost;
      if (v.keepDuplicate === true) decision.keepDuplicate = true;
      out.rows![key] = decision;
    }
  }
  const conflicts = body.conflicts;
  if (conflicts && typeof conflicts === "object") {
    for (const [key, value] of Object.entries(conflicts)) {
      if (value === "catalog") out.conflicts![key] = "catalog";
      else if (Number.isInteger(value) && (value as number) >= 0) {
        out.conflicts![key] = value as number;
      }
    }
  }
  return out;
}

export interface PlannedRow {
  row: PriceCatalogRow;
  unit: CatalogUnit;
  unitCost: number;
}

export interface CatalogPlan {
  /** Rows that will be saved. */
  save: PlannedRow[];
  /** Rows that still need a decision (unit unclear, error cell, ...). */
  pending: Array<{ row: PriceCatalogRow; reason: string }>;
  /** Rows treated as preparations: not saved as ingredients. */
  preparations: number;
  /** Rows the user left out, or repeated names that were not kept. */
  skipped: number;
  /** The catalog as it will be saved (after the user's confirmations). */
  effective: PriceCatalogRow[];
}

export function planCatalog(
  read: PriceCatalogRead,
  decisions: PriceCatalogDecisions = {}
): CatalogPlan {
  const save: PlannedRow[] = [];
  const pending: CatalogPlan["pending"] = [];
  const effective: PriceCatalogRow[] = [];
  let preparations = 0;
  let skipped = 0;

  for (const row of read.rows) {
    const decision = decisions.rows?.[row.key] ?? {};
    const kind = decision.kind ?? row.kind;
    if (kind === "skip") {
      skipped += 1;
      continue;
    }
    if (kind === "preparation") {
      preparations += 1;
      continue;
    }
    if (row.status === "duplicate_name" && !decision.keepDuplicate) {
      skipped += 1;
      continue;
    }

    let unit = row.unit;
    let unitCost = row.unitCost;
    const confirmed = decision.unit !== undefined;
    if (decision.unit !== undefined) unit = decision.unit;
    if (decision.unitCost !== undefined) unitCost = decision.unitCost;
    else if (confirmed) {
      const option = row.options.find((o) => o.unit === decision.unit);
      if (option) unitCost = option.unitCost;
    }

    const needsConfirmation =
      row.status === "check_unit" || row.status === "ambiguous_unit";
    if (row.status === "error_cell") {
      pending.push({
        row,
        reason: "El precio de esta fila tiene un error en tu archivo.",
      });
      continue;
    }
    if (row.status === "no_price") {
      pending.push({ row, reason: "Esta fila no trae precio." });
      continue;
    }
    if (needsConfirmation && !confirmed) {
      pending.push({
        row,
        reason: "Falta confirmar la unidad de esta fila.",
      });
      continue;
    }
    if (unit === null || unitCost === null || !(unitCost > 0)) {
      pending.push({ row, reason: "Falta la unidad o el precio." });
      continue;
    }
    save.push({ row, unit, unitCost });
    effective.push({
      ...row,
      kind: "ingredient",
      unit,
      unitCost,
      status: "ok",
    });
  }

  return { save, pending, preparations, skipped, effective };
}

function priceDate(filename: string) {
  const today = new Date().toISOString().slice(0, 10);
  const named = inferDateFromName(filename);
  const dated = resolveIngredientPriceDate({
    priceListDate: named,
    uploadDate: today,
    kind: "price_list",
  });
  return { ...dated, fileMonth: named };
}

function candidateRow(
  conflict: CostConflict,
  index: number,
  currency: string,
  costDate: string,
  batchId: string,
  ingredientId: string,
  defaultUnit: string | null
) {
  const candidate = conflict.candidates[index];
  if (!candidate) return null;
  const built = buildIngredientCostEntryInsert({
    companyId: "",
    ingredientId,
    ingredientDefaultUnit: defaultUnit,
    supplierId: null,
    sourceId: batchId,
    row: {
      rowIndex: candidate.sample.row,
      cost_date: costDate,
      supplier_name: "",
      ingredient_name: conflict.name,
      quantity: 1,
      unit: candidate.unit,
      total_cost: candidate.unitCost,
      currency,
      notes: `Receta · ${candidate.sample.tab} · fila ${candidate.sample.row} (elegido)`,
      supplier_item_name: null,
      supplier_sku: null,
    },
  });
  return built.ok ? built.insert : null;
}

/** Record the person's choice for one conflict. */
async function chooseCost(input: {
  repo: CostWorkbookRepo;
  companyId: string;
  userId: string | null;
  currency: string;
  batchId: string;
  conflict: CostConflict;
  choice: "catalog" | number;
  costDate: string;
  dateSource: ReturnType<typeof priceDate>["date_source"];
}): Promise<
  { ok: true; insertedEntryId: string | null } | { ok: false; reason: string }
> {
  const ingredients = await input.repo.listIngredients(input.companyId);
  const ingredient = ingredients.find(
    (row) =>
      row.name.trim().toUpperCase() === input.conflict.name.trim().toUpperCase()
  );
  if (!ingredient) {
    return { ok: false, reason: "No encontré el ingrediente en tu lista." };
  }

  if (input.choice === "catalog") {
    const entries = await input.repo.listIngredientCostEntries(
      input.companyId,
      [ingredient.id]
    );
    const mine = entries
      .filter((entry) => entry.source_id === input.batchId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    const target =
      mine ??
      entries.sort((a, b) =>
        (a.effective_date ?? a.cost_date) < (b.effective_date ?? b.cost_date)
          ? 1
          : -1
      )[0];
    if (!target) {
      return { ok: false, reason: "No encontré el precio de la lista." };
    }
    await input.repo.setIngredientChosenCost({
      companyId: input.companyId,
      ingredientId: ingredient.id,
      costEntryId: target.id,
      chosenBy: input.userId,
    });
    return { ok: true, insertedEntryId: null };
  }

  const insert = candidateRow(
    input.conflict,
    input.choice,
    input.currency,
    input.costDate,
    input.batchId,
    ingredient.id,
    ingredient.default_unit
  );
  if (!insert) {
    return {
      ok: false,
      reason: "No pude convertir ese costo a la unidad del ingrediente.",
    };
  }
  const [created] = await input.repo.insertCostEntries([
    {
      ...insert,
      company_id: input.companyId,
      effective_date: input.costDate,
      date_source: input.dateSource,
    },
  ]);
  if (!created)
    return { ok: false, reason: "No pude guardar el costo elegido." };
  await input.repo.updateIngredientCosts([
    {
      ingredientId: ingredient.id,
      currentUnitCost: created.normalized_unit_cost,
      currency: input.currency,
    },
  ]);
  await input.repo.setIngredientChosenCost({
    companyId: input.companyId,
    ingredientId: ingredient.id,
    costEntryId: created.id,
    chosenBy: input.userId,
  });
  return { ok: true, insertedEntryId: created.id };
}

export interface ApplyCatalogResult {
  batch_id: string;
  saved: number;
  ingredients_created: number;
  pending_rows: number;
  preparations_left_out: number;
  skipped: number;
  conflicts_total: number;
  conflicts_decided: number;
  conflicts_open: number;
  failed: number;
}

export async function applyPriceCatalog(input: {
  repo: CostWorkbookRepo;
  companyId: string;
  userId: string | null;
  currency: string;
  filename: string;
  read: PriceCatalogRead;
  observations: readonly RecipeCostObservation[];
  decisions: PriceCatalogDecisions;
  /** Recipe blocks of the same file: kept so suggestions can use them. */
  candidateBlocks?: readonly GroupedRecipe[];
}): Promise<ApplyCatalogResult> {
  const plan = planCatalog(input.read, input.decisions);
  const date = priceDate(input.filename);

  const batch = await input.repo.createBatch({
    companyId: input.companyId,
    filename: input.filename,
    fileMonth: date.fileMonth,
    currency: input.currency,
    importedCount: plan.save.length,
    reviewCount: plan.pending.length,
    tabSummaries: [],
    mappingSource: "heuristic",
    createdBy: input.userId,
  });

  const rows: WorkbookRowCandidate[] = plan.save.map(
    ({ row, unit, unitCost }) => ({
      tabName: row.sheet,
      rowIndex: row.row,
      ingredient_name: row.name,
      quantity: 1,
      unit,
      total_cost: unitCost,
      unit_price: unitCost,
      cost_date: date.effective_date,
      effective_date: date.effective_date,
      date_source: date.date_source,
      supplier_name: null,
      currency: input.currency,
      notes: `${row.sheet} · fila ${row.row}`,
      raw: {},
      category: row.section,
    })
  );

  const persisted = await persistSavedRows({
    companyId: input.companyId,
    currency: input.currency,
    batchId: batch.id,
    rows,
    repo: input.repo,
    skipDuplicates: false,
  });

  let snapshot: UndoSnapshot = mergeUndoSnapshots(
    emptyUndoSnapshot(),
    persisted.changes
  );

  const conflicts = findCostConflicts(plan.effective, input.observations);
  let decided = 0;
  const open: CostConflict[] = [];
  for (const conflict of conflicts) {
    const choice = input.decisions.conflicts?.[conflict.key];
    if (choice === undefined) {
      open.push(conflict);
      continue;
    }
    const result = await chooseCost({
      repo: input.repo,
      companyId: input.companyId,
      userId: input.userId,
      currency: input.currency,
      batchId: batch.id,
      conflict,
      choice,
      costDate: date.effective_date,
      dateSource: date.date_source,
    });
    if (result.ok) {
      decided += 1;
      if (result.insertedEntryId) {
        snapshot = mergeUndoSnapshots(snapshot, {
          ...emptyUndoSnapshot(),
          inserted_entry_ids: [result.insertedEntryId],
        });
      }
    } else {
      open.push(conflict);
    }
  }

  if (input.candidateBlocks && input.candidateBlocks.length > 0) {
    snapshot.candidate_blocks = compactCandidateBlocks(input.candidateBlocks);
  }
  await input.repo.updateBatchSnapshot(input.companyId, batch.id, snapshot);

  const review: Array<
    Omit<Parameters<CostWorkbookRepo["insertReviewItems"]>[0][number], never>
  > = [];
  for (const conflict of open) {
    review.push({
      company_id: input.companyId,
      batch_id: batch.id,
      tab_name: input.read.sheet,
      row_index: Number(conflict.catalog.rowKey.split("|").pop()) || 0,
      reason: `Dos costos para ${conflict.name}. Confirma cuál usar.`,
      raw_values: {
        kind: COST_CONFLICT_KIND,
        key: conflict.key,
        name: conflict.name,
        catalog: conflict.catalog,
        candidates: conflict.candidates,
      },
      suggested: null,
      status: "pending",
    });
  }
  for (const item of plan.pending) {
    review.push({
      company_id: input.companyId,
      batch_id: batch.id,
      tab_name: item.row.sheet,
      row_index: item.row.row,
      reason: item.reason,
      raw_values: { kind: "catalog_row", name: item.row.name },
      suggested: null,
      status: "pending",
    });
  }
  for (const failed of persisted.failed as ReviewCandidate[]) {
    review.push({
      company_id: input.companyId,
      batch_id: batch.id,
      tab_name: failed.tabName,
      row_index: failed.rowIndex,
      reason: failed.reason,
      raw_values: { kind: "catalog_row" },
      suggested: failed.suggested,
      status: "pending",
    });
  }
  if (review.length > 0) await input.repo.insertReviewItems(review);

  return {
    batch_id: batch.id,
    saved: persisted.inserted + persisted.updated,
    ingredients_created: persisted.ingredientsCreated,
    pending_rows: plan.pending.length,
    preparations_left_out: plan.preparations,
    skipped: plan.skipped,
    conflicts_total: conflicts.length,
    conflicts_decided: decided,
    conflicts_open: open.length,
    failed: persisted.failed.length,
  };
}

/** Resolve a conflict that was left open at upload time. */
export async function resolveCostConflict(input: {
  repo: CostWorkbookRepo;
  companyId: string;
  userId: string | null;
  currency: string;
  reviewId: string;
  choice: "catalog" | number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = await input.repo.getReviewItem(input.companyId, input.reviewId);
  if (!item || item.raw_values.kind !== COST_CONFLICT_KIND) {
    return { ok: false, reason: "No encontré esa decisión." };
  }
  if (item.status !== "pending") {
    return { ok: false, reason: "Esa decisión ya está resuelta." };
  }
  const batch = await input.repo.getBatch(input.companyId, item.batch_id);
  if (!batch || batch.undone_at) {
    return { ok: false, reason: "Esa carga ya se deshizo." };
  }
  const conflict = item.raw_values as unknown as CostConflict;
  if (
    input.choice !== "catalog" &&
    (!Number.isInteger(input.choice) || !conflict.candidates?.[input.choice])
  ) {
    return { ok: false, reason: "Esa opción no existe." };
  }
  const date = priceDate(batch.filename);
  const result = await chooseCost({
    repo: input.repo,
    companyId: input.companyId,
    userId: input.userId,
    currency: input.currency,
    batchId: item.batch_id,
    conflict,
    choice: input.choice,
    costDate: date.effective_date,
    dateSource: date.date_source,
  });
  if (!result.ok) return result;
  if (result.insertedEntryId) {
    await input.repo.updateBatchSnapshot(
      input.companyId,
      item.batch_id,
      mergeUndoSnapshots(batch.undo_snapshot, {
        ...emptyUndoSnapshot(),
        inserted_entry_ids: [result.insertedEntryId],
      })
    );
  }
  await input.repo.updateReviewItem(input.companyId, item.id, {
    status: "approved",
    resolved_at: new Date().toISOString(),
  });
  return { ok: true };
}
