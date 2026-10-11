// One file column may fill only one mapping role. Saved / AI layouts
// that bind Articulo to both recipe_name and ingredient_name (or
// Cantidad to quantity and output_quantity) are dropped and remapped.

import type { ColumnMapping } from "./types";

const ROLE_PRIORITY = [
  "ingredient_name",
  "quantity",
  "unit",
  "recipe_name",
  "output_quantity",
  "output_unit",
  "unit_price",
  "total_cost",
  "price_per_lb",
  "price_per_oz",
  "price_per_unit",
  "supplier_name",
  "cost_date",
  "currency",
] as const;

export function mappingHasOverlappingRoles(mapping: ColumnMapping): boolean {
  const seen = new Map<string, string>();
  for (const [field, binding] of Object.entries(mapping)) {
    const column = binding?.column?.trim();
    if (!column) continue;
    const key = column.toLowerCase();
    const previous = seen.get(key);
    if (previous && previous !== field) return true;
    seen.set(key, field);
  }
  return false;
}

/** Drop later roles that reuse a column already claimed by a higher-priority role. */
export function sanitizeColumnMapping(mapping: ColumnMapping): ColumnMapping {
  const claimed = new Set<string>();
  const out: ColumnMapping = {};
  const remaining = new Set(Object.keys(mapping));

  const take = (field: string) => {
    remaining.delete(field);
    const binding = mapping[field];
    const column = binding?.column?.trim();
    if (!binding || !column) return;
    const key = column.toLowerCase();
    if (claimed.has(key)) return;
    claimed.add(key);
    out[field] = binding;
  };

  for (const field of ROLE_PRIORITY) take(field);
  for (const field of remaining) take(field);
  return out;
}
