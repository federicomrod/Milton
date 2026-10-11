import { nameKey } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  isSubRecipePortionUnit,
  resolveUnitCell,
  type ResolvedUnitCell,
} from "@/lib/restaurant/units";

/**
 * CONVOY / ORDEN become `portion` only after the line name is exactly
 * one known sub-recipe. Otherwise they stay unknown units.
 */
export function resolveRecipeLineUnit(input: {
  unitRaw: string;
  ingredientName: string;
  knownSubRecipeNames: Iterable<string>;
  lang?: PreferredLanguage;
}): ResolvedUnitCell {
  const lang = input.lang ?? "en";
  if (isSubRecipePortionUnit(input.unitRaw)) {
    const key = nameKey(input.ingredientName);
    const matches = [...input.knownSubRecipeNames].filter(
      (name) => nameKey(name) === key
    );
    if (matches.length === 1) {
      return {
        ok: true,
        unit: "portion",
        canonical: "portion",
        quantityMultiplier: 1,
      };
    }
    return resolveUnitCell(input.unitRaw, lang);
  }
  return resolveUnitCell(input.unitRaw, lang);
}

export function rawLineUnit(line: {
  unit: string;
  raw: Record<string, unknown>;
}): string {
  const fromRaw = line.raw["Unidad Detalle"] ?? line.raw["Unidad"];
  if (typeof fromRaw === "string" && fromRaw.trim()) return fromRaw.trim();
  return line.unit;
}
