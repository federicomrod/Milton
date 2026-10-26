// Intent detection for Ask Milton — pure keyword matching, no AI.
// Re-exported from ../ask-milton-prompt.

export type AskMiltonIntent =
  | "most_profitable_dish"
  | "least_profitable_dishes"
  | "dish_food_cost"
  | "expensive_ingredients"
  | "ingredient_usage"
  | "supplier_risk"
  | "invoices_needing_review"
  | "missing_recipes"
  | "cost_coverage"
  | "agent_recommendations"
  | "top_selling_items"
  | "best_sales_day"
  | "generic";

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function mentionsDish(m: string): boolean {
  return (
    m.includes("plato") ||
    m.includes("platillo") ||
    m.includes("dish") ||
    m.includes("dishes") ||
    m.includes("menu item")
  );
}

function mentionsIngredient(m: string): boolean {
  return m.includes("ingrediente") || m.includes("ingredient");
}

export function detectIntent(message: string): AskMiltonIntent {
  const m = fold(message);
  const has = (...words: string[]) => words.some((w) => m.includes(fold(w)));

  // ingredient_usage — must come before "recipe" and "ingredient" generics
  if (
    has(
      "which recipe",
      "what recipe",
      "recipes use",
      "recipe use",
      "recipe for",
      "dishes use",
      "where is",
      "where does",
      "what uses",
      "what dish uses",
      "which dish uses",
      "which menu item",
      "what menu item",
      "affected by",
      "use this ingredient",
      "use these ingredients",
      "use those ingredients"
    )
  ) {
    return "ingredient_usage";
  }
  if (
    has(
      "which days",
      "what days",
      "qué días",
      "que dias",
      "qué día",
      "que dia",
      "busiest day",
      "best day",
      "día más",
      "dia mas",
      "sell the most"
    )
  ) {
    return "best_sales_day";
  }
  if (
    has(
      "most sold",
      "best selling",
      "best-selling",
      "top selling",
      "top-selling",
      "más vendidos",
      "mas vendidos",
      "más vendido",
      "mas vendido",
      "top items",
      "artículos de desayuno",
      "articulos de desayuno"
    )
  ) {
    return "top_selling_items";
  }
  if (
    has(
      "most profitable",
      "highest margin",
      "best margin",
      "top margin",
      "mas rentable",
      "mayor margen",
      "mejor margen"
    )
  ) {
    return "most_profitable_dish";
  }

  // Platos / dishes + food cost %, margen or rentabilidad → dish ranking
  // (Menú › Resumen costing). Never the ingredient-price ranking.
  const dishFoodCostSignal =
    has(
      "least profitable",
      "lowest margin",
      "worst margin",
      "low margin",
      "which dishes should i fix",
      "fix first",
      "peor margen",
      "menos rentable",
      "me deja menos",
      "deja menos",
      "food cost"
    ) ||
    (mentionsDish(m) &&
      !mentionsIngredient(m) &&
      has(
        "costo",
        "cost",
        "margen",
        "margin",
        "rentabil",
        "profit",
        "%",
        "porcentaje",
        "precio de venta"
      ));
  if (dishFoodCostSignal) {
    return "dish_food_cost";
  }

  // Ingredient-cost intent — includes business-oriented phrasings (cost drivers,
  // margin impact, negotiation targets) as well as direct unit-cost questions.
  if (
    has(
      "ingredientes caros",
      "ingredientes más caros",
      "ingredientes mas caros",
      "ingrediente más caro",
      "ingrediente mas caro",
      "salen más caros",
      "salen mas caros",
      "ingredientes costosos",
      "ingrediente costoso",
      "precio de los ingredientes",
      "precios de ingredientes",
      "most expensive ingredient",
      "expensive ingredient",
      "highest cost ingredient",
      "costliest",
      "priciest",
      "which ingredient",
      "ingredient cost",
      "biggest cost driver",
      "cost driver",
      "cost impact",
      "cost pressure",
      "which ingredients impact",
      "ingredients impact",
      "negotiate on ingredient",
      "should i negotiate",
      "which ingredient should",
      "ingredient spending",
      "ingredient expense",
      "what ingredients are",
      "which ingredients are"
    )
  ) {
    return "expensive_ingredients";
  }
  if (
    has(
      "supplier increase",
      "price increase",
      "price went up",
      "supplier risk",
      "supplier cost",
      "which supplier"
    )
  ) {
    return "supplier_risk";
  }
  if (has("invoice", "review", "need review", "pending invoice")) {
    return "invoices_needing_review";
  }
  if (
    has(
      "missing recipe",
      "no recipe",
      "without recipe",
      "recipe missing",
      "items without recipe",
      "items missing recipe"
    )
  ) {
    return "missing_recipes";
  }
  if (
    has(
      "cost coverage",
      "coverage incomplete",
      "costing incomplete",
      "coverage gap",
      "incomplete cost"
    )
  ) {
    return "cost_coverage";
  }
  if (
    has(
      "recommendation",
      "agent",
      "action",
      "what should i do",
      "this week",
      "do next",
      "priority"
    )
  ) {
    return "agent_recommendations";
  }
  if (
    has("margin", "margen", "profit", "food cost", "gross margin", "rentabil")
  ) {
    return "dish_food_cost";
  }
  // Broad ingredient/cost catch — comes after specific patterns above.
  // Dish + cost % questions must not land here (handled above).
  if (
    mentionsDish(m) &&
    !mentionsIngredient(m) &&
    has("cost", "costo", "price", "precio")
  ) {
    return "dish_food_cost";
  }
  if (has("cost", "expensive", "ingredient", "price")) {
    return "expensive_ingredients";
  }
  if (has("recipe", "blocking")) {
    return "missing_recipes";
  }
  if (has("supplier", "vendor")) {
    return "supplier_risk";
  }
  return "generic";
}
