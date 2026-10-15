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
    const key = nameKey(input.ingredientName).replace(/\s+/g, " ");
    const matches = new Set(
      [...input.knownSubRecipeNames]
        .map((name) => nameKey(name).replace(/\s+/g, " "))
        .filter((name) => name === key)
    );
    if (matches.size === 1) {
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
