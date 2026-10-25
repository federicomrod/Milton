// The units a Revisar receta line can have. A dropdown, never free text.
// Whatever the cook or the AI said ("gramos", "grams", "piezas", "kilo") is
// mapped to one of these when the draft is made; if it cannot be mapped the
// dropdown stays empty and Confirmar waits for a choice.

import { isSubRecipePortionUnit, normalizeUnit } from "@/lib/restaurant/units";

export const KITCHEN_UNITS = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
  { value: "pza", label: "pza (pieza)" },
  { value: "unidad", label: "unidad" },
  { value: "oz", label: "oz" },
  { value: "lb", label: "lb" },
  { value: "orden", label: "orden" },
] as const;

export type KitchenUnit = (typeof KITCHEN_UNITS)[number]["value"];

const KITCHEN_UNIT_VALUES = new Set<string>(KITCHEN_UNITS.map((u) => u.value));

// Words for a piece, checked before the generic unit table (which reads them
// all as "unit").
const PIECE_WORDS = new Set([
  "pza",
  "pzas",
  "pz",
  "pzs",
  "pieza",
  "piezas",
  "piece",
  "pieces",
  "pc",
  "pcs",
]);
const UNIT_WORDS = new Set([
  "unidad",
  "unidades",
  "diente",
  "dientes",
  "manojo",
  "manojos",
  "unit",
  "units",
  "und",
  "uds",
  "ud",
  "un",
  "u",
  "each",
  "ea",
]);

function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[().,]/g, "")
    .trim();
}

export function isKitchenUnit(value: string | null | undefined): boolean {
  return Boolean(value) && KITCHEN_UNIT_VALUES.has(value as string);
}

/**
 * The dropdown value for whatever unit was written, or null when it cannot be
 * mapped (the person then chooses one).
 */
export function mapKitchenUnit(
  raw: string | null | undefined
): KitchenUnit | null {
  if (typeof raw !== "string") return null;
  const key = fold(raw);
  if (!key) return null;
  if (KITCHEN_UNIT_VALUES.has(key)) return key as KitchenUnit;
  if (isSubRecipePortionUnit(key)) return "orden";
  if (PIECE_WORDS.has(key)) return "pza";
  if (UNIT_WORDS.has(key)) return "unidad";
  switch (normalizeUnit(raw)) {
    case "g":
      return "g";
    case "kg":
      return "kg";
    case "ml":
      return "ml";
    case "l":
      return "l";
    case "oz":
      return "oz";
    case "lb":
      return "lb";
    case "unit":
      return "unidad";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Kitchen VOLUME words (taza, cucharada, cucharadita).
//
// FIXED, documented factors, used only for these volume words:
//   1 taza = 240 ml, 1 cucharada = 15 ml, 1 cucharadita = 5 ml.
// They are NEVER applied to a count or a weight word (libra, onza, gramo...).
//
// mapKitchenUnit deliberately does NOT map these words to "ml": that would
// change the unit without scaling the quantity («2 tazas» would silently
// become «2 ml»). The conversion is explicit (convertVolumeWord), changes the
// quantity too, and always produces a visible note («2 tazas = 480 ml») that
// the reviewer sees in Revisar receta. It is never silent.
// ---------------------------------------------------------------------------

type VolumeWord = { ml: number; label: "taza" | "cucharada" | "cucharadita" };

const TAZA: VolumeWord = { ml: 240, label: "taza" };
const CUCHARADA: VolumeWord = { ml: 15, label: "cucharada" };
const CUCHARADITA: VolumeWord = { ml: 5, label: "cucharadita" };

export const VOLUME_WORDS: ReadonlyMap<string, VolumeWord> = new Map([
  ...["taza", "tazas", "cup", "cups"].map((w) => [w, TAZA] as const),
  ...["cucharada", "cucharadas", "cda", "cdas", "tbsp"].map(
    (w) => [w, CUCHARADA] as const
  ),
  ...["cucharadita", "cucharaditas", "cdta", "cdtas", "tsp"].map(
    (w) => [w, CUCHARADITA] as const
  ),
]);

/** The ml factor and Spanish name for a volume word, or null for any other. */
export function volumeWord(
  raw: string | null | undefined
): { ml: number; label: string } | null {
  if (typeof raw !== "string") return null;
  const hit = VOLUME_WORDS.get(fold(raw));
  return hit ? { ml: hit.ml, label: hit.label } : null;
}

function formatNumber(n: number): string {
  return String(parseFloat(n.toFixed(3)));
}

/**
 * quantity × factor in ml plus the note the reviewer sees, e.g. «2 tazas = 480 ml».
 * Null when the word is not a volume word or the quantity is not a positive number.
 */
export function convertVolumeWord(
  quantity: number | null | undefined,
  rawUnit: string | null | undefined
): { quantity: number; unit: "ml"; note: string } | null {
  const word = volumeWord(rawUnit);
  if (!word) return null;
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return null;
  if (quantity <= 0) return null;
  const converted = parseFloat((quantity * word.ml).toFixed(3));
  const name = quantity === 1 ? word.label : `${word.label}s`;
  return {
    quantity: converted,
    unit: "ml",
    note: `${formatNumber(quantity)} ${name} = ${formatNumber(converted)} ml`,
  };
}
