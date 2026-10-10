import {
  emptyUndoSnapshot,
  type CostWorkbookCostEntry,
  type UndoSnapshot,
} from "./types";

export function costMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function costMonthStart(isoDate: string): string {
  const key = costMonthKey(isoDate);
  return key.length === 7 ? `${key}-01` : isoDate;
}

export function costMonthEndExclusive(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (!year || !month) return isoDate;
  if (month === 12) return `${year + 1}-01-01`;
  const next = month + 1;
  return `${year}-${next < 10 ? `0${next}` : String(next)}-01`;
}

export function cloneCostEntry(
  entry: CostWorkbookCostEntry
): CostWorkbookCostEntry {
  return { ...entry };
}

export function mergeUndoSnapshots(
  base: UndoSnapshot | null | undefined,
  extra: UndoSnapshot
): UndoSnapshot {
  const start = base ?? emptyUndoSnapshot();
  const seenCosts = new Set(start.ingredient_costs_before.map((r) => r.id));
  const ingredientCosts = [...start.ingredient_costs_before];
  for (const row of extra.ingredient_costs_before) {
    if (seenCosts.has(row.id)) continue;
    seenCosts.add(row.id);
    ingredientCosts.push(row);
  }
  return {
    inserted_entry_ids: [
      ...start.inserted_entry_ids,
      ...extra.inserted_entry_ids,
    ],
    updated_entries: [...start.updated_entries, ...extra.updated_entries],
    created_ingredient_ids: [
      ...start.created_ingredient_ids,
      ...extra.created_ingredient_ids,
    ],
    ingredient_costs_before: ingredientCosts,
  };
}

export function snapshotFromUnknown(value: unknown): UndoSnapshot {
  if (!value || typeof value !== "object") return emptyUndoSnapshot();
  const raw = value as Partial<UndoSnapshot>;
  return {
    inserted_entry_ids: Array.isArray(raw.inserted_entry_ids)
      ? raw.inserted_entry_ids.map(String)
      : [],
    updated_entries: Array.isArray(raw.updated_entries)
      ? raw.updated_entries.filter(
          (row): row is UndoSnapshot["updated_entries"][number] =>
            Boolean(
              row && typeof row === "object" && "id" in row && "before" in row
            )
        )
      : [],
    created_ingredient_ids: Array.isArray(raw.created_ingredient_ids)
      ? raw.created_ingredient_ids.map(String)
      : [],
    ingredient_costs_before: Array.isArray(raw.ingredient_costs_before)
      ? raw.ingredient_costs_before.filter(
          (row): row is UndoSnapshot["ingredient_costs_before"][number] =>
            Boolean(row && typeof row === "object" && "id" in row)
        )
      : [],
  };
}
