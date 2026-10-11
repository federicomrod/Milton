// lib/restaurant/units.ts
// Deterministic unit conversion for recipe costing.
// Mass (kg/g/lb/oz), volume (l/ml/gal), plus same-unit passthrough for
// discrete units. Returns an explicit error instead of silently guessing
// for unsupported pairs.
//
// Pack words (paquete, bolsa, caja, …) are "each" only when the cell has
// no parenthetical and no number. A size like "PAQUETE (14 UNIDADES)" or
// "BOLSA 5 LB" is never collapsed to a bare unit — unknown sizes go to
// needs-a-look; only an explicit, fully-parseable pack is converted.
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

export const PACK_SIZE_REVIEW_REASON = "tamaño de empaque, necesita conversión";

// Multiplier to go from `from` → `to`.
// Only families that are safely interconvertible are included.
// Exact SI definitions so lb ↔ oz ↔ kg ↔ g stay consistent.
const LB_IN_KG = 0.45359237;
const OZ_IN_G = 28.349523125;
const OZ_PER_LB = 16;
// US liquid gallon. El Salvador / the rest of dollarized LatAm kitchens
// write GALON for this, not the imperial gallon.
const GAL_IN_L = 3.785411784;

const CONVERSION_FACTOR: Partial<
  Record<UnitOfMeasure, Partial<Record<UnitOfMeasure, number>>>
