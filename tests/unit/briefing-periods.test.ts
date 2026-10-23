import { describe, it, expect } from "vitest";
import {
  computeBriefingSalesPeriods,
  addDaysToKey,
  formatDayLabel,
  formatRangeLabel,
  type DailySalesPoint,
} from "@/lib/restaurant/briefing-periods";
import {
  buildDeterministicBriefing,
  buildBriefingUserPrompt,
} from "@/lib/restaurant/briefing-prompt";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";

const money = (n: number) => `$${Math.round(n)}`;

// 2026-10-22 is a Thursday.
const NOW_MORNING = new Date("2026-10-23T14:00:00Z"); // 08:00 in Mexico City
const NOW_NEAR_MIDNIGHT = new Date("2026-10-23T03:30:00Z"); // 21:30 on the 22nd there

function day(date: string, net_sales: number, tickets = 10): DailySalesPoint {
  return { date, net_sales, tickets };
}

function allDays(from: string, to: string, amount: number): DailySalesPoint[] {
  const out: DailySalesPoint[] = [];
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) out.push(day(k, amount));
  return out;
}

describe("labels", () => {
  it("formats Spanish weekday + month deterministically", () => {
    expect(formatDayLabel("2026-10-22")).toBe("jue 22 oct");
    expect(formatRangeLabel("2026-10-16", "2026-10-22")).toBe("16–22 oct");
    expect(formatRangeLabel("2026-09-28", "2026-10-04")).toBe("28 sep–4 oct");
  });
});

describe("computeBriefingSalesPeriods", () => {
  it("yesterday vs same weekday last week, and 7d vs previous 7d", () => {
    const daily = [
      ...allDays("2026-10-09", "2026-10-15", 100), // previous 7 days: 700
      ...allDays("2026-10-16", "2026-10-21", 200),
      day("2026-10-15", 100, 10),
      day("2026-10-22", 300, 20), // yesterday (Thursday)
    ];
    // 15 oct is also Thursday: duplicates merge, so fix expectations below.
    const p = computeBriefingSalesPeriods({
      daily,
      now: NOW_MORNING,
      timezone: "America/Mexico_City",
      formatMoney: money,
    });
    expect(p.yesterday_date).toBe("2026-10-22");
    expect(p.yesterday.current.label).toBe("Ayer, jue 22 oct");
    expect(p.yesterday.current.sales).toBe(300);
    expect(p.yesterday.current.orders).toBe(20);
    expect(p.yesterday.current.avg_ticket).toBe(15);
    expect(p.yesterday.previous.label).toBe(
      "Mismo día de la semana pasada, jue 15 oct"
    );
    expect(p.yesterday.previous.sales).toBe(200); // 100 + 100 merged
    expect(p.yesterday.delta_pct).toBe(50);
    expect(p.yesterday.delta_amount).toBe(100);

    expect(p.last_7_days.current.label).toBe("Últimos 7 días (16–22 oct)");
    expect(p.last_7_days.previous.label).toBe("7 días anteriores (9–15 oct)");
    expect(p.last_7_days.current.sales).toBe(200 * 6 + 300);
    expect(p.last_7_days.previous.sales).toBe(100 * 6 + 200);
    expect(
      p.facts.some((f) =>
        f.startsWith(
          "Últimos 7 días (16–22 oct) vs 7 días anteriores (9–15 oct):"
        )
      )
    ).toBe(true);
  });

  it("uses the company's local day near midnight, not UTC", () => {
    const daily = [day("2026-10-21", 400), day("2026-10-14", 200)];
    const mx = computeBriefingSalesPeriods({
      daily,
      now: NOW_NEAR_MIDNIGHT,
      timezone: "America/Mexico_City",
      formatMoney: money,
    });
    expect(mx.yesterday_date).toBe("2026-10-21");
    expect(mx.yesterday.current.label).toBe("Ayer, mié 21 oct");
    expect(mx.yesterday.delta_pct).toBe(100);
    const utc = computeBriefingSalesPeriods({
      daily,
      now: NOW_NEAR_MIDNIGHT,
      timezone: "UTC",
      formatMoney: money,
    });
    expect(utc.yesterday_date).toBe("2026-10-22");
  });

  it("never invents 0% or $0 when the comparison has no data", () => {
    const p = computeBriefingSalesPeriods({
      daily: [day("2026-10-22", 300)],
      now: NOW_MORNING,
      timezone: "America/Mexico_City",
      formatMoney: money,
    });
    expect(p.yesterday.delta_pct).toBeNull();
    expect(p.last_7_days.delta_pct).toBeNull();
    const text = p.facts.join("\n");
    expect(text).toContain("Sin datos para comparar");
    expect(text).not.toContain("0.0%");
    expect(text).not.toMatch(/\$0(\D|$)/);
  });

  it("says there are no synced sales when yesterday has no rows", () => {
    const p = computeBriefingSalesPeriods({
      daily: [day("2026-10-20", 300)],
      now: NOW_MORNING,
      timezone: "America/Mexico_City",
      formatMoney: money,
    });
    expect(p.yesterday.current.sales).toBeNull();
    expect(p.facts[0]).toBe(
      "Ayer, jue 22 oct: No hay ventas sincronizadas para ayer"
    );
  });
});

