// Match a typed or imported ingredient name against the company's
// existing catalog. Pure and deterministic. It never creates anything:
// the caller decides what to do with an "exact" or a "possible" match,
// and a person confirms anything that is not exact.

import {
  REVIEW_NAME_SCORE,
  bestNameMatch,
  normalizeMatchName,
} from "@/lib/restaurant/cost-workbook/names";
import { canAutoLinkNames } from "@/lib/restaurant/cost-workbook/duplicates";

export interface CatalogIngredientRef {
  id: string;
  name: string;
  default_unit: string | null;
}

export type IngredientNameMatch =
  | { kind: "exact"; ingredient: CatalogIngredientRef }
  | { kind: "possible"; ingredient: CatalogIngredientRef }
  | { kind: "ambiguous" }
  | { kind: "none" };

/**
 * `aliases` are names a person already confirmed (normalised alias ->
 * ingredient id). A remembered alias counts as an exact match.
 */
export function matchExistingIngredient(
  name: string,
  catalog: readonly CatalogIngredientRef[],
  aliases?: ReadonlyMap<string, string>
): IngredientNameMatch {
  const key = normalizeMatchName(name);
  if (!key) return { kind: "none" };

  const remembered = aliases?.get(key);
  if (remembered) {
    const target = catalog.find((item) => item.id === remembered);
    if (target) return { kind: "exact", ingredient: target };
  }

  const exact = catalog.filter((item) => normalizeMatchName(item.name) === key);
  if (exact.length === 1) return { kind: "exact", ingredient: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous" };

  const best = bestNameMatch(name, [...catalog], (item) => item.name);
  const near =
    best && best.score >= REVIEW_NAME_SCORE
      ? best.item
      : catalog.find((item) => canAutoLinkNames(name, item.name));
  if (near) return { kind: "possible", ingredient: near };
  return { kind: "none" };
}
