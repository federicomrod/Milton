// Prefill a draft recipe from an Excel block, against the catalog only.
//
// Plain code, no AI. For each Excel line:
// - the name resolves to an existing ingredient (exact name or a name a
//   person already confirmed) or an existing preparation (exact name);
//   anything else stays unresolved for the person to pick;
// - the unit is read from the line; if the line's own price shows the unit
//   label is probably wrong (a per-ounce price under LIBRA), the line keeps
//   its written unit and carries one question for the person;
// - the price is NEVER taken from the Excel line. Costs come from the
//   catalog when the recipe is costed. The Excel number is kept only as
//   evidence (and to spot a wrong unit label).

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { resolveRecipeLineUnit } from "@/lib/restaurant/cost-workbook/portion-unit";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";

export const FLAG_PENDING_UNIT_QUESTION = "pendiente_unidad";
export const FLAG_PENDING_INGREDIENT = "pendiente_ingrediente";
export const UNIT_TOLERANCE = 0.02;

export interface PrefillCatalogIngredient {
  id: string;
  name: string;
  default_unit: string | null;
  /** Latest price in default_unit, when known. */
  unit_cost: number | null;
}

export interface PrefillCatalogPreparation {
  id: string;
  name: string;
}

export interface PrefillLineIn {
  source_row: number | null;
  raw_name: string;
  qty: number;
  unit: string;
  /** Unit cost written on the Excel line (evidence only). */
  excel_unit_cost: number | null;
}

export interface UnitQuestion {
  /** What the Excel line says. */
  written: string;
  /** What its own price suggests. */
  suggested: string;
}

export interface PrefilledLine {
  source_row: number | null;
  raw_name: string;
  qty: number;
  /** Canonical unit as written (after normalising the spelling). */
  unit: string;
  /** False when the written unit could not be understood at all. */
  unit_ok: boolean;
  excel_unit_cost: number | null;
  resolved:
    | { kind: "ingredient"; id: string; name: string; via: "exact" | "alias" }
    | { kind: "component"; id: string; name: string; via: "exact" }
    | null;
  unit_question: UnitQuestion | null;
  pending: boolean;
  flags: string[];
  reasons: string[];
}

function close(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 || Math.abs(a - b) / base <= UNIT_TOLERANCE;
}

const MASS = ["oz", "lb", "g", "kg"];

/**
 * When the Excel line's own price only makes sense in another unit than
 * the one written, return that unit. Mass units only; null when the
 * written unit is consistent, or when no unit explains the number (that is
 * a price difference, handled by the catalog's conflict decisions).
 */
export function suggestedUnitFromPrice(input: {
  writtenUnit: string;
  excelUnitCost: number | null;
  catalogUnit: string | null;
  catalogUnitCost: number | null;
}): string | null {
  const written = normalizeUnit(input.writtenUnit);
  const { excelUnitCost, catalogUnit, catalogUnitCost } = input;
  if (!written || !MASS.includes(written)) return null;
  if (!excelUnitCost || !catalogUnit || !catalogUnitCost) return null;
  const inWritten = convertUnitPriceStr(catalogUnitCost, catalogUnit, written);
  if (inWritten.ok && close(inWritten.value, excelUnitCost)) return null;
  for (const unit of MASS) {
    if (unit === written) continue;
    const converted = convertUnitPriceStr(catalogUnitCost, catalogUnit, unit);
    if (converted.ok && close(converted.value, excelUnitCost)) return unit;
  }
  return null;
}

