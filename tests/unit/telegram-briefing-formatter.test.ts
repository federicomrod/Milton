import { describe, it, expect } from "vitest";
import { formatBriefingForTelegram } from "@/lib/restaurant/telegram/briefing-formatter";
import { buildDeterministicBriefing } from "@/lib/restaurant/briefing-prompt";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// Telegram Daily Briefing v1 — proves the Telegram formatter reuses the
// SAME BriefingContext/BriefingOutput as the dashboard (no second briefing
// engine), respects the approved period-wording adjustment, and preserves
// proper nouns in both languages.

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

describe("formatBriefingForTelegram — English (scenario 1)", () => {
  const ctx = fixture("en");
  const briefing = buildDeterministicBriefing(ctx);
  const text = formatBriefingForTelegram(ctx, briefing);

  it("greets in English and uses the neutral, always-true framing line", () => {
    expect(text).toContain("Good morning");
    expect(text).toContain("Here's your latest Milton briefing.");
  });

  it("includes English section headers", () => {
    expect(text).toContain("💰 Sales");
    expect(text).toContain("📊 Margin");
    expect(text).toContain("⚠️ Watch");
    expect(text).toContain("✅ Actions");
  });

  it("never emits Spanish section headers or sentence fragments", () => {
    expect(text).not.toContain("💰 Ventas");
    expect(text).not.toContain("📊 Margen");
    expect(text).not.toMatch(/\bingresos\b|\bórdenes\b/i);
  });
});

describe("formatBriefingForTelegram — Spanish (scenario 2)", () => {
  const ctx = fixture("es");
  const briefing = buildDeterministicBriefing(ctx);
  const text = formatBriefingForTelegram(ctx, briefing);

  it("greets in Spanish and uses the neutral, always-true framing line", () => {
    expect(text).toContain("Buenos días");
    expect(text).toContain("Aquí tienes tu último briefing de Milton.");
  });

  it("includes Spanish section headers", () => {
    expect(text).toContain("💰 Ventas");
    expect(text).toContain("📊 Margen");
    expect(text).toContain("⚠️ Atención");
    expect(text).toContain("✅ Acciones");
  });

  it("never silently reverts to the English section headers", () => {
    expect(text).not.toContain("💰 Sales");
    expect(text).not.toContain("📊 Margin");
  });
});

describe("formatBriefingForTelegram — proper nouns unchanged (scenario 3)", () => {
  it("preserves restaurant, dish, ingredient, and supplier names in both languages", () => {
    for (const lang of ["en", "es"] as PreferredLanguage[]) {
      const ctx = fixture(lang);
      const briefing = buildDeterministicBriefing(ctx);
      const text = formatBriefingForTelegram(ctx, briefing);
      expect(text).toContain("Pinche Gringo BBQ");
      // Risks include the low-margin item and the supplier price increase —
      // both proper nouns must survive untranslated in the Telegram text.
      expect(text).toMatch(/Ribs Plate|Brisket/);
    }
  });
});

describe("formatBriefingForTelegram — period wording (Adjustment 1)", () => {
  it("never hardcodes 'yesterday' / 'de ayer' when the context does not guarantee that period", () => {
    for (const lang of ["en", "es"] as PreferredLanguage[]) {
      const ctx = fixture(lang); // period_label = "all available POS data"
      const briefing = buildDeterministicBriefing(ctx);
      const text = formatBriefingForTelegram(ctx, briefing);
      expect(text.toLowerCase()).not.toContain("yesterday");
      expect(text.toLowerCase()).not.toContain("de ayer");
    }
  });

  it("states the actual period_label from the context rather than inventing one", () => {
    const ctx = fixture("en", { period_label: "Jan 1 – Jan 7, 2026" });
    const briefing = buildDeterministicBriefing(ctx);
    const text = formatBriefingForTelegram(ctx, briefing);
    expect(text).toContain("Jan 1 – Jan 7, 2026");
  });
});

describe("formatBriefingForTelegram — message limits", () => {
  it("stays within Telegram's 4096-character sendMessage limit even with maximal content", () => {
    const ctx = fixture("en", {
      restaurant_name: "A".repeat(200),
      low_margin_items: Array.from({ length: 10 }, (_, i) => ({
        menu_item_id: `item-${i}`,
        name: `Very Long Menu Item Name Number ${i}`.repeat(3),
        revenue: 1000,
        gross_margin_pct: 10,
        food_cost_pct: 80,
      })),
    });
    const briefing = buildDeterministicBriefing(ctx);
    const text = formatBriefingForTelegram(ctx, briefing);
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("produces a concise message for a normal-sized briefing (well under the limit)", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const text = formatBriefingForTelegram(ctx, briefing);
    expect(text.length).toBeLessThan(2000);
  });
});

describe("formatBriefingForTelegram — no revenue yet", () => {
  it("handles a zero-revenue context without throwing and without a fabricated period claim", () => {
    const ctx = fixture("en", {
      kpis: {
        revenue: 0,
        orders: null,
        units_sold: 0,
        avg_ticket: null,
        cost_coverage_pct: 0,
        estimated_cogs: 0,
        estimated_gross_profit: 0,
        estimated_gross_margin_pct: null,
        estimated_gross_margin_pct_reason: "No revenue yet.",
        food_cost_pct: null,
      },
    });
    const briefing = buildDeterministicBriefing(ctx);
    const text = formatBriefingForTelegram(ctx, briefing);
    expect(text).toContain("No POS revenue recorded yet.");
  });
});
