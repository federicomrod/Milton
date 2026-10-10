// lib/restaurant/units.ts
// Deterministic unit conversion for recipe costing.
// Mass (kg/g/lb/oz), volume (l/ml), plus same-unit passthrough for
// discrete units. Returns an explicit error instead of silently guessing
// for unsupported pairs.
//
// API surface:
//   * convertUnit / convertUnitPrice — original strictly-typed UnitOfMeasure
//     variants used by the legacy mock-data calculator.
//   * normalizeUnit / convertUnitStr / convertUnitPriceStr — string-friendly
//     variants used by the costing engine that operates against database
//     rows (where `unit` is `text`). Unknown spellings collapse to a
//     canonical token when safe ("units"→"unit", "ltr"→"l", "piece"→"unit"),
//     and unsupported conversions return an explicit failure instead of
//     guessing — same contract as the typed variant.

import type { UnitOfMeasure } from "@/types/restaurant";

export type ConversionOk = { ok: true; value: number };
export type ConversionFail = { ok: false; reason: "unsupported_conversion" };
export type ConversionResult = ConversionOk | ConversionFail;

// Multiplier to go from `from` → `to`.
// Only families that are safely interconvertible are included.
// Exact SI definitions so lb ↔ oz ↔ kg ↔ g stay consistent.
const LB_IN_KG = 0.45359237;
const OZ_IN_G = 28.349523125;
const OZ_PER_LB = 16;

const CONVERSION_FACTOR: Partial<
  Record<UnitOfMeasure, Partial<Record<UnitOfMeasure, number>>>
> = {
  kg: { kg: 1, g: 1000, lb: 1 / LB_IN_KG, oz: 1000 / OZ_IN_G },
  g: { g: 1, kg: 0.001, lb: 0.001 / LB_IN_KG, oz: 1 / OZ_IN_G },
  l: { l: 1, ml: 1000 },
  ml: { ml: 1, l: 0.001 },
  // Discrete / portion units — only same-unit conversion is valid.
  unit: { unit: 1 },
  portion: { portion: 1 },
  oz: {
    oz: 1,
    lb: 1 / OZ_PER_LB,
    g: OZ_IN_G,
    kg: OZ_IN_G / 1000,
  },
  lb: {
    lb: 1,
    oz: OZ_PER_LB,
    kg: LB_IN_KG,
    g: LB_IN_KG * 1000,
  },
};

/**
 * Converts `value` from `from` units to `to` units.
 * Returns { ok: false } when the conversion is unsupported rather than guessing.
 */
export function convertUnit(
  value: number,
  from: UnitOfMeasure,
  to: UnitOfMeasure
): ConversionResult {
  if (from === to) return { ok: true, value };
  const factor = CONVERSION_FACTOR[from]?.[to];
  if (factor === undefined)
    return { ok: false, reason: "unsupported_conversion" };
  return { ok: true, value: value * factor };
}

/**
 * Converts a price expressed as `pricePerFrom` (e.g. $10 per kg) to the
 * equivalent price per `to` unit (e.g. $0.01 per g).
 * Used to normalise supplier invoice unit prices to recipe units before costing.
 */
export function convertUnitPrice(
  pricePerFrom: number,
  from: UnitOfMeasure,
  to: UnitOfMeasure
): ConversionResult {
  // price_per_to = price_per_from / factor(from→to)
  // Equivalently: multiply price by factor(to→from)
  if (from === to) return { ok: true, value: pricePerFrom };
  const forwardFactor = CONVERSION_FACTOR[from]?.[to];
  if (forwardFactor === undefined)
    return { ok: false, reason: "unsupported_conversion" };
  // price_per_to = price_per_from / (value_in_to_per_from) = price_per_from / forwardFactor
  return { ok: true, value: pricePerFrom / forwardFactor };
}

// ---------------------------------------------------------------------------
// String-friendly variants.
//
// `unit` columns in Supabase are `text`, so the costing engine receives
// arbitrary strings ("kg", "Kg", "kilograms", "pcs"). We collapse common
// synonyms to the canonical lowercase token and defer to the same
// CONVERSION_FACTOR table.
// ---------------------------------------------------------------------------

const UNIT_SYNONYMS: Record<string, UnitOfMeasure> = {
  // mass
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gr: "g",
  gramo: "g",
  gramos: "g",
  gram: "g",
  grams: "g",
  // volume
  l: "l",
  lt: "l",
  ltr: "l",
  litro: "l",
  litros: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  ml: "ml",
  mls: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  // discrete
  unit: "unit",
  units: "unit",
  unidad: "unit",
  unidades: "unit",
  piece: "unit",
  pieces: "unit",
  pieza: "unit",
  piezas: "unit",
  pza: "unit",
  pzas: "unit",
  pc: "unit",
  pcs: "unit",
  ea: "unit",
  each: "unit",
  portion: "portion",
  portions: "portion",
  serving: "portion",
  servings: "portion",
  oz: "oz",
  onza: "oz",
  onzas: "oz",
  onz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  libra: "lb",
  libras: "lb",
  pound: "lb",
  pounds: "lb",
};

/**
 * Returns the canonical UnitOfMeasure for an arbitrary user-typed unit
 * string, or `null` when we don't recognise it. Comparison is lowercase
 * + trimmed — never guesses families.
 */
export function normalizeUnit(
  raw: string | null | undefined
): UnitOfMeasure | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return UNIT_SYNONYMS[key] ?? null;
}

/**
 * String-friendly value conversion. Same contract as `convertUnit` but
 * accepts arbitrary unit strings and normalises them first. Returns
 * `unsupported_conversion` for any pair the canonical table can't bridge.
 */
export function convertUnitStr(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined
): ConversionResult {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  if (!f || !t) return { ok: false, reason: "unsupported_conversion" };
  return convertUnit(value, f, t);
}

/**
 * String-friendly price conversion. Same contract as `convertUnitPrice`.
 */
export function convertUnitPriceStr(
  pricePerFrom: number,
  from: string | null | undefined,
  to: string | null | undefined
): ConversionResult {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  if (!f || !t) return { ok: false, reason: "unsupported_conversion" };
  return convertUnitPrice(pricePerFrom, f, t);
}
