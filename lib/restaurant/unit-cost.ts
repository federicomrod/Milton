// Shared helper for the legacy ingredients.current_unit_cost cache.
// After migration 037 the column is nullable: null means "pending price",
// never a real $0. Readers must not coerce that to 0.

export function positiveUnitCost(
  value: number | null | undefined
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}
