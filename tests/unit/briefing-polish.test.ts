// Briefing polish: «Revisar precio» above +100%, null instead of 0, the
// Telegram line, coverage moved to «Para tu equipo», no old all-time cards.
// Invented data only.
import { describe, expect, it } from "vitest";
import {
  evaluateIngredientPriceTrend,
  PRICE_TREND_REVIEW_INCREASE_PCT,
  type TrendCostEntry,
} from "@/lib/restaurant/price-trends";
import { computeBriefingSalesPeriods } from "@/lib/restaurant/briefing-periods";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import { buildDeterministicBriefing } from "@/lib/restaurant/briefing-prompt";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";

const entry = (
  cost_date: string,
  created_at: string,
  cost: number,
  unit = "oz"
): TrendCostEntry => ({
  cost_date,
  created_at,
  normalized_unit: unit,
  normalized_unit_cost: cost,
  currency: "USD",
  supplier_id: null,
});

describe("price changes above +100% are «Revisar precio», whatever the price size", () => {
  it("USD 0.13 → 0.55 per oz (+323%) is a review, not an alert", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.13),
      entry("2026-10-22", "2026-10-22T09:00:00Z", 0.55),
    ]);
    expect(r.kind).toBe("review");
  });

  it("a big price too: 10 → 25 (+150%) is a review", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 10),
      entry("2026-10-22", "2026-10-22T09:00:00Z", 25),
    ]);
    expect(r.kind).toBe("review");
  });

  it("up to +100% keeps the normal alert (exactly +100% is still an alert)", () => {
    expect(PRICE_TREND_REVIEW_INCREASE_PCT).toBe(100);
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 10),
      entry("2026-10-22", "2026-10-22T09:00:00Z", 20),
    ]);
    expect(r.kind).toBe("alert");
    const small = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 1),
      entry("2026-10-22", "2026-10-22T09:00:00Z", 1.5),
    ]);
    expect(small.kind).toBe("alert");
  });

  it("a big DROP is still a normal move, never a review", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 10),
      entry("2026-10-22", "2026-10-22T09:00:00Z", 2),
    ]);
    expect(r.kind).toBe("alert");
  });

  it("still one final price per day: a same-day correction never reaches the review", () => {
    const r = evaluateIngredientPriceTrend([
      entry("2026-10-20", "2026-10-20T09:00:00Z", 0.13),
      entry("2026-10-22", "2026-10-22T08:00:00Z", 0.9),
      entry("2026-10-22", "2026-10-22T12:00:00Z", 0.14),
    ]);
    expect(r.kind).toBe("alert");
    if (r.kind === "alert") expect(r.latest.normalized_unit_cost).toBe(0.14);
  });
});