function ctxFixture(daily: DailySalesPoint[]): BriefingContext {
  const sp = computeBriefingSalesPeriods({
    daily,
    now: NOW_MORNING,
    timezone: "America/Mexico_City",
    formatMoney: money,
  });
  return {
    restaurant_name: "Casa Prueba",
    preferred_language: "es",
    period_label: "todos los datos de POS cargados (lun 1 sep a jue 22 oct)",
    sales_periods: sp,
    currency: "USD",
    kpis: {
      revenue: 99999,
      orders: 999,
      units_sold: 5,
      avg_ticket: 100,
      cost_coverage_pct: 72,
      estimated_cogs: 1,
      estimated_gross_profit: 1,
      estimated_gross_margin_pct: 64,
      food_cost_pct: 36,
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

describe("briefing surfaces use the labelled periods", () => {
  const daily = [
    ...allDays("2026-10-09", "2026-10-15", 100),
    ...allDays("2026-10-16", "2026-10-22", 200),
  ];

  it("AI prompt carries the labelled facts and the quote-only rule", () => {
    const prompt = buildBriefingUserPrompt(ctxFixture(daily));
    expect(prompt).toContain("Ayer, jue 22 oct");
    expect(prompt).toContain("Últimos 7 días (16–22 oct)");
    expect(prompt).toContain("7 días anteriores (9–15 oct)");
  });

  it("deterministic fallback uses the same labels and states the cost period", () => {
    const b = buildDeterministicBriefing(ctxFixture(daily));
    expect(b.headline).toContain("Ayer, jue 22 oct");
    expect(b.summary).toContain("Últimos 7 días (16–22 oct)");
    expect(b.summary).toContain("El margen y el costo de alimentos cubren");
    // coverage is not a headline number: it lives in «Para tu equipo»
    expect(b.summary).not.toContain("cobertura");
    expect(b.headline).not.toContain("cobertura");
    expect(b.summary).not.toContain("99999");
  });

  it("fallback says no synced sales for yesterday", () => {
    const b = buildDeterministicBriefing(ctxFixture([day("2026-10-20", 300)]));
    expect(b.headline).toContain("No hay ventas sincronizadas para ayer");
  });

  it("email shows the dated labels in html and text", () => {
    const out = renderBriefingEmail(
      ctxFixture(daily),
      buildDeterministicBriefing(ctxFixture(daily)),
      "https://example.test"
    );
    for (const body of [out.html, out.text]) {
      expect(body).toContain("Ayer, jue 22 oct");
      expect(body).toContain("Últimos 7 días (16–22 oct)");
    }
  });

  it("email with no comparison data says Sin datos para comparar", () => {
    const c = ctxFixture([day("2026-10-22", 300)]);
    const out = renderBriefingEmail(
      c,
      buildDeterministicBriefing(c),
      "https://example.test"
    );
    expect(out.html).toContain("Sin datos para comparar");
    expect(out.text).toContain("Sin datos para comparar");
  });
});
