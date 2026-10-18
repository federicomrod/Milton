// Shared helper for a price that may be missing: null / 0 / non-finite means
// "pending price", never a real $0. Readers must not coerce that to 0.
// (The price itself comes from the latest ingredient_cost_entries row; the
// legacy ingredients.current_unit_cost cache is not a source any more.)

export function positiveUnitCost(
  value: number | null | undefined
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}