export function prefillLines(input: {
  lines: readonly PrefillLineIn[];
  ingredients: readonly PrefillCatalogIngredient[];
  preparations: readonly PrefillCatalogPreparation[];
  /** normalizeMatchName(alias) -> ingredient id, confirmed by a person. */
  aliases?: ReadonlyMap<string, string>;
  /** Language of the review reasons (default Spanish). */
  lang?: PreferredLanguage;
}): PrefilledLine[] {
  const msg = getDictionary(input.lang ?? "es").menu.editor.prefill;
  const ingredientsByKey = new Map<string, PrefillCatalogIngredient[]>();
  for (const row of input.ingredients) {
    const key = normalizeMatchName(row.name);
    ingredientsByKey.set(key, [...(ingredientsByKey.get(key) ?? []), row]);
  }
  const prepsByKey = new Map<string, PrefillCatalogPreparation[]>();
  for (const row of input.preparations) {
    const key = normalizeMatchName(row.name);
    prepsByKey.set(key, [...(prepsByKey.get(key) ?? []), row]);
  }
  const ingredientById = new Map(input.ingredients.map((r) => [r.id, r]));
  const prepNames = input.preparations.map((p) => p.name);

  return input.lines.map((line): PrefilledLine => {
    const key = normalizeMatchName(line.raw_name);
    const reasons: string[] = [];
    const flags: string[] = [];

    // 1. Unit as written.
    const unitCell = resolveRecipeLineUnit({
      unitRaw: line.unit,
      ingredientName: line.raw_name,
      knownSubRecipeNames: prepNames,
      lang: "es",
    });
    const unit = unitCell.ok ? unitCell.canonical : line.unit;
    const qty =
      unitCell.ok && unitCell.quantityMultiplier !== 1
        ? line.qty * unitCell.quantityMultiplier
        : line.qty;
    if (!unitCell.ok) {
      reasons.push(
        `La unidad «${line.unit}» no se entiende. Elige la correcta.`
      );
      flags.push(FLAG_PENDING_UNIT_QUESTION);
    }

    // 2. Name, against the catalog only.
    const ingredientHits = ingredientsByKey.get(key) ?? [];
    const prepHits = prepsByKey.get(key) ?? [];
    let resolved: PrefilledLine["resolved"] = null;
    if (ingredientHits.length === 1 && prepHits.length === 0) {
      const hit = ingredientHits[0]!;
      resolved = {
        kind: "ingredient",
        id: hit.id,
        name: hit.name,
        via: "exact",
      };
    } else if (prepHits.length === 1 && ingredientHits.length === 0) {
      const hit = prepHits[0]!;
      resolved = {
        kind: "component",
        id: hit.id,
        name: hit.name,
        via: "exact",
      };
    } else if (ingredientHits.length + prepHits.length > 1) {
      reasons.push(fmt(msg.ambiguous, { name: line.raw_name }));
    } else {
      const remembered = input.aliases?.get(key);
      const target = remembered ? ingredientById.get(remembered) : undefined;
      if (target) {
        resolved = {
          kind: "ingredient",
          id: target.id,
          name: target.name,
          via: "alias",
        };
      }
    }
    if (!resolved) {
      flags.push(FLAG_PENDING_INGREDIENT);
      if (ingredientHits.length + prepHits.length <= 1) {
        reasons.push(fmt(msg.notInList, { name: line.raw_name }));
      }
    }

    // 3. Does the Excel's own price say the unit label is wrong?
    let unitQuestion: UnitQuestion | null = null;
    if (resolved?.kind === "ingredient" && unitCell.ok) {
      const ingredient = ingredientById.get(resolved.id);
      const suggested = suggestedUnitFromPrice({
        writtenUnit: unit,
        excelUnitCost: line.excel_unit_cost,
        catalogUnit: ingredient?.default_unit ?? null,
        catalogUnitCost: ingredient?.unit_cost ?? null,
      });
      if (suggested) {
        unitQuestion = { written: unit, suggested };
        flags.push(FLAG_PENDING_UNIT_QUESTION);
        reasons.push(
          `Tu archivo dice ${unit}, pero su precio corresponde a ${suggested}. Confirma la unidad.`
        );
      }
    }

    const pending = !resolved || flags.length > 0;
    return {
      source_row: line.source_row,
      raw_name: line.raw_name,
      qty,
      unit,
      unit_ok: unitCell.ok,
      excel_unit_cost: line.excel_unit_cost,
      resolved,
      unit_question: unitQuestion,
      pending,
      flags: pending ? [...new Set(flags)] : ["ok"],
      reasons,
    };
  });
}
