import { describe, it, expect } from "vitest";
import {
  evaluateIngredientPriceTrend,
  formatUnitPricePair,
  type TrendCostEntry,
} from "@/lib/restaurant/price-trends";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import { buildDeterministicBriefing } from "@/lib/restaurant/briefing-prompt";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";

function entry(
  cost_date: string,
  created_at: string,
  cost: number,
  unit = "g"
): TrendCostEntry {
  return {
    cost_date,
    created_at,
    normalized_unit: unit,
    normalized_unit_cost: cost,
    currency: "USD",
    supplier_id: null,
  };
}

describe("evaluateIngredientPriceTrend", () => {
  it("a same-day correction is not an alert", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.01),
      entry("2026-10-20", "2026-10-20T10:00:00Z", 0.01),
    ]);
    expect(r.kind).toBe("none");
  });

  it("uses only the day's final price when a day was corrected", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-18", "2026-10-18T09:00:00Z", 0.02),
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.5), // wrong, corrected below
      entry("2026-10-20", "2026-10-20T11:00:00Z", 0.02),
    ]);
    expect(r.kind).toBe("none");
  });

  it("a real increase across two days alerts", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-18", "2026-10-18T09:00:00Z", 0.023),
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.03),
    ]);
    expect(r.kind).toBe("alert");
    if (r.kind === "alert") {
      expect(r.pct_change).toBeCloseTo(30.43, 1);
      expect(r.previous.cost_date).toBe("2026-10-18");
    }
  });

  it("a tiny price with a huge jump is skipped for review", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-18", "2026-10-18T09:00:00Z", 0.0023),
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.01),
    ]);
    expect(r.kind).toBe("review");
  });

  it("a negligible absolute change is dropped", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-18", "2026-10-18T09:00:00Z", 0.00001),
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.00002),
    ]);
    expect(r.kind).toBe("none");
  });

  it("does not compare different units", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-18", "2026-10-18T09:00:00Z", 5, "kg"),
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.01, "g"),
    ]);
    expect(r.kind).toBe("none");
  });
});

describe("formatUnitPricePair", () => {
  it("keeps enough decimals to show the change", () => {
    const nb = (x: string) => x.replace(/\u00a0/g, " ");
    const p = formatUnitPricePair(0.0023, 0.01, "USD");
    expect([nb(p.previous), nb(p.latest)]).toEqual([
      "USD 0.0023",
      "USD 0.0100",
    ]);
    expect(nb(formatUnitPricePair(2.5, 3, "USD").latest)).toBe("USD 3.00");
  });
});

describe("email never renders 0 → 0", () => {
  it("shows the decimals of a fractional unit price", () => {
    const ctx = {
      restaurant_name: "Casa Prueba",
      preferred_language: "es",
      period_label: "todos los datos de POS cargados",
      currency: "USD",
      kpis: {
        revenue: 1000,
        orders: 10,
        units_sold: 10,
        avg_ticket: 100,
        cost_coverage_pct: 100,
        estimated_cogs: 1,
        estimated_gross_profit: 1,
        estimated_gross_margin_pct: 60,
        food_cost_pct: 30,
      },
      top_revenue_items: [],
      low_margin_items: [],
      high_food_cost_items: [],
      high_revenue_missing_recipe: [],
      costing_blockers: [],
      supplier_price_increases: [
        {
          ingredient_id: "i1",
          ingredient_name: "Sal de prueba",
          supplier_name: null,
          previous_cost: 0.023,
          latest_cost: 0.03,
          pct_change: 30.4,
          unit: "g",
          latest_date: "2026-10-20",
        },
      ],
      price_review_items: [
        {
          ingredient_id: "i2",
          ingredient_name: "Pimienta de prueba",
          previous_cost: 0.0023,
          latest_cost: 0.01,
          unit: "g",
          latest_date: "2026-10-20",
        },
      ],
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
    } as BriefingContext;
    const out = renderBriefingEmail(
      ctx,
      buildDeterministicBriefing(ctx),
      "https://example.test"
    );
    const html = out.html.replace(/\u00a0/g, " ");
    expect(html).not.toMatch(/USD 0 →/);
    expect(html).toContain("USD 0.023 → USD 0.030");
    expect(html).toContain("Revisar precio");
    expect(html).toContain("USD 0.0023 a USD 0.0100");
    expect(html).not.toMatch(/\+\d+(\.\d+)?%/);
  });
});
