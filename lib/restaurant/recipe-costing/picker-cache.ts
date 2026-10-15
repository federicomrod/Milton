// lib/restaurant/recipe-costing/picker-cache.ts
//
// The ingredient + preparation picker list, once per Menú session
// (R1-09c). Every editor read and save asks the server to leave it out
// while this copy is fresh; a change to the catalog (a new ingredient or
// preparation, a price) clears it so the next answer brings it again.
// Browser memory only: a reload starts empty.

import type { PickerOption } from "./editor";

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