> = {
  kg: { kg: 1, g: 1000, lb: 1 / LB_IN_KG, oz: 1000 / OZ_IN_G },
  g: { g: 1, kg: 0.001, lb: 0.001 / LB_IN_KG, oz: 1 / OZ_IN_G },
  l: { l: 1, ml: 1000, gal: 1 / GAL_IN_L },
  ml: { ml: 1, l: 0.001, gal: 0.001 / GAL_IN_L },
  gal: { gal: 1, l: GAL_IN_L, ml: GAL_IN_L * 1000 },
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
  grs: "g",
  gm: "g",
  grm: "g",
  grms: "g",
  grmo: "g",
  grako: "g",
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
  gal: "gal",
  gals: "gal",
  galon: "gal",
  galones: "gal",
  gallon: "gal",
  gallons: "gal",
  // discrete — bare kitchen pack words stay "each"; a size next to them
  // is never inferred here (see resolveUnitCell / parseExplicitPackSize).
  unit: "unit",
  units: "unit",
  unidad: "unit",
  unidades: "unit",
  unida: "unit",
  unid: "unit",
  und: "unit",
  unds: "unit",
  uds: "unit",
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
  paquete: "unit",
  paquetes: "unit",
  paq: "unit",
  pqt: "unit",
  pqte: "unit",
  sobre: "unit",
  sobres: "unit",
  bolsa: "unit",
  bolsas: "unit",
  caja: "unit",
  cajas: "unit",
  lata: "unit",
  latas: "unit",
  botella: "unit",
  botellas: "unit",
  bandeja: "unit",
  bandejas: "unit",
  rollo: "unit",
  rollos: "unit",
  barra: "unit",
  barras: "unit",
  saco: "unit",
  sacos: "unit",
  cubeta: "unit",
  cubetas: "unit",
  balde: "unit",
  baldes: "unit",
  portion: "portion",
  portions: "portion",
  porcion: "portion",
  porciones: "portion",
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

const PACK_WORDS = new Set([
  "paquete",
  "paquetes",
  "paq",
  "pqt",
  "pqte",
  "sobre",
  "sobres",
  "bolsa",
  "bolsas",
  "caja",
  "cajas",
  "lata",
  "latas",
  "botella",
  "botellas",
  "bandeja",
  "bandejas",
  "rollo",
  "rollos",
  "barra",
  "barras",
  "saco",
  "sacos",
  "cubeta",
  "cubetas",
  "balde",
  "baldes",
]);

const MEASURE_UNITS = new Set<UnitOfMeasure>([
  "kg",
  "g",
  "l",
  "ml",
  "gal",
  "oz",
  "lb",
]);

function foldUnitKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.,;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstWord(text: string): string {
  return text.split(" ")[0] ?? "";
}

function stripParentheticals(folded: string): string {
  return folded
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellHasSizeHint(raw: string, folded: string): boolean {
  return /\d/.test(folded) || /\([^)]*\)/.test(raw);
}

function isPackWord(key: string): boolean {
  return PACK_WORDS.has(key);
}

function isMeasureKey(key: string): boolean {
  const hit = UNIT_SYNONYMS[key];
  return hit != null && MEASURE_UNITS.has(hit);
}

function isBareCountKey(key: string): boolean {
  const hit = UNIT_SYNONYMS[key];
  return (hit === "unit" || hit === "portion") && !isPackWord(key);
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  const n = left.length;
  const m = right.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const prev = new Array<number>(m + 1);
  const curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= m; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[m] ?? Math.max(n, m);
}

/**
 * One-edit typos of long measure words only (GRAMO→GRMO/GRAKO).
 * Ambiguous hits (LITRA → litro or libra) stay unknown.
 */
function fuzzyMeasureUnit(folded: string): UnitOfMeasure | null {
  if (folded.length < 4) return null;
  const hits = new Set<UnitOfMeasure>();
  for (const [key, unit] of Object.entries(UNIT_SYNONYMS)) {
    if (!MEASURE_UNITS.has(unit) || key.length < 4) continue;
    if (Math.abs(key.length - folded.length) > 1) continue;
    if (editDistance(folded, key) === 1) hits.add(unit);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

function escapeRegexToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(tokens: string[]): string {
  return tokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegexToken)
    .join("|");
}

/**
 * Kitchen workbooks write "PAQUETE (TORTILLA DE TACO 14 UNIDADES)" or
 * "GALÓN". Try the whole cell, then a parenthetical strip only when the
 * leftover is not a pack-with-size, then the first word only for true
 * unit words (kg, lb, g, l, oz, ml, gal, …). Never guess a family from
 * a leftover pack adjective.
 */
export function unitLookupKeys(raw: string): string[] {
  const folded = foldUnitKey(raw);
  if (!folded) return [];
  const keys = [folded];
  const sized = cellHasSizeHint(raw, folded);
  const noParens = stripParentheticals(folded);
  if (noParens && noParens !== folded) {
    const head = firstWord(noParens);
    if (!isPackWord(head) || !sized) keys.push(noParens);
  }
  const first = firstWord(noParens || folded);
  if (first && isMeasureKey(first)) {
    keys.push(first);
  } else if (first && isBareCountKey(first) && !sized) {
    keys.push(first);
  } else if (first && isPackWord(first) && !sized) {
    keys.push(first);
  }
  return [...new Set(keys.filter(Boolean))];
}

/**
 * Returns the canonical UnitOfMeasure for an arbitrary user-typed unit
 * string, or `null` when we don't recognise it. Comparison is lowercase
 * + trimmed — never guesses families. Pack cells with a size are null
 * so callers cannot treat a 14-count bag as one "each".
 */
export function normalizeUnit(
  raw: string | null | undefined
): UnitOfMeasure | null {
  if (typeof raw !== "string") return null;
  for (const key of unitLookupKeys(raw)) {
    const hit = UNIT_SYNONYMS[key];
    if (hit) return hit;
  }
  const folded = foldUnitKey(raw);
  if (!folded || cellHasSizeHint(raw, folded)) return null;
  return fuzzyMeasureUnit(folded);
}

export function parseExplicitPackSize(
  raw: string
): { unit: UnitOfMeasure; multiplier: number } | null {
  const folded = foldUnitKey(raw);
  if (!folded || !isPackWord(firstWord(stripParentheticals(folded)))) {
    return null;
  }

  const packTokens = alternation([...PACK_WORDS]);
  const measureTokens = alternation(
    Object.entries(UNIT_SYNONYMS)
      .filter(([key, unit]) => MEASURE_UNITS.has(unit) && !isPackWord(key))
      .map(([key]) => key)
  );
  const countTokens = alternation(
    Object.entries(UNIT_SYNONYMS)
      .filter(([key, unit]) => unit === "unit" && !isPackWord(key))
      .map(([key]) => key)
  );

  const massVol = folded.match(
    new RegExp(`^(${packTokens}) (\\d+(?:\\.\\d+)?) (${measureTokens})$`)
  );
  if (massVol) {
    const unit = UNIT_SYNONYMS[massVol[3] ?? ""];
    const multiplier = Number(massVol[2]);
    if (unit && Number.isFinite(multiplier) && multiplier > 0) {
      return { unit, multiplier };
    }
  }

  const counted = folded.match(
    new RegExp(`^(${packTokens}) \\((\\d+(?:\\.\\d+)?) (${countTokens})\\)$`)
  );
  if (counted) {
    const multiplier = Number(counted[2]);
    if (Number.isFinite(multiplier) && multiplier > 0) {
      return { unit: "unit", multiplier };
    }
  }

  return null;
}

export function isAmbiguousPackUnit(raw: string): boolean {
  const folded = foldUnitKey(raw);
  if (!folded) return false;
  if (!cellHasSizeHint(raw, folded)) return false;
  if (parseExplicitPackSize(raw)) return false;
  return isPackWord(firstWord(stripParentheticals(folded)));
}

export type ResolvedUnitCell =
  | {
      ok: true;
      unit: string;
      canonical: UnitOfMeasure;
      quantityMultiplier: number;
    }
  | { ok: false; reason: string };

/**
 * Workbook / draft ingest. Bare packs stay "each". Explicit parseable
 * sizes (BOLSA 5 LB, PAQUETE (14 UNIDADES)) expand. Anything else with
 * a pack size goes to needs-a-look in tú-neutral LatAm Spanish.
 */
export function resolveUnitCell(
  raw: string | null | undefined
): ResolvedUnitCell {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "Missing unit" };
  }
  const explicit = parseExplicitPackSize(raw);
  if (explicit) {
    return {
      ok: true,
      unit: explicit.unit,
      canonical: explicit.unit,
      quantityMultiplier: explicit.multiplier,
    };
  }
  const canonical = normalizeUnit(raw);
  if (canonical) {
    return {
      ok: true,
      unit: raw.trim(),
      canonical,
      quantityMultiplier: 1,
    };
  }
  if (isAmbiguousPackUnit(raw)) {
    return { ok: false, reason: PACK_SIZE_REVIEW_REASON };
  }
  return { ok: false, reason: `unknown unit (${raw})` };
}

