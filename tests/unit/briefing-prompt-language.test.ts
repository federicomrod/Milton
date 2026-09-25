import { describe, it, expect } from "vitest";
import {
  buildDeterministicBriefing,
  BRIEFING_SYSTEM_PROMPT,
} from "@/lib/restaurant/briefing-prompt";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// Milton Language Foundation v1 — proves the executive briefing's
// deterministic fallback (used whenever OpenAI is unavailable) genuinely
// respects the company's preferred_language rather than silently emitting
// English for a Spanish-preference company (Phase 6, scenarios 1 & 2).

function fixture(
  lang: PreferredLanguage,
  overrides: Partial<BriefingContext> = {}
): BriefingContext {
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
    top_revenue_items: [
      {
        menu_item_id: "item-1",
        name: "Brisket Taco",
        revenue: 10000,
        units_sold: 100,
        gross_margin_pct: 65,
        food_cost_pct: 25,
        cost_status: "complete",
      },
    ],
    low_margin_items: [
      {
        menu_item_id: "item-2",
        name: "Ribs Plate",
        revenue: 3000,
        gross_margin_pct: 20,
        food_cost_pct: 60,
      },
    ],
    high_food_cost_items: [],
    high_revenue_missing_recipe: [
      {
        menu_item_id: "item-3",
        name: "Pulled Pork Sandwich",
        revenue: 4000,
        units_sold: 40,
      },
    ],
    costing_blockers: [],
    supplier_price_increases: [
      {
        ingredient_id: "ing-1",
        ingredient_name: "Brisket",
        supplier_name: "Carnes del Norte",
        previous_cost: 100,
        latest_cost: 120,
        pct_change: 20,
        unit: "kg",
        latest_date: "2026-01-01",
      },
    ],
    top_suppliers: [],
    open_recommendations: {
      total: 2,
      critical: 1,
      warning: 1,
      info: 0,
      by_agent: [],
    },
    data_quality: {
      unmapped_pos_items: 3,
      menu_items_without_recipe: 2,
      recipes_with_unit_mismatch: 0,
      ingredients_without_cost_entries: 1,
      components_without_recipe: 0,
      pos_rows_reviewed: 500,
    },
    ...overrides,
  };
}

describe("BRIEFING_SYSTEM_PROMPT — language instruction (Phase 4)", () => {
  it("instructs the model to use context.preferred_language and never translate proper nouns", () => {
    expect(BRIEFING_SYSTEM_PROMPT).toContain("context.preferred_language");
    expect(BRIEFING_SYSTEM_PROMPT.toLowerCase()).toContain("never translate");
  });
});

describe("buildDeterministicBriefing — English (Phase 6, scenario 1)", () => {
  const out = buildDeterministicBriefing(fixture("en"));

  it("produces an English headline and summary", () => {
    expect(out.headline).toMatch(/revenue/i);
    expect(out.summary).toMatch(/Revenue across/i);
  });

  it("never emits Spanish sentence fragments", () => {
    const full = [
      out.headline,
      out.summary,
      ...out.top_risks,
      ...out.top_opportunities,
      ...out.recommended_actions,
    ].join(" ");
    expect(full).not.toMatch(/ingresos|margen|cobertura/i);
  });

  it("preserves the restaurant's proper noun name unchanged", () => {
    expect(out.headline).toContain("Pinche Gringo BBQ");
  });
});

describe("buildDeterministicBriefing — Spanish (Phase 6, scenario 2 — must not silently fall back to English)", () => {
  const out = buildDeterministicBriefing(fixture("es"));

  it("produces a Spanish headline and summary", () => {
    expect(out.headline).toMatch(/ingresos/i);
    expect(out.summary).toMatch(/ingresos/i);
  });

  it("translates risks, opportunities, and recommended actions into Spanish", () => {
    expect(out.top_risks.join(" ")).toMatch(/margen|precio/i);
    expect(out.top_opportunities.join(" ")).toMatch(/genera/i);
    expect(out.recommended_actions.join(" ")).toMatch(/agrega|vincula|sube/i);
  });

  it("never silently reverts to the English sentence templates", () => {
    expect(out.headline).not.toMatch(/^Pinche Gringo BBQ: \d.*in revenue$/);
    expect(out.summary).not.toContain("Revenue across");
  });

  it("preserves the restaurant's proper noun name unchanged (never translated)", () => {
    expect(out.headline).toContain("Pinche Gringo BBQ");
  });
});

describe("buildDeterministicBriefing — existing/default companies (Phase 6, scenario 8)", () => {
  it("a context with no explicit language override (English, the resolved default) behaves exactly like today", () => {
    const out = buildDeterministicBriefing(fixture("en"));
    expect(out.headline).toMatch(/revenue/i);
  });
});
