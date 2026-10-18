// lib/restaurant/ingredient-duplicate-report.ts
//
// READ-ONLY report of probable duplicate ingredients by spelling (QUESO
// MOZARELLA / MOZZARELLA / MOZARELA), from the same duplicate-group logic the
// «Posibles duplicados» banner uses. It changes nothing: a person merges the
// groups with «Unir…» (or the banner). Pure.

import {
  chooseSurvivor,
  findDuplicateSets,
  type DupItem,
  type MergeCandidate,
} from "@/lib/restaurant/ingredient-duplicates";

export interface DuplicateReportIngredient extends DupItem {
  price: number | null;
  priceUnit: string | null;
  recipeCount: number;
}

export interface DuplicateReportGroup {
  key: string;
  score: number;
  /** Same unit family, in the same order «Unir…» would pre-pick them. */
  members: Array<{
    id: string;
    name: string;
    unit: string | null;
    price: number | null;
    priceUnit: string | null;
    recipeCount: number;
    /** The one «Unir…» would keep by default. */
    suggested_survivor: boolean;
  }>;
}

export function duplicateReport(
  ingredients: readonly DuplicateReportIngredient[],
  notDuplicates: ReadonlySet<string> = new Set()
): DuplicateReportGroup[] {
  const active = ingredients.filter((i) => !i.archived);
  const byId = new Map(active.map((i) => [i.id, i]));
  return findDuplicateSets(active, notDuplicates).map((set) => {
    const members = set.ids
      .map((id) => byId.get(id))
      .filter((i): i is DuplicateReportIngredient => !!i);
    const candidates: MergeCandidate[] = members.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      priceUnit: m.priceUnit,
      priceDate: null,
      priceSourced: m.price !== null,
      priceEntryId: null,
      recipeCount: m.recipeCount,
      lineCount: m.recipeCount,
    }));
    const keep = candidates.length > 0 ? chooseSurvivor(candidates) : "";
    return {
      key: set.key,
      score: set.score,
      members: members
        .map((m) => ({
          id: m.id,
          name: m.name,
          unit: m.unit,
          price: m.price,
          priceUnit: m.priceUnit,
          recipeCount: m.recipeCount,
          suggested_survivor: m.id === keep,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    };
  });
}