function conversionSides(
  raw: string | null | undefined
): { unit: UnitOfMeasure; multiplier: number } | null {
  if (typeof raw !== "string") return null;
  const explicit = parseExplicitPackSize(raw);
  if (explicit) return explicit;
  const unit = normalizeUnit(raw);
  return unit ? { unit, multiplier: 1 } : null;
}

/**
 * String-friendly value conversion. Same contract as `convertUnit` but
 * accepts arbitrary unit strings and normalises them first. Returns
 * `unsupported_conversion` for any pair the canonical table can't bridge.
 * Explicit pack sizes multiply through (1 × BOLSA 5 LB = 5 lb).
 */
export function convertUnitStr(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined
): ConversionResult {
  const f = conversionSides(from);
  const t = conversionSides(to);
  if (!f || !t) return { ok: false, reason: "unsupported_conversion" };
  const converted = convertUnit(value * f.multiplier, f.unit, t.unit);
  if (!converted.ok) return converted;
  return { ok: true, value: converted.value / t.multiplier };
}

/**
 * String-friendly price conversion. Same contract as `convertUnitPrice`.
 */
export function convertUnitPriceStr(
  pricePerFrom: number,
  from: string | null | undefined,
  to: string | null | undefined
): ConversionResult {
  const f = conversionSides(from);
  const t = conversionSides(to);
  if (!f || !t) return { ok: false, reason: "unsupported_conversion" };
  const pricePerFromCanonical = pricePerFrom / f.multiplier;
  const converted = convertUnitPrice(pricePerFromCanonical, f.unit, t.unit);
  if (!converted.ok) return converted;
  return { ok: true, value: converted.value * t.multiplier };
}
