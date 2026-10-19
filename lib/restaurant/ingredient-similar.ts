// «Ya existe»: is a name already an ingredient of the company, as a case or
// accent variant ("Bacon" / "bacon" / "BACÓN") or as a remembered alias?
// One rule for every place that creates an ingredient (the recipe editor and
// the Revisar receta screen), so a duplicate is blocked the same way.

import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";

export interface SimilarIngredient {
  id: string;
  name: string;
  reason: "name" | "alias";
}

/**
 * @param aliasKeyToId remembered aliases: normalised alias key → ingredient id
 *        (see `aliasKeyFor`); optional.
 */
export function findSimilarIngredient(
  name: string,
  ingredients: ReadonlyArray<{ id: string; name: string }>,
  aliasKeyToId?: ReadonlyMap<string, string>,
  aliasKeyOf?: (name: string) => string
): SimilarIngredient | null {
  const key = normalizeMatchName(name);
  if (!key) return null;
  const sorted = [...ingredients].sort(
    (a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id)
  );
  const byName = sorted.find((row) => normalizeMatchName(row.name) === key);
  if (byName) return { id: byName.id, name: byName.name, reason: "name" };
  if (aliasKeyToId && aliasKeyOf) {
    const id = aliasKeyToId.get(aliasKeyOf(name));
    const hit = id ? sorted.find((row) => row.id === id) : undefined;
    if (hit) return { id: hit.id, name: hit.name, reason: "alias" };
  }
  return null;
}
