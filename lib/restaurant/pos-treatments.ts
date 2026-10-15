// lib/restaurant/pos-treatments.ts
//
// How each POS product is costed (premise 8) and what counts toward
// coverage (premise 10). Pure.
//
// - Plato preparado, reventa, modificador con costo: need a confirmed link
//   and an approved recipe (reventa is a one-line recipe: what you buy).
// - Modificador sin costo: a person said it carries no cost; it counts as
//   costed at zero.
// - Combo: costed by its parts; covered when every part's cost is known (or
//   when the combo itself has a confirmed, approved recipe). A part marked
//   excluido keeps the combo uncovered.
// - Excluido: not food (tips, service charges, merchandise…). It leaves the
//   coverage denominator, which is "food net sales".
// - Por clasificar: treated like a dish until a person decides.
//
// Code may SUGGEST a treatment from the POS name; only a person saves one.

import {
  CLASSIFICATION_LABELS,
  type PosProductClassification,
} from "@/lib/restaurant/pos-product-links";

export interface TreatmentRule {
  label: string;
  hint: string;
  /** Counts in food net sales (the coverage denominator). */
  in_food_sales: boolean;
  /** Needs a confirmed link + approved recipe to be covered. */
  needs_recipe: boolean;
}

export const TREATMENT_RULES: Record<PosProductClassification, TreatmentRule> =
  {
    por_clasificar: {
      label: CLASSIFICATION_LABELS.por_clasificar,
      hint: "Elige cómo se costea",
      in_food_sales: true,
      needs_recipe: true,
    },
    plato_preparado: {
      label: CLASSIFICATION_LABELS.plato_preparado,
      hint: "Lleva receta",
      in_food_sales: true,
      needs_recipe: true,
    },
    reventa: {
      label: CLASSIFICATION_LABELS.reventa,
      hint: "Se compra y se vende igual: su costo es lo que pagas",
      in_food_sales: true,
      needs_recipe: true,
    },
    modificador_con_costo: {
      label: CLASSIFICATION_LABELS.modificador_con_costo,
      hint: "Se cobra aparte y lleva ingredientes (ej. extra queso)",
      in_food_sales: true,
      needs_recipe: true,
    },
    modificador_sin_costo: {
      label: CLASSIFICATION_LABELS.modificador_sin_costo,
      hint: "No agrega costo (ej. sin cebolla)",
      in_food_sales: true,
      needs_recipe: false,
    },
    combo: {
      label: CLASSIFICATION_LABELS.combo,
      hint: "Se costea por sus partes",
      in_food_sales: true,
      needs_recipe: false,
    },
    excluido: {
      label: CLASSIFICATION_LABELS.excluido,
      hint: "Propinas, cargos, mercadería: no cuenta en la cobertura",
      in_food_sales: false,
      needs_recipe: false,
    },
  };

/** Treatments a person can pick (por_clasificar is the absence of one). */
export const PICKABLE_TREATMENTS: readonly PosProductClassification[] = [
  "plato_preparado",
  "reventa",
  "modificador_con_costo",
  "modificador_sin_costo",
  "combo",
  "excluido",
];

/** Odoo marks combos itself: an unclassified combo is a combo. */
export function effectiveTreatment(input: {
  classification: PosProductClassification;
  is_combo: boolean;
}): PosProductClassification {
  if (input.classification === "por_clasificar" && input.is_combo) {
    return "combo";
  }
  return input.classification;
}

export interface CoverageState {
  treatment: PosProductClassification;
  confirmed: boolean;
  approved: boolean;
}

/** A combo part (or any product) whose cost is known: a person said it
 *  costs nothing (modificador sin costo), or it has a confirmed link and an
 *  approved recipe. An excluded part is NOT a known cost: counting it would
 *  cost it at $0 without anyone saying so. */
export function isCostKnown(state: CoverageState): boolean {
  if (state.treatment === "modificador_sin_costo") return true;
  return state.confirmed && state.approved;
}

/** Covered = counts in the numerator of food coverage. */
export function isCovered(
  state: CoverageState & { parts?: readonly CoverageState[] }
): boolean {
  if (state.treatment === "excluido") return false;
  if (state.treatment === "modificador_sin_costo") return true;
  if (state.confirmed && state.approved) return true;
  if (state.treatment === "combo") {
    const parts = state.parts ?? [];
    return parts.length > 0 && parts.every(isCostKnown);
  }
  return false;
}

const CARGO =
  /\b(propina|tip|cargo|servicio|delivery|env[ií]o|domicilio|descuento|cortes[ií]a|gift ?card|tarjeta de regalo|merch|camiseta|gorra)\b/i;
const RESALE =
  /\b(coca[- ]?cola|pepsi|sprite|fanta|7 ?up|cerveza|beer|red ?bull|gatorade|agua (pura|embotellada|mineral)|soda|gaseosa|lata|botella|whisky|ron|vodka|tequila|copa de vino|shot)\b/i;
const MOD_WITH_COST = /^\s*(extra|adicional|agregar|add|porci[oó]n extra)\b/i;
const MOD_NO_COST = /^\s*(sin|no|t[eé]rmino|nota)\b/i;

export interface TreatmentSuggestion {
  treatment: PosProductClassification;
  reason: string;
}

/**
 * A suggestion from the POS name and structure. Never saved by itself:
 * a person accepts it (premise 7: ambiguity is a human decision).
 */
export function suggestTreatment(input: {
  name: string;
  is_combo: boolean;
}): TreatmentSuggestion {
  if (input.is_combo) {
    return { treatment: "combo", reason: "Odoo lo vende como combo" };
  }
  if (CARGO.test(input.name)) {
    return {
      treatment: "excluido",
      reason: "Parece un cargo o algo que no es comida",
    };
  }
  if (MOD_NO_COST.test(input.name)) {
    return {
      treatment: "modificador_sin_costo",
      reason: "Parece una indicación que no agrega costo",
    };
  }
  if (MOD_WITH_COST.test(input.name)) {
    return {
      treatment: "modificador_con_costo",
      reason: "Parece un extra que se cobra aparte",
    };
  }
  if (RESALE.test(input.name)) {
    return {
      treatment: "reventa",
      reason: "Parece algo que compras y vendes igual",
    };
  }
  return { treatment: "plato_preparado", reason: "Se vende como plato" };
}
