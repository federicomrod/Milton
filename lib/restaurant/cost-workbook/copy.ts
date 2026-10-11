import { t, type PreferredLanguage } from "@/lib/restaurant/language";

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
