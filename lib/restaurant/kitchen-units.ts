// The units a Revisar receta line can have. A dropdown, never free text.
// Whatever the cook or the AI said ("gramos", "grams", "piezas", "kilo") is
// mapped to one of these when the draft is made; if it cannot be mapped the
// dropdown stays empty and Confirmar waits for a choice.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
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

/** The dropdown label of a unit in the person's language (Spanish by default). */
export function kitchenUnitLabel(
  unit: { value: string; label: string },
  lang: PreferredLanguage
): string {
  switch (unit.value) {
    case "pza":
      return t(lang, "pc (piece)", "pza (pieza)", "Stk. (Stück)");
    case "unidad":
      return t(lang, "unit", "unidad", "Einheit");
    case "orden":
      return t(lang, "serving", "orden", "Portion");
    default:
      return unit.label;
  }
}

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
