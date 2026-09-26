import { describe, it, expect } from "vitest";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import { buildDeterministicBriefing } from "@/lib/restaurant/briefing-prompt";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// Email Briefing Extension v1 — proves the email formatter reuses the SAME
// BriefingContext/BriefingOutput as the dashboard and Telegram (no second
// briefing engine), escapes dynamic HTML content, degrades gracefully for
// missing KPIs, and never fabricates a period or a historical comparison.

const APP_URL = "https://app.example.com";

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

describe("renderBriefingEmail — English (scenario 1)", () => {
  const ctx = fixture("en");
  const briefing = buildDeterministicBriefing(ctx);
  const { subject, html, text } = renderBriefingEmail(ctx, briefing, APP_URL);

  it("produces an English subject and heading", () => {
    expect(subject).toContain("Pinche Gringo BBQ");
    expect(html).toContain("Here&#39;s your latest Milton briefing");
    expect(text).toContain("Here's your latest Milton briefing");
  });

  it("includes English KPI labels", () => {
    expect(html).toContain("Sales");
    expect(html).toContain("Orders");
    expect(html).toContain("Gross margin");
  });

  it("never emits Spanish labels", () => {
    expect(html).not.toContain("Ventas");
    expect(html).not.toContain("Márgen bruto");
  });

  it("is valid-looking HTML with a DOCTYPE and a CTA link", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(`href="${APP_URL}/dashboard/restaurant/briefing"`);
    expect(html).toContain("Open Milton");
  });

  it("provides a non-empty plain-text fallback distinct from the HTML", () => {
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain("<html");
  });
});

describe("renderBriefingEmail — compact 2x2 KPI grid (adjustment)", () => {
  it("puts Sales+Orders in the first row and Avg ticket+Gross margin in the second", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);

    // kpiGrid() concatenates two complete "<tr>...</tr>" row strings with
    // no separator, so a literal "</tr><tr>" substring can only occur at
    // the boundary between the grid's two outer rows (every card's own
    // inner single-cell table produces exactly one inner <tr>, never two
    // adjacent closing/opening tags) — a reliable marker without needing
    // to parse the nested table structure.
    const rowBreak = html.indexOf("</tr><tr>");
    expect(rowBreak).toBeGreaterThan(-1);

    const row1 = html.slice(0, rowBreak);
    // A generous fixed window rather than trying to locate the exact
    // outer-row close (the first "</tr>" after this point is actually
    // Avg ticket's own INNER card table closing, not the outer row) —
    // the KPI grid section is far smaller than this, so both row-2 cards
    // are safely inside it.
    const row2 = html.slice(rowBreak, rowBreak + 3000);

    expect(row1).toContain("Sales");
    expect(row1).toContain("Orders");
    expect(row1).not.toContain("Avg ticket");

    expect(row2).toContain("Avg ticket");
    expect(row2).toContain("Gross margin");
    expect(row2).not.toContain(">Sales<");
  });

  it("includes a conservative media-query fallback for narrow/mobile clients", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toContain("@media only screen and (max-width: 480px)");
    expect(html).toMatch(/\.kpi-cell\s*\{\s*display:\s*block\s*!important/);
  });

  it("KPI cards use percentage widths, not CSS grid/flexbox", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toContain('width="50%"');
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });
});

describe("renderBriefingEmail — Spanish (scenario 2)", () => {
  const ctx = fixture("es");
  const briefing = buildDeterministicBriefing(ctx);
  const { subject, html, text } = renderBriefingEmail(ctx, briefing, APP_URL);

  it("produces a Spanish subject and heading", () => {
    expect(subject).toContain("Tu briefing de Milton");
    expect(html).toContain("Aquí tienes tu último briefing de Milton");
    expect(text).toContain("Aquí tienes tu último briefing de Milton");
  });

  it("includes Spanish KPI labels", () => {
    expect(html).toContain("Ventas");
    expect(html).toContain("Órdenes");
    expect(html).toContain("Margen bruto");
  });

  it("never silently reverts to English labels", () => {
    expect(html).not.toContain(">Sales<");
    expect(html).not.toContain(">Orders<");
  });
});

describe("renderBriefingEmail — proper nouns unchanged (scenario 3)", () => {
  it("preserves restaurant, dish, ingredient, and supplier names in both languages", () => {
    for (const lang of ["en", "es"] as PreferredLanguage[]) {
      const ctx = fixture(lang);
      const briefing = buildDeterministicBriefing(ctx);
      const { html, text } = renderBriefingEmail(ctx, briefing, APP_URL);
      expect(html).toContain("Pinche Gringo BBQ");
      expect(text).toContain("Pinche Gringo BBQ");
      // Brisket price increase must appear in the visual section.
      expect(html).toContain("Brisket");
    }
  });
});

