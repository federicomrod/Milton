import { describe, it, expect } from "vitest";
import {
  buildDeterministicAnswer,
  ASK_MILTON_SYSTEM_PROMPT,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import type {
  AskMiltonContext,
  AskMiltonContextScope,
} from "@/lib/restaurant/ask-milton-context";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// Milton Language Foundation v1 — proves Ask Milton's deterministic
// fallback (used whenever OpenAI is unavailable) genuinely respects the
// company's preferred_language, mirroring the same requirement already
// proven for the executive briefing (Phase 6, scenarios 3 & 4).

function briefingFixture(lang: PreferredLanguage): BriefingContext {
  return {
    restaurant_name: "Pinche Gringo BBQ",
    preferred_language: lang,
    period_label: "all available POS data",
    currency: "MXN",
    kpis: {
      revenue: 50000,
      orders: 200,
      units_sold: 400,
      avg_ticket: 250,
      cost_coverage_pct: 60,
      estimated_cogs: 15000,
      estimated_gross_profit: 20000,
      estimated_gross_margin_pct: 55,
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
      menu_items_without_recipe: 0,
      recipes_with_unit_mismatch: 0,
      ingredients_without_cost_entries: 0,
      components_without_recipe: 0,
      pos_rows_reviewed: 0,
    },
  };
}

function contextFixture(
  lang: PreferredLanguage,
  scope: AskMiltonContextScope = {
    mode: "consolidated",
    restaurant_name: "Pinche Gringo BBQ",
  }
): AskMiltonContext {
  return {
    context_scope: scope,
    briefing: briefingFixture(lang),
    menu: {
      most_profitable_items: [
        {
          menu_item_id: "item-1",
          name: "Brisket Taco",
          category: "Tacos",
          selling_price: 120,
          estimated_cost: 40,
          gross_margin_pct: 66.7,
          food_cost_pct: 33.3,
          gross_profit_per_item: 80,
        },
      ],
      least_profitable_items: [],
    },
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
  };
}

const NO_ENTITIES: ResolvedEntities = {
  resolved_ingredients: [],
  resolved_menu_items: [],
};

describe("ASK_MILTON_SYSTEM_PROMPT — language instruction (Phase 4)", () => {
  it("instructs the model to use context.briefing.preferred_language and never translate proper nouns", () => {
    expect(ASK_MILTON_SYSTEM_PROMPT).toContain(
      "context.briefing.preferred_language"
    );
    expect(ASK_MILTON_SYSTEM_PROMPT.toLowerCase()).toContain("never translate");
  });
});

describe("buildDeterministicAnswer — English (Phase 6, scenario 3)", () => {
  it("'most profitable dish' answers in English", () => {
    const out = buildDeterministicAnswer(
      contextFixture("en"),
      "what is my most profitable dish?",
      "most_profitable_dish",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/most profitable dish/i);
    expect(out.answer).toContain("Brisket Taco");
    expect(out.related_links[0]?.label).toBe("Menu & Recipes");
  });

  it("the generic fallback answers in English", () => {
    const out = buildDeterministicAnswer(
      contextFixture("en"),
      "how are things going?",
      "generic",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/recorded/i);
  });
});

describe("buildDeterministicAnswer — Spanish (Phase 6, scenario 4 — must not silently fall back to English)", () => {
  it("'most profitable dish' answers in Spanish", () => {
    const out = buildDeterministicAnswer(
      contextFixture("es"),
      "¿cuál es mi platillo más rentable?",
      "most_profitable_dish",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/platillo más rentable/i);
    expect(out.answer).not.toMatch(/most profitable dish/i);
    expect(out.related_links[0]?.label).toBe("Menú y Recetas");
  });

  it("preserves the dish's proper noun name unchanged (never translated)", () => {
    const out = buildDeterministicAnswer(
      contextFixture("es"),
      "¿cuál es mi platillo más rentable?",
      "most_profitable_dish",
      NO_ENTITIES
    );
    expect(out.answer).toContain("Brisket Taco");
  });

  it("the generic fallback answers in Spanish, not English", () => {
    const out = buildDeterministicAnswer(
      contextFixture("es"),
      "cómo van las cosas?",
      "generic",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/registró/i);
    expect(out.answer).not.toMatch(/recorded/i);
  });
});

describe("buildDeterministicAnswer — multi-restaurant selection is orthogonal to language (Phase 6, scenario 9)", () => {
  it("a Spanish company with a specific restaurant selected still answers fully in Spanish", () => {
    const scoped: AskMiltonContextScope = {
      mode: "single_restaurant",
      restaurant_name: "Pinche Gringo Roma",
    };
    const out = buildDeterministicAnswer(
      contextFixture("es", scoped),
      "¿cuál es mi platillo más rentable?",
      "most_profitable_dish",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/platillo más rentable/i);
  });

  it("an English company with a specific restaurant selected still answers fully in English", () => {
    const scoped: AskMiltonContextScope = {
      mode: "single_restaurant",
      restaurant_name: "Pinche Gringo Roma",
    };
    const out = buildDeterministicAnswer(
      contextFixture("en", scoped),
      "what is my most profitable dish?",
      "most_profitable_dish",
      NO_ENTITIES
    );
    expect(out.answer).toMatch(/most profitable dish/i);
  });
});
