import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { PACK_SIZE_REVIEW_REASON } from "@/lib/restaurant/units";

export function unknownUnitReason(
  lang: PreferredLanguage,
  raw: string
): string {
  return t(lang, `unknown unit (${raw})`, `unidad desconocida (${raw})`);
}

export function unknownIngredientReason(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `unknown ingredient (${name})`,
    `ingrediente desconocido (${name})`
  );
}

export function missingUnitReason(lang: PreferredLanguage): string {
  return t(lang, "Missing unit", "Falta la unidad");
}

export function missingRecipeNameReason(lang: PreferredLanguage): string {
  return t(lang, "Missing recipe name", "Falta el nombre de la receta");
}

export function missingIngredientNameReason(lang: PreferredLanguage): string {
  return t(lang, "Missing ingredient name", "Falta el nombre del ingrediente");
}

export function packSizeReviewReason(lang: PreferredLanguage): string {
  return t(lang, "pack size, needs conversion", PACK_SIZE_REVIEW_REASON);
}

export function isPackSizeReviewReason(reason: string): boolean {
  return (
    reason === PACK_SIZE_REVIEW_REASON || reason === packSizeReviewReason("en")
  );
}

export function totalMismatchReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "the printed total does not match quantity × unit cost; the line was imported with the recomputed cost and flagged",
    "el total impreso no cuadra (cantidad × costo unitario); la fila se importó con el costo recalculado y quedó marcada"
  );
}

export function yieldInconsistentReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "could not calculate yield: total cost and the price per lb/oz do not agree",
    "no pude calcular el rendimiento: el costo total y el precio por libra/onza no coinciden"
  );
}

export function yieldUnknownReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "could not calculate yield",
    "no pude calcular el rendimiento"
  );
}

export function assumedYieldReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Assumed yield: 1 order (the Excel only has COSTO TOTAL)",
    "Rendimiento asumido: 1 orden (el Excel solo trae COSTO TOTAL)"
  );
}

export function yieldUnknownForReason(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `can't tell the yield for ${name}`,
    `no pude calcular el rendimiento de ${name}`
  );
}

export function persistWriteFailedReason(
  lang: PreferredLanguage,
  detail: string,
  name?: string
): string {
  if (name) {
    return t(
      lang,
      `I couldn't save ${name}: ${detail}`,
      `no pude guardar ${name}: ${detail}`
    );
  }
  return t(
    lang,
    `I couldn't save the recipes: ${detail}`,
    `no pude guardar las recetas: ${detail}`
  );
}

export function emptyRecipeNameReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "recipe name with no ingredients",
    "nombre de receta sin ingredientes"
  );
}

export function strayNameRowReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "lone name row inside a recipe",
    "fila de nombre suelta dentro de una receta"
  );
}

export function handmadeRecipeExistsReason(lang: PreferredLanguage): string {
  return t(lang, "handmade recipe exists", "la receta fue editada a mano");
}

export const MISSING_WORKBOOK_COST_MIGRATION_ES =
  "Falta aplicar la migración 035 en la base de datos. Avísale al equipo técnico.";

export const MISSING_IMPORT_COSTING_036_ES =
  "Falta aplicar la migración 036 en la base de datos. Avísale al equipo técnico.";

export function positiveQuantityReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Quantity must be a positive number",
    "La cantidad tiene que ser un número positivo"
  );
}

export function workbookMatchLabel(lang: PreferredLanguage): string {
  return t(lang, "Matches the Excel", "Cuadra con Excel");
}

export function workbookMismatchLabel(lang: PreferredLanguage): string {
  return t(lang, "Does not match the Excel", "No cuadra con el Excel");
}

export function workbookMismatchEngineMessage(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `${name} imported cost does not match the Excel COSTO TOTAL.`,
    `El costo importado de ${name} no cuadra con el COSTO TOTAL del Excel.`
  );
}

export function pendingRecipesLabel(lang: PreferredLanguage): string {
  return t(lang, "Pending recipes", "Pendiente de recetas");
}

export function isPendingRecipeCostStatus(status: string): boolean {
  return status === "missing_recipe" || status === "missing_component_recipe";
}

export function notAvailableYetLabel(lang: PreferredLanguage): string {
  return t(lang, "Not available yet", "Aún no disponible");
}

export function handmadeNoLongerComparedNote(lang: PreferredLanguage): string {
  return t(
    lang,
    "Edited by hand, no longer compared with the Excel",
    "Editada a mano, ya no se compara con el Excel"
  );
}

export function selfReferenceReason(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `skipped a self-reference (${name})`,
    `omití una referencia a sí misma (${name})`
  );
}

export function workbookMismatchReason(
  lang: PreferredLanguage,
  excelCost: number | null,
  miltonCost: number | null
): string {
  const excel =
    excelCost == null
      ? "—"
      : excelCost.toLocaleString("es-MX", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const milton =
    miltonCost == null
      ? "—"
      : miltonCost.toLocaleString("es-MX", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return t(
    lang,
    `Excel cost ${excel} does not match Milton cost ${milton}`,
    `el costo del Excel (${excel}) no coincide con el de Milton (${milton})`
  );
}

export function workbookMatchHeadline(input: {
  lang: PreferredLanguage;
  dishesMatched: number;
  dishesTotal: number;
  subsMatched: number;
  subsTotal: number;
}): string {
  const dishes = t(
    input.lang,
    `${input.dishesMatched} of ${input.dishesTotal} dishes match the Excel`,
    `${input.dishesMatched} de ${input.dishesTotal} platillos cuadran con el Excel`
  );
  const subs = t(
    input.lang,
    `${input.subsMatched} of ${input.subsTotal} sub-recipes match the Excel`,
    `${input.subsMatched} de ${input.subsTotal} sub-recetas cuadran con el Excel`
  );
  if (input.dishesTotal === 0 && input.subsTotal === 0) return "";
  if (input.dishesTotal === 0) return subs;
  if (input.subsTotal === 0) return dishes;
  return `${dishes}. ${subs}.`;
}

export function uncertainSubRecipeReason(
  lang: PreferredLanguage,
  detail: string
): string {
  return t(
    lang,
    `uncertain sub-recipe (${detail})`,
    `sub-receta incierta (${detail})`
  );
}

export function ambiguousMappingReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "It's not clear which column is the unit, the quantity, or the ingredient.",
    "No está claro qué columna es la unidad, la cantidad o el ingrediente."
  );
}

export function mappingSourceLabel(
  lang: PreferredLanguage,
  source: string
): string {
  if (source === "saved") {
    return t(lang, "remembered layout", "diseño recordado");
  }
  if (source === "heuristic") {
    return t(lang, "columns from values", "columnas según los valores");
  }
  if (source === "mixed") {
    return t(lang, "mixed", "mixto");
  }
  if (source === "none") {
    return t(lang, "none", "ninguno");
  }
  return t(lang, "AI", "IA");
}

export function tabTypeLabel(lang: PreferredLanguage, type: string): string {
  if (type === "price_list") return t(lang, "Price list", "Lista de precios");
  if (type === "category_cost") {
    return t(lang, "Category costs", "Costos por categoría");
  }
  if (type === "purchases") return t(lang, "Purchases", "Compras");
  if (type === "recipe") return t(lang, "Recipe", "Receta");
  if (type === "sub_recipe") return t(lang, "Sub-recipe", "Sub-receta");
  return t(lang, "Skipped", "Omitida");
}
