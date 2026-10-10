import {
  buildIngredientCostEntryInsert,
  nameKey,
  type IngredientCostEntryInsert,
} from "@/lib/restaurant/cost-import";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { CostWorkbookRepo } from "./repo";
import { cloneCostEntry, costMonthKey } from "./snapshot";
import type {
  ReviewCandidate,
  UndoSnapshot,
  WorkbookRowCandidate,
} from "./types";
import { emptyUndoSnapshot } from "./types";

export function dedupeWorkbookRows(rows: WorkbookRowCandidate[]): {
  rows: WorkbookRowCandidate[];
  skipped: ReviewCandidate[];
} {
  const indexByKey = new Map<string, number>();
  const kept: WorkbookRowCandidate[] = [];
  const skipped: ReviewCandidate[] = [];

  for (const row of rows) {
    const key = `${nameKey(row.ingredient_name)}|${costMonthKey(row.cost_date)}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, kept.length);
      kept.push(row);
      continue;
    }
    const previous = kept[existingIndex];
    skipped.push({
      tabName: previous.tabName,
      rowIndex: previous.rowIndex,
      reason: "same ingredient already on another tab this month",
      raw: previous.raw,
      suggested: {
        ingredient_name: previous.ingredient_name,
        unit: previous.unit,
        quantity: previous.quantity,
        total_cost: previous.total_cost,
        cost_date: previous.cost_date,
      },
    });
    kept[existingIndex] = row;
  }

  return { rows: kept, skipped };
}

export async function persistSavedRows(input: {
  companyId: string;
  currency: string;
  batchId: string;
  rows: WorkbookRowCandidate[];
  repo: CostWorkbookRepo;
}): Promise<{
  ingredientsCreated: number;
  inserted: number;
  updated: number;
  failed: ReviewCandidate[];
  changes: UndoSnapshot;
}> {
  const ingredients = await input.repo.listIngredients(input.companyId);
  const byName = new Map(
    ingredients.filter((i) => i.name).map((i) => [nameKey(i.name), i])
  );
  const changes = emptyUndoSnapshot();
  const failed: ReviewCandidate[] = [];
  const ready: Array<{
    row: WorkbookRowCandidate;
    insert: IngredientCostEntryInsert;
    name: string;
    defaultUnit: string;
  }> = [];

  for (const row of input.rows) {
    const key = nameKey(row.ingredient_name);
    const existing = byName.get(key);
    const defaultUnit =
      existing?.default_unit ?? normalizeUnit(row.unit) ?? row.unit;
    const built = buildIngredientCostEntryInsert({
      companyId: input.companyId,
      ingredientId: existing?.id ?? "pending",
      ingredientDefaultUnit: defaultUnit,
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
      failed.push({
        tabName: row.tabName,
        rowIndex: row.rowIndex,
        reason: built.reason,
        raw: row.raw,
        suggested: {
          ingredient_name: row.ingredient_name,
          unit: row.unit,
          quantity: row.quantity,
          total_cost: row.total_cost,
          cost_date: row.cost_date,
        },
      });
      continue;
    }
    ready.push({
      row,
      insert: built.insert,
      name: key,
      defaultUnit,
    });
  }

  const toCreate = [];
  const seenCreate = new Set<string>();
  for (const item of ready) {
    if (byName.has(item.name) || seenCreate.has(item.name)) continue;
    seenCreate.add(item.name);
    toCreate.push({
      companyId: input.companyId,
      name: item.row.ingredient_name,
      defaultUnit: item.defaultUnit,
      currentUnitCost: item.row.unit_price,
      currency: input.currency,
    });
  }
  const created = await input.repo.createIngredients(toCreate);
  for (const ingredient of created) {
    byName.set(nameKey(ingredient.name), ingredient);
    changes.created_ingredient_ids.push(ingredient.id);
  }

  const ingredientIds = [
    ...new Set(
      ready
        .map((item) => byName.get(item.name)?.id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const existingEntries = await input.repo.findWorkbookCostEntries({
    companyId: input.companyId,
    ingredientIds,
  });
  const existingByKey = new Map(
    existingEntries.map((entry) => [
      `${entry.ingredient_id}|${costMonthKey(entry.cost_date)}`,
      entry,
    ])
  );

  const inserts = [];
  const updates: Array<{
    id: string;
    patch: IngredientCostEntryInsert;
  }> = [];
  const ingredientCostUpdates = new Map<
    string,
    { currentUnitCost: number; currency: string }
  >();

  for (const item of ready) {
    const ingredient = byName.get(item.name);
    if (!ingredient) continue;
    const insert = {
      ...item.insert,
      ingredient_id: ingredient.id,
      source_id: input.batchId,
    };
    const monthKey = `${ingredient.id}|${costMonthKey(item.row.cost_date)}`;
    const existing = existingByKey.get(monthKey);
    if (existing) {
      updates.push({ id: existing.id, patch: insert });
      changes.updated_entries.push({
        id: existing.id,
        before: cloneCostEntry(existing),
      });
    } else {
      inserts.push(insert);
    }
    if (
      !changes.created_ingredient_ids.includes(ingredient.id) &&
      !ingredientCostUpdates.has(ingredient.id)
    ) {
      changes.ingredient_costs_before.push({
        id: ingredient.id,
        current_unit_cost: ingredient.current_unit_cost,
        currency: ingredient.currency,
      });
    }
    ingredientCostUpdates.set(ingredient.id, {
      currentUnitCost: insert.normalized_unit_cost,
      currency: input.currency,
    });
  }

  const insertedRows = await input.repo.insertCostEntries(inserts);
  changes.inserted_entry_ids = insertedRows.map((row) => row.id);
  await input.repo.updateCostEntries(
    input.companyId,
    updates.map((update) => ({ id: update.id, patch: update.patch }))
  );
  await input.repo.updateIngredientCosts(
    [...ingredientCostUpdates.entries()].map(([ingredientId, value]) => ({
      ingredientId,
      currentUnitCost: value.currentUnitCost,
      currency: value.currency,
    }))
  );

  return {
    ingredientsCreated: created.length,
    inserted: insertedRows.length,
    updated: updates.length,
    failed,
    changes,
  };
}
