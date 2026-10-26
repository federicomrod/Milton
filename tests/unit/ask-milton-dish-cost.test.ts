import { describe, expect, it } from "vitest";
import { EMPTY_INGREDIENT_PRICES } from "@/lib/restaurant/ask-milton-catalog";
import {
  generateSuggestedActions,
  isPerItemAskMiltonChip,
} from "@/lib/restaurant/ask-milton-actions";
import {
  buildDeterministicAnswer,
  detectIntent,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import { emptySalesSnapshot } from "@/lib/restaurant/ask-milton-sales";

const NO_ENTITIES: ResolvedEntities = {
  resolved_ingredients: [],
  resolved_menu_items: [],
};

function briefing(): BriefingContext {
  return {
    restaurant_name: "Casa Prueba",
    preferred_language: "es",
    period_label: "julio 2026",
    currency: "USD",
    kpis: {
      revenue: 10000,
      orders: 80,
      units_sold: 120,
      avg_ticket: 125,
      cost_coverage_pct: 70,
      estimated_cogs: 3000,
      estimated_gross_profit: 4000,
      estimated_gross_margin_pct: 40,
      food_cost_pct: 30,
    },
    top_revenue_items: [],
    low_margin_items: [],
    high_food_cost_items: [],
    high_revenue_missing_recipe: [],
    costing_blockers: [],
    supplier_price_increases: [],
    top_suppliers: [],
    open_recommendations: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      by_agent: [],
    },
    data_quality: {
      unmapped_pos_items: 0,
      menu_items_without_recipe: 2,
      recipes_with_unit_mismatch: 0,
      ingredients_without_cost_entries: 0,
      components_without_recipe: 0,
      pos_rows_reviewed: 0,
    },
  };
}

function dish(
  name: string,
  food_cost_pct: number | null,
  net_sales = 100,
  cost_status?: "aprobado" | "estimado" | "falta_precio" | "sin_receta"
) {
  return {
    name,
    category: "Carnes",
    net_sales,
    units: 10,
    food_cost_pct,
    margin_pct: food_cost_pct === null ? null : 100 - food_cost_pct,
    cost_status:
      cost_status ?? (food_cost_pct === null ? "sin_receta" : "aprobado"),
  };
}

function ctxWithDishes(dishes: ReturnType<typeof dish>[]): AskMiltonContext {
  const costed = dishes.filter(
    (d) => d.cost_status === "aprobado" && d.food_cost_pct !== null
  );
  return {
    context_scope: { mode: "consolidated", restaurant_name: "Casa Prueba" },
    briefing: briefing(),
    menu: { most_profitable_items: [], least_profitable_items: [] },
    ingredient_prices: {
      ...EMPTY_INGREDIENT_PRICES,
      priced_count: 1,
      unpriced_count: 3,
      top_by_unit_cost: [
        {
          name: "Entraña Angus",
          category: null,
          price: 1.16,
          unit: "oz",
          currency: "USD",
          price_date: "2026-07-01",
          source: "lista",
          supplier_name: "PROVEEDOR",
          dishes_using: 1,
          used_in: ["Entraña"],
        },
      ],
    },
    menu_dishes: {
      currency: "USD",
      period: { from: "2026-07-01", to: "2026-07-31" },
      dish_count: dishes.length,
      uncosted_count: dishes.length - costed.length,
      top_by_sales: dishes,
      top_by_food_cost: [...costed].sort(
        (a, b) => (b.food_cost_pct ?? 0) - (a.food_cost_pct ?? 0)
      ),
      sales_by_category: [],
    },
    item_groups: [],
    ingredient_usage: [],
    expensive_ingredients: [],
    suppliers: { total: 0, top: [], missing_metadata: [] },
    invoices: {
      total_recent: 0,
      posted_count: 0,
      needs_review_count: 0,
      latest: [],
      needs_review: [],
    },
    ingredients: {
      total: 0,
      highest_unit_cost: [],
      missing_supplier: [],
      missing_category: [],
    },
    agent_actions: { counts_by_status: {}, open: [], recent: [] },
    agent_runs: { recent: [] },
    sales: emptySalesSnapshot(),
  };
}

describe("detectIntent — dish food-cost questions", () => {
  it("routes the CEO sentence without accents to dish food-cost, not ingredients", () => {
    expect(
      detectIntent(
        "que platos tienen el mayor costo como % de precio de venta?"
      )
    ).toBe("dish_food_cost");
  });

  it("routes «¿qué platos tienen peor margen?»", () => {
    expect(detectIntent("¿qué platos tienen peor margen?")).toBe(
      "dish_food_cost"
    );
  });

  it("routes «food cost más alto»", () => {
    expect(detectIntent("food cost más alto")).toBe("dish_food_cost");
  });

  it("routes «¿qué plato me deja menos?»", () => {
    expect(detectIntent("¿qué plato me deja menos?")).toBe("dish_food_cost");
  });

  it("still routes expensive-ingredient questions to ingredient prices", () => {
    expect(detectIntent("¿Qué ingredientes salen más caros?")).toBe(
      "expensive_ingredients"
    );
    expect(detectIntent("¿qué ingredientes son más caros?")).toBe(
      "expensive_ingredients"
    );
  });

  it("routes «¿Cuál es mi costo de alimentos?» to dish food-cost", () => {
    expect(detectIntent("¿Cuál es mi costo de alimentos?")).toBe(
      "dish_food_cost"
    );
  });

  it("routes «¿Qué porcentaje de costo tiene la hamburguesa?» to dish food-cost", () => {
    expect(detectIntent("¿Qué porcentaje de costo tiene la hamburguesa?")).toBe(
      "dish_food_cost"
    );
  });

  it("routes «¿Qué plato cuesta más?» to dish food-cost", () => {
    expect(detectIntent("¿Qué plato cuesta más?")).toBe("dish_food_cost");
  });
});