function ctx(over: Partial<BriefingContext> = {}): BriefingContext {
  const daily = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(9 + i).padStart(2, "0")}`,
    net_sales: 1000 + i * 10,
    tickets: 20,
  }));
  return {
    restaurant_name: "Restaurante Ejemplo",
    preferred_language: "es",
    period_label: "todos los datos de POS cargados",
    sales_periods: computeBriefingSalesPeriods({
      daily,
      now: new Date("2026-10-23T15:00:00Z"),
      timezone: "America/El_Salvador",
      lang: "es",
      formatMoney: (n) => `$${Math.round(n)}`,
    }),
    currency: "USD",
    kpis: {
      revenue: 99999,
      orders: 999,
      units_sold: 400,
      avg_ticket: 111,
      cost_coverage_pct: 72,
      estimated_cogs: 15000,
      estimated_gross_profit: 20000,
      estimated_gross_margin_pct: 64,
      food_cost_pct: 36,
    },
    top_revenue_items: [],
    low_margin_items: [],
    high_food_cost_items: [],
    high_revenue_missing_recipe: [],
    costing_blockers: [],
    supplier_price_increases: [
      {
        ingredient_id: "i1",
        ingredient_name: "TOMATE",
        supplier_name: null,
        previous_cost: 1,
        latest_cost: 1.5,
        pct_change: 50,
        unit: "lb",
        latest_date: "2026-10-22",
      },
    ],
    price_review_items: [
      {
        ingredient_id: "i2",
        ingredient_name: "AGUACATE",
        previous_cost: 0.13,
        latest_cost: 0.55,
        unit: "oz",
        latest_date: "2026-10-22",
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
      pos_rows_reviewed: 10,
    },
    ...over,
  };
}

const APP = "https://app.example.test";
const render = (c: BriefingContext) =>
  renderBriefingEmail(c, buildDeterministicBriefing(c), APP);
const flat = (s: string) => s.replace(/\u00a0/g, " ");

describe("«Revisar precio» section", () => {
  const { html, text } = render(ctx());
  const h = flat(html);

  it("lists the change neutrally, with no percentage and no red arrow", () => {
    expect(h).toContain("Revisar precio");
    expect(h).toContain(
      "AGUACATE: el precio cambió de USD 0.13 a USD 0.55 por oz. ¿Es correcto?"
    );
    const review = h.slice(h.indexOf("Revisar precio"));
    const block = review.slice(
      0,
      review.indexOf("Para tu equipo") > 0
        ? review.indexOf("Para tu equipo")
        : 1200
    );
    const words = block.replace(/<[^>]*>/g, " ");
    expect(words).not.toMatch(/\d\s*%/);
    expect(block).not.toContain("▲");
    expect(flat(text)).toContain(
      "AGUACATE: el precio cambió de USD 0.13 a USD 0.55 por oz. ¿Es correcto?"
    );
  });

  it("an increase up to +100% keeps the normal alert", () => {
    expect(h).toContain("▲ 50%");
    expect(h).toContain("TOMATE");
  });

  it("the briefing summary and risks never present the review as an increase", () => {
    const b = buildDeterministicBriefing(ctx());
    const all = [b.headline, b.summary, ...b.top_risks].join(" ");
    expect(all).not.toMatch(/AGUACATE[^.]*subió/);
  });
});

describe("«Abrir Milton» and the Telegram line", () => {
  const LINE =
    "Para preguntas rápidas desde el teléfono, escríbele a Milton por Telegram.";

  it("keeps the label «Abrir Milton»; the Telegram line shows only when connected", () => {
    const on = render(ctx({ telegram_connected: true }));
    const off = render(ctx({ telegram_connected: false }));
    const unknown = render(ctx());
    expect(on.html).toContain("Abrir Milton");
    expect(on.html).toContain(LINE);
    expect(on.text).toContain(LINE);
    for (const r of [off, unknown]) {
      expect(r.html).toContain("Abrir Milton");
      expect(r.html).not.toContain(LINE);
      expect(r.text).not.toContain(LINE);
    }
  });

  it("the line sits right under the button, in small gray text", () => {
    const { html } = render(ctx({ telegram_connected: true }));
    const at = html.indexOf("Abrir Milton");
    expect(html.indexOf("Para preguntas rápidas")).toBeGreaterThan(at);
    expect(html).toMatch(
      /font-size:12px;color:#6b7280[^>]*>Para preguntas rápidas/
    );
  });
});

describe("cost coverage moves out of the top", () => {
  const { html, text } = render(ctx());
  const h = flat(html);

  it("the margin card says «basado en X% de las ventas con costo»", () => {
    expect(h).toContain("basado en 72% de las ventas con costo");
  });

  it("the headline and summary do not mention coverage", () => {
    const b = buildDeterministicBriefing(ctx());
    expect(b.headline.toLowerCase()).not.toContain("cobertura");
    expect(b.summary.toLowerCase()).not.toContain("cobertura");
  });

  it("the coverage bar is in «Para tu equipo», after Desempeño and just above Atención", () => {
    const c = ctx();
    const withRisk = renderBriefingEmail(
      c,
      { ...buildDeterministicBriefing(c), top_risks: ["Revisa el menú."] },
      APP
    );
    const hh = flat(withRisk.html);
    const desemp = hh.indexOf("Desempeño");
    const team = hh.indexOf("Para tu equipo");
    const atencion = hh.indexOf("Atención");
    expect(desemp).toBeGreaterThan(-1);
    expect(team).toBeGreaterThan(desemp);
    expect(atencion).toBeGreaterThan(team);
    const desempBlock = hh.slice(desemp, team);
    expect(desempBlock).not.toContain("Cobertura de costo");
    expect(hh.slice(team, atencion)).toContain("Cobertura de costo");
    expect(hh.slice(team, atencion)).toContain("72%");
    expect(flat(withRisk.text).indexOf("PARA TU EQUIPO")).toBeLessThan(
      flat(withRisk.text).indexOf("ATENCIÓN")
    );
  });
});

describe("when the dated periods fail to build", () => {
  it("shows «Sin datos para comparar», never the old all-time cards", () => {
    const c = ctx({ sales_periods: undefined });
    const { html, text } = render(c);
    expect(html).toContain("Sin datos para comparar");
    expect(text).toContain("Sin datos para comparar");
    for (const old of [
      "99999",
      "99,999",
      "999",
      "Ticket promedio",
      "Órdenes",
    ]) {
      expect(html, old).not.toContain(old);
    }
    const b = buildDeterministicBriefing(c);
    expect(b.summary).toContain("Sin datos para comparar");
  });
});
