// Find ingredients whose cost differs between the price list (the
// catalog) and what the recipe sheets say for the same ingredient.
//
// Pure and deterministic. A conflict is only ever an open question for a
// person: the catalog price stays in force until someone chooses.
// Matching is by exact normalised name — a look-alike name is a "possible
// match" question handled elsewhere, never a conflict.

import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";
import type { CatalogUnit, PriceCatalogRow } from "./reader";

/** Tolerance for "the same price": the larger of 2% or half a cent per
 *  unit would be too lax for per-ounce prices, so it is purely relative. */
export const COST_CONFLICT_TOLERANCE = 0.02;
/** A recipe price closer than this to the list price is not a question. */
export const COST_ASK_SHARE = 0.2;
/**
 * A recipe price this many times higher or lower than the list's is in
 * another unit (oz vs lb is ×16, g vs oz ×28, g vs lb ×453) or a typo,
 * not a second price: it is not offered.
 */
export const OTHER_UNIT_FACTOR = 8;

function worthAsking(recipe: number, list: number): boolean {
  if (!(recipe > 0) || !(list > 0)) return false;
  const ratio = recipe / list;
  if (Math.abs(ratio - 1) <= COST_ASK_SHARE) return false;
  return ratio < OTHER_UNIT_FACTOR && ratio > 1 / OTHER_UNIT_FACTOR;
}

export interface RecipeCostObservation {
  name: string;
  /** Unit label written on the recipe line (may be wrong). */
  unitLabel: string;
  /** Unit cost written on the recipe line. */
  unitCost: number;
  tab: string;
  row: number;
  recipe: string;
}

export interface CostConflictCandidate {
  unit: CatalogUnit;
  unitCost: number;
  lines: number;
  recipes: number;
  sample: { tab: string; row: number };
}

export interface CostConflict {
  /** Normalised ingredient name. */
  key: string;
  name: string;
  catalog: { unit: CatalogUnit; unitCost: number; rowKey: string };
  candidates: CostConflictCandidate[];
}

function plain(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function close(a: number, b: number): boolean {
  if (a === b) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? true : Math.abs(a - b) / base <= COST_CONFLICT_TOLERANCE;
}

/** The recipe line's cost expressed in the catalog's unit, or null when
 *  the two units cannot be compared (for example pieces vs ounces). */
function inCatalogUnit(
  obs: RecipeCostObservation,
  unit: CatalogUnit
): number | null {
  const label = normalizeUnit(obs.unitLabel);
  if (!label) return null;
  const converted = convertUnitPriceStr(obs.unitCost, label, unit);
  return converted.ok ? converted.value : null;
}

export function findCostConflicts(
  catalog: readonly PriceCatalogRow[],
  observations: readonly RecipeCostObservation[]
): CostConflict[] {
  const byName = new Map<string, PriceCatalogRow>();
  for (const row of catalog) {
    if (row.kind !== "ingredient") continue;
    if (row.unit === null || row.unitCost === null) continue;
    if (row.status !== "ok" && row.status !== "check_unit") continue;
    byName.set(plain(row.name), row);
  }

  const conflicts = new Map<string, CostConflict>();
  const recipesSeen = new Map<string, Set<string>>();
  // Ingredients whose list price is used by at least one recipe line: the
  // file confirms its own list price, so nothing is asked. Recipe lines
  // that differ keep their own cost on their dish.
  const confirmed = new Set<string>();

  for (const obs of observations) {
    const key = plain(obs.name);
    const row = byName.get(key);
    if (!row || row.unit === null || row.unitCost === null) continue;
    if (!(obs.unitCost > 0)) continue;

    const asLabeled = inCatalogUnit(obs, row.unit);
    if (asLabeled === null) continue; // not comparable
    // The unit label on recipe lines is sometimes wrong (a per-ounce
    // price under LIBRA). If the raw number already matches the catalog
    // in the catalog's own unit, the prices agree and only the label lies.
    if (close(asLabeled, row.unitCost) || close(obs.unitCost, row.unitCost)) {
      confirmed.add(key);
      continue;
    }
    // Within 20%, or obviously another unit: not a real second price.
    if (!worthAsking(asLabeled, row.unitCost)) continue;

    let conflict = conflicts.get(key);
    if (!conflict) {
      conflict = {
        key,
        name: row.name,
        catalog: { unit: row.unit, unitCost: row.unitCost, rowKey: row.key },
        candidates: [],
      };
      conflicts.set(key, conflict);
    }
    const rounded = Number(asLabeled.toPrecision(4));
    let candidate = conflict.candidates.find((c) => close(c.unitCost, rounded));
    if (!candidate) {
      candidate = {
        unit: row.unit,
        unitCost: rounded,
        lines: 0,
        recipes: 0,
        sample: { tab: obs.tab, row: obs.row },
      };
      conflict.candidates.push(candidate);
    }
    candidate.lines += 1;
    const seenKey = `${key}|${candidate.unitCost}`;
    const seen = recipesSeen.get(seenKey) ?? new Set<string>();
    if (!seen.has(obs.recipe)) {
      seen.add(obs.recipe);
      candidate.recipes += 1;
    }
    recipesSeen.set(seenKey, seen);
  }

  return [...conflicts.values()]
    .filter((conflict) => !confirmed.has(conflict.key))
    .sort((a, b) => a.name.localeCompare(b.name));
}
