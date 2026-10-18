// lib/restaurant/recipe-costing/picker-cache.ts
//
// The ingredient + preparation picker list, once per Menú session
// (R1-09c). Every editor read and save asks the server to leave it out
// while this copy is fresh; a change to the catalog (a new ingredient or
// preparation, a price) clears it so the next answer brings it again.
// Browser memory only: a reload starts empty.

import type { PickerOption } from "./editor";
import { sameUnit } from "@/lib/restaurant/units";

/** Editor actions that change the catalog (names, prices, units). */
export const CATALOG_CHANGING_ACTIONS: ReadonlySet<string> = new Set([
  "create_ingredient",
  "create_preparation",
  "set_price",
  "set_line_cost",
  "answer_catalog_unit",
]);

const MAX_AGE_MS = 10 * 60_000;

let cached: { options: PickerOption[]; at: number } | null = null;

export function cachedPickerOptions(): PickerOption[] | null {
  if (!cached) return null;
  if (Date.now() - cached.at > MAX_AGE_MS) {
    cached = null;
    return null;
  }
  return cached.options;
}

export function rememberPickerOptions(options: PickerOption[]): void {
  cached = { options, at: Date.now() };
}

/** After any ingredient or price change, anywhere in Menú. */
export function invalidatePickerOptions(): void {
  cached = null;
}

/** The list for an editor: a preparation never offers itself. */
export function pickerOptionsFor(
  options: PickerOption[],
  componentId?: string
): PickerOption[] {
  return componentId
    ? options.filter((o) => !(o.kind === "component" && o.id === componentId))
    : options;
}

/**
 * A price typed in the ingredient's own unit changes ONE option of the list:
 * patch it in place instead of throwing the whole list away and asking the
 * server for it again. Returns false when it cannot be patched exactly (the
 * unit differs, the ingredient is not in the list): the caller then clears it.
 */
export function patchPickerOptionPrice(
  ingredientId: string,
  unit: string,
  unitCost: number
): boolean {
  if (!cached) return false;
  const index = cached.options.findIndex(
    (o) => o.kind === "ingredient" && o.id === ingredientId
  );
  if (index < 0) return false;
  const option = cached.options[index];
  if (option.unit !== null && !sameUnit(option.unit, unit)) return false;
  const next = cached.options.slice();
  next[index] = {
    ...option,
    unit: option.unit ?? unit,
    unit_cost: unitCost,
    price_date: new Date().toISOString().slice(0, 10),
    price_source: "manual",
  };
  cached = { options: next, at: cached.at };
  return true;
}
