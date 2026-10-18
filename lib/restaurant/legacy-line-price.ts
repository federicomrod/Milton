// lib/restaurant/legacy-line-price.ts
//
// What the one-time cleanup (migration 057, adopt_legacy_line_prices) does, as
// a pure function: the SQL is the one that runs on Staging; this mirrors its
// rules so they are tested. An ingredient that has NO cost entry and whose
// line copies all agree (within 0.5% after unit conversion) gets ONE entry;
// copies that disagree, or are in incompatible units, are listed for a person;
// an ingredient that already has an entry is left alone.

import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";

/**
 * The versions of ONE recipe the report reads: the approved version costing
 * uses today (`pickApprovedVersion`) AND the newest version (the draft the
 * editor shows). Mirrors `latest_v` / `latest_cv` in migration 057.
 */
export function legacyVersionsToRead<
  T extends {
    id: string;
    status: string;
    effective_date: string | null;
    version_number: number;
  },
>(versions: readonly T[], asOfDate?: string): T[] {
  const picked = pickApprovedVersion([...versions], asOfDate ?? null);
  const newest = [...versions].sort(
    (a, b) => b.version_number - a.version_number
  )[0];
  const out = new Map<string, T>();
  if (picked) out.set(picked.id, picked);
  if (newest) out.set(newest.id, newest);
  return [...out.values()];
}

export interface LegacyLineCopy {
  ingredient_id: string;
  unit: string;
  unit_cost: number;
}

/** Family and factor to the family's base (g / ml); anything else is its own family. */
export function legacyUnitBase(unit: string): {
  family: string;
  factor: number;
} {
  // The Spanish labels of the client workbook (migration 058) fold to the
  // English tokens first.
  const aliases: Record<string, string> = {
    onza: "oz",
    onzas: "oz",
    libra: "lb",
    libras: "lb",
    gr: "g",
    gramo: "g",
    gramos: "g",
    kilo: "kg",
    kilos: "kg",
    kilogramo: "kg",
    kilogramos: "kg",
    lt: "l",
    litro: "l",
    litros: "l",
    mililitro: "ml",
    mililitros: "ml",
    galon: "gal",
    galón: "gal",
    galones: "gal",
    unidad: "unit",
    unidades: "unit",
    ud: "unit",
    pieza: "unit",
    piezas: "unit",
    pza: "unit",
  };
  const raw = unit.trim().toLowerCase();
  const u = aliases[raw] ?? raw;
  const weight: Record<string, number> = {
    kg: 1000,
    g: 1,
    lb: 453.59237,
    oz: 28.349523125,
  };
  const volume: Record<string, number> = { l: 1000, ml: 1, gal: 3785.411784 };
  if (u in weight) return { family: "weight", factor: weight[u] };
  if (u in volume) return { family: "volume", factor: volume[u] };
  if (u === "unit") return { family: "count", factor: 1 };
  return { family: `other:${u}`, factor: 1 };
}

export interface LegacyAdoptionPlan {
  adopt: Array<{
    ingredient_id: string;
    unit: string;
    unit_cost: number;
    lines: number;
  }>;
  disagree: Array<{
    ingredient_id: string;
    lines: number;
    min_per_base: number;
    max_per_base: number;
  }>;
  mixed_units: Array<{ ingredient_id: string; lines: number }>;
  left_alone_with_entry: string[];
}

export const LEGACY_AGREE_TOLERANCE = 0.005;

export function planLegacyAdoption(input: {
  copies: readonly LegacyLineCopy[];
  /** Ingredients that already have at least one cost entry. */
  withEntry: ReadonlySet<string>;
  /** The ingredient's own unit, to write the entry in it when it is the same family. */
  defaultUnitOf?: (ingredientId: string) => string | null | undefined;
}): LegacyAdoptionPlan {
  const plan: LegacyAdoptionPlan = {
    adopt: [],
    disagree: [],
    mixed_units: [],
    left_alone_with_entry: [],
  };
  const byIngredient = new Map<string, LegacyLineCopy[]>();
  for (const c of input.copies) {
    if (!(c.unit_cost > 0) || !Number.isFinite(c.unit_cost)) continue;
    const list = byIngredient.get(c.ingredient_id) ?? [];
    list.push(c);
    byIngredient.set(c.ingredient_id, list);
  }
  for (const [id, copies] of byIngredient) {
    if (input.withEntry.has(id)) {
      plan.left_alone_with_entry.push(id);
      continue;
    }
    const based = copies.map((c) => {
      const b = legacyUnitBase(c.unit);
      return {
        ...c,
        family: b.family,
        factor: b.factor,
        per: c.unit_cost / b.factor,
      };
    });
    if (new Set(based.map((b) => b.family)).size > 1) {
      plan.mixed_units.push({ ingredient_id: id, lines: copies.length });
      continue;
    }
    const min = Math.min(...based.map((b) => b.per));
    const max = Math.max(...based.map((b) => b.per));
    if (max - min > LEGACY_AGREE_TOLERANCE * max) {
      plan.disagree.push({
        ingredient_id: id,
        lines: copies.length,
        min_per_base: min,
        max_per_base: max,
      });
      continue;
    }
    // Representative: the highest copy. In the ingredient's own unit when it is
    // the same family (oz copies on an ingredient bought in lb).
    const rep = [...based].sort((a, b) => b.per - a.per)[0];
    let unit = rep.unit;
    let cost = rep.unit_cost;
    const own = input.defaultUnitOf?.(id);
    if (own) {
      const ob = legacyUnitBase(own);
      if (ob.family === rep.family && !ob.family.startsWith("other:")) {
        unit = own;
        cost = (rep.unit_cost / rep.factor) * ob.factor;
      }
    }
    plan.adopt.push({
      ingredient_id: id,
      unit,
      unit_cost: cost,
      lines: copies.length,
    });
  }
  return plan;
}
