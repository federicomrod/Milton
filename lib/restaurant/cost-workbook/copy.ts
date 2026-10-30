import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function suggestionVersionNotes(
  status: "borrador" | "lista_para_aprobar"
): string {
  return status === "lista_para_aprobar" ? "Lista para aprobar" : "Borrador";
}

export function missingUnitReason(lang: PreferredLanguage): string {
  return t(lang, "Missing unit", "Falta la unidad", "Einheit fehlt");
}

export function missingRecipeNameReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Missing recipe name",
    "Falta el nombre de la receta",
    "Rezeptname fehlt"
  );
}

export function missingIngredientNameReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Missing ingredient name",
    "Falta el nombre del ingrediente",
    "Name der Zutat fehlt"
  );
}

export function totalMismatchReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "the printed total does not match quantity × unit cost; the line was imported with the recomputed cost and flagged",
    "el total impreso no cuadra (cantidad × costo unitario); la fila se importó con el costo recalculado y quedó marcada",
    "die gedruckte Summe stimmt nicht (Menge × Stückkosten); die Zeile wurde mit den neu berechneten Kosten importiert und markiert"
  );
}

export function yieldInconsistentReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "could not calculate yield: total cost and the price per lb/oz do not agree",
    "no pude calcular el rendimiento: el costo total y el precio por libra/onza no coinciden",
    "Ausbeute konnte nicht berechnet werden: Gesamtkosten und Preis pro Pfund/Unze passen nicht zusammen"
  );
}

export function yieldUnknownReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "could not calculate yield",
    "no pude calcular el rendimiento",
    "Ausbeute konnte nicht berechnet werden"
  );
}

export function assumedYieldReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Assumed yield: 1 order (the Excel only has COSTO TOTAL)",
    "Rendimiento asumido: 1 orden (el Excel solo trae COSTO TOTAL)",
    "Angenommene Ausbeute: 1 Portion (die Excel-Datei enthält nur COSTO TOTAL)"
  );
}

export function inferredCostTotalReason(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `I added up the line totals for ${name} because the Excel has no COSTO TOTAL. Check the yield before you use it.`,
    `sumé los totales de las líneas de ${name} porque el Excel no trae COSTO TOTAL. Revisa el rendimiento antes de usarlo.`,
    `Ich habe die Positionssummen für ${name} addiert, weil die Excel-Datei kein COSTO TOTAL enthält. Prüfen Sie die Ausbeute, bevor Sie sie verwenden.`
  );
}

export function ambiguousNumberReason(
  lang: PreferredLanguage,
  raw: string
): string {
  return t(
    lang,
    `this number is ambiguous (${raw})`,
    `este número es ambiguo (${raw})`,
    `diese Zahl ist mehrdeutig (${raw})`
  );
}

export function emptyRecipeNameReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "recipe name with no ingredients",
    "nombre de receta sin ingredientes",
    "Rezeptname ohne Zutaten"
  );
}

export function strayNameRowReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "lone name row inside a recipe",
    "fila de nombre suelta dentro de una receta",
    "einzelne Namenszeile innerhalb eines Rezepts"
  );
}

export function handmadeRecipeExistsReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "handmade recipe exists",
    "la receta fue editada a mano",
    "das Rezept wurde manuell bearbeitet"
  );
}

export function positiveQuantityReason(lang: PreferredLanguage): string {
  return t(
    lang,
    "Quantity must be a positive number",
    "La cantidad tiene que ser un número positivo",
    "Die Menge muss eine positive Zahl sein"
  );
}

export function workbookMismatchEngineMessage(
  lang: PreferredLanguage,
  name: string
): string {
  return t(
    lang,
    `${name} imported cost does not match the Excel COSTO TOTAL.`,
    `El costo importado de ${name} no cuadra con el COSTO TOTAL del Excel.`,
    `Die importierten Kosten von ${name} stimmen nicht mit dem COSTO TOTAL der Excel-Datei überein.`
  );
}

export function pendingRecipesLabel(lang: PreferredLanguage): string {
  return t(
    lang,
    "Pending recipes",
    "Pendiente de recetas",
    "Rezepte ausstehend"
  );
}

export function isPendingRecipeCostStatus(status: string): boolean {
  return (
    status === "missing_recipe" ||
    status === "missing_component_recipe" ||
    status === "no_cost_entries" ||
    status === "missing_input_cost" ||
    status === "missing_ingredient_cost"
  );
}

export function notAvailableYetLabel(lang: PreferredLanguage): string {
  return t(
    lang,
    "Not available yet",
    "Aún no disponible",
    "Noch nicht verfügbar"
  );
}