describe("renderBriefingEmail — HTML escaping (security)", () => {
  it("escapes HTML-significant characters in dynamic content", () => {
    const ctx = fixture("en", {
      restaurant_name: `Taco's & <Grill> "House"`,
    });
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).not.toContain("<Grill>");
    expect(html).toContain("&lt;Grill&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;House&quot;");
  });

  it("escapes a menu item name containing HTML special characters appearing in a risk", () => {
    const ctx = fixture("en", {
      low_margin_items: [
        {
          menu_item_id: "x",
          name: `<script>alert(1)</script>`,
          revenue: 100,
          gross_margin_pct: 10,
          food_cost_pct: 80,
        },
      ],
    });
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderBriefingEmail — missing KPI graceful rendering", () => {
  it("shows a placeholder and the reason when orders/avg_ticket/margin are null", () => {
    const ctx = fixture("en", {
      kpis: {
        revenue: 5000,
        orders: null,
        orders_reason: "POS rows have no check_id (summary export).",
        units_sold: 100,
        avg_ticket: null,
        avg_ticket_reason: "avg_ticket requires order count.",
        cost_coverage_pct: 40,
        estimated_cogs: 1000,
        estimated_gross_profit: 4000,
        estimated_gross_margin_pct: null,
        estimated_gross_margin_pct_reason:
          "No revenue with complete cost coverage.",
        food_cost_pct: null,
      },
    });
    const briefing = buildDeterministicBriefing(ctx);
    const { html, text } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toContain("POS rows have no check_id");
    expect(html).toContain("No revenue with complete cost coverage");
    expect(text).toContain("—"); // placeholder in the plain-text KPI lines
  });

  it("never throws and shows a simplified body when there is no revenue at all", () => {
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
        food_cost_pct: null,
      },
      supplier_price_increases: [],
    });
    const briefing = buildDeterministicBriefing(ctx);
    expect(() => renderBriefingEmail(ctx, briefing, APP_URL)).not.toThrow();
    const { html, text } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toMatch(/No POS revenue is loaded yet/);
    expect(text).toMatch(/No POS revenue is loaded yet/);
    // No fabricated KPI cards in the zero-revenue body.
    expect(html).not.toContain("Gross margin");
  });
});

describe("renderBriefingEmail — period wording (never fabricated)", () => {
  it("states the actual period_label verbatim rather than assuming a time of day", () => {
    const ctx = fixture("en", { period_label: "Jan 1 – Jan 7, 2026" });
    const briefing = buildDeterministicBriefing(ctx);
    const { html, text } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toContain("Jan 1 – Jan 7, 2026");
    expect(text).toContain("Jan 1 – Jan 7, 2026");
    expect(html.toLowerCase()).not.toContain("good morning");
    expect(html.toLowerCase()).not.toContain("yesterday");
  });
});

describe("renderBriefingEmail — no fabricated historical comparison", () => {
  it("never renders a revenue/margin trend chart when the context has no prior-period series", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    // Only the real supplier price comparison (previous_cost -> latest_cost)
    // should ever appear as a "trend" — never an invented vs-last-week claim.
    expect(html).not.toMatch(/vs\.? last week/i);
    expect(html).not.toMatch(/vs\.? yesterday/i);
  });

  it("shows the cost-coverage gauge and real supplier price trend when present", () => {
    const ctx = fixture("en");
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).toContain("Cost coverage");
    expect(html).toContain("▲ 20%");
  });

  it("omits the performance section entirely when there is nothing real to show", () => {
    const ctx = fixture("en", {
      kpis: {
        revenue: 5000,
        orders: 10,
        units_sold: 10,
        avg_ticket: 500,
        cost_coverage_pct: 0,
        estimated_cogs: 0,
        estimated_gross_profit: 5000,
        estimated_gross_margin_pct: null,
        estimated_gross_margin_pct_reason: "No cost data yet.",
        food_cost_pct: null,
      },
      supplier_price_increases: [],
    });
    const briefing = buildDeterministicBriefing(ctx);
    const { html } = renderBriefingEmail(ctx, briefing, APP_URL);
    expect(html).not.toContain("Cost coverage");
  });
});