describe("buildDeterministicAnswer — dish food-cost", () => {
  const ctx = ctxWithDishes([
    dish("Entraña", 47.6),
    dish("Ribeye", 41),
    dish("Taco", 22),
    dish("Agua", null),
    dish("Postre", null),
  ]);

  it("ranks platos by cost / sale price and counts those without cost", () => {
    const out = buildDeterministicAnswer(
      ctx,
      "que platos tienen el mayor costo como % de precio de venta?",
      "dish_food_cost",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/Entraña — 48%/);
    expect(out.answer).toMatch(/Ribeye — 41%/);
    expect(out.answer).toMatch(/Taco — 22%/);
    expect(out.answer).toMatch(/2 platos sin costo todavía/);
    expect(out.answer).not.toMatch(/Agua|Postre|0%/);
    expect(out.answer).not.toMatch(/Entraña Angus|\$0|\$1\.16/);
    expect(out.suggested_followups).toHaveLength(2);
    expect(out.related_links).toHaveLength(2);
    expect(JSON.stringify(out)).not.toMatch(/platillo/i);
    expect(out.confidence_notes.join(" ")).not.toMatch(/unidades difieren/i);
  });

  it("excludes estimado and falta_precio from the ranking and counts them as sin costo", () => {
    const ctx = ctxWithDishes([
      dish("Aprobado", 40),
      dish("Estimado IA", 80, 100, "estimado"),
      dish("Falta precio", 55, 100, "falta_precio"),
    ]);
    const out = buildDeterministicAnswer(
      ctx,
      "food cost más alto",
      "dish_food_cost",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/Aprobado — 40%/);
    expect(out.answer).toMatch(/2 platos sin costo todavía/);
    expect(out.answer).not.toMatch(/Estimado IA|Falta precio|80%|55%/);
  });

  it("does not fall back to briefing or profit lists when menu_dishes is missing", () => {
    const ctx = ctxWithDishes([]);
    ctx.menu_dishes = null;
    ctx.briefing.high_food_cost_items = [
      {
        menu_item_id: "x",
        name: "Briefing Fake",
        revenue: 100,
        gross_margin_pct: 10,
        food_cost_pct: 90,
      },
    ];
    ctx.menu.least_profitable_items = [
      {
        menu_item_id: "y",
        name: "Profit Fake",
        category: "Carnes",
        selling_price: 20,
        estimated_cost: 18,
        gross_margin_pct: 10,
        food_cost_pct: 90,
        gross_profit_per_item: 2,
      },
    ];
    const out = buildDeterministicAnswer(
      ctx,
      "que platos tienen el mayor costo como % de precio de venta?",
      "dish_food_cost",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/Aún no hay platos con costo/);
    expect(out.answer).not.toMatch(/Briefing Fake|Profit Fake|90%/);
  });

  it("never shows a missing cost as 0%", () => {
    const empty = ctxWithDishes([
      dish("Sin receta", null),
      dish("Falta", null),
    ]);
    const out = buildDeterministicAnswer(
      empty,
      "¿qué platos tienen peor margen?",
      detectIntent("¿qué platos tienen peor margen?"),
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/2 platos sin costo todavía/);
    expect(out.answer).not.toMatch(/0%/);
    expect(out.answer).not.toMatch(/\$0/);
  });

  it("renders no per-item action chips", () => {
    const ctx = ctxWithDishes([dish("Entraña", 48)]);
    ctx.menu.least_profitable_items = [
      {
        menu_item_id: "item-1",
        name: "Entraña",
        category: "Carnes",
        selling_price: 20,
        estimated_cost: 12,
        gross_margin_pct: 20,
        food_cost_pct: 60,
        gross_profit_per_item: 8,
      },
    ];
    const actions = generateSuggestedActions(
      "que platos tienen el mayor costo como % de precio de venta?",
      ctx,
      "dish_food_cost"
    );
    expect(actions).toEqual([]);
    expect(actions.filter(isPerItemAskMiltonChip)).toEqual([]);
  });
});

describe("buildDeterministicAnswer — expensive ingredients chrome", () => {
  it("does not emit the units-differ note or more than 2 follow-ups", () => {
    const out = buildDeterministicAnswer(
      ctxWithDishes([]),
      "¿Qué ingredientes salen más caros?",
      "expensive_ingredients",
      NO_ENTITIES
    );
    expect(out.answer).toContain("Entraña Angus");
    expect(out.answer).toContain("Sin precio");
    expect(out.answer).not.toMatch(/\$0/);
    expect(out.confidence_notes).toEqual([]);
    expect(out.supporting_facts).toEqual([]);
    expect(out.suggested_followups.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(out)).not.toMatch(/unidades difieren/i);
    expect(JSON.stringify(out)).not.toMatch(/platillo/i);
  });
});
