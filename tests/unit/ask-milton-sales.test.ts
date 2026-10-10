import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSalesSnapshot,
  emptySalesSnapshot,
  localWeekdayAndHour,
  matchCategoryFromQuestion,
  resolveSalesPeriod,
  salesSnapshotJsonSize,
  SALES_SNAPSHOT_MAX_JSON_CHARS,
  weekdayFromDateKey,
  type SalesFactRow,
} from "@/lib/restaurant/ask-milton-sales";
import { buildAskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import {
  buildDeterministicAnswer,
  detectIntent,
} from "@/lib/restaurant/ask-milton-prompt";
import { createCappedSupabase, type MockRow } from "./helpers/capped-supabase";
import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";

const ES = "America/El_Salvador";

function fact(
  partial: Partial<SalesFactRow> & Pick<SalesFactRow, "sale_date">
): SalesFactRow {
  return {
    order_placed_at: null,
    item_name: "Pupusa",
    quantity: 1,
    revenue: 10,
    order_key: "ord-1",
    sales_channel: "in_store",
    payment_type: "card",
    category: "Desayunos",
    currency: "USD",
    ...partial,
  };
}

describe("localWeekdayAndHour — restaurant timezone, not UTC", () => {
  it("maps a UTC Saturday morning to Friday evening in America/El_Salvador", () => {
    // 2026-07-04 04:30 UTC = 2026-07-03 22:30 in El Salvador (UTC-6)
    const local = localWeekdayAndHour(
      {
        sale_date: "2026-07-03",
        order_placed_at: "2026-07-04T04:30:00.000Z",
      },
      ES
    );
    expect(local.weekday).toBe(5); // Friday
    expect(local.hour).toBe(22);
    expect(local.dateKey).toBe("2026-07-03");
  });

  it("UTC of the same instant is Saturday morning — the bug this guards against", () => {
    const utc = localWeekdayAndHour(
      {
        sale_date: "2026-07-03",
        order_placed_at: "2026-07-04T04:30:00.000Z",
      },
      "UTC"
    );
    expect(utc.weekday).toBe(6); // Saturday
    expect(utc.hour).toBe(4);
  });

  it("falls back to the local sale_date calendar weekday when no timestamp", () => {
    const local = localWeekdayAndHour(
      { sale_date: "2026-07-03", order_placed_at: null },
      ES
    );
    expect(local.weekday).toBe(weekdayFromDateKey("2026-07-03"));
    expect(local.weekday).toBe(5); // Friday
    expect(local.hour).toBeNull();
  });
});

describe("resolveSalesPeriod", () => {
  const julyDates = ["2026-07-01", "2026-07-15", "2026-07-31"];

  it("defaults to the calendar month of the latest sale (July data in October)", () => {
    const period = resolveSalesPeriod(undefined, julyDates);
    expect(period).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
      source: "latest_month",
    });
  });

  it("honors a named month in the question", () => {
    const period = resolveSalesPeriod(
      "which days do we sell the most breakfast items in July?",
      ["2026-06-01", ...julyDates]
    );
    expect(period).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
      source: "named_period",
    });
  });

  it("honors julio in Spanish", () => {
    const period = resolveSalesPeriod("ventas de julio 2026", julyDates);
    expect(period?.source).toBe("named_period");
    expect(period?.start).toBe("2026-07-01");
  });
});

describe("buildSalesSnapshot", () => {
  const rows: SalesFactRow[] = [
    fact({
      sale_date: "2026-07-03",
      order_placed_at: "2026-07-04T04:30:00.000Z",
      item_name: "Pupusa de queso",
      quantity: 20,
      revenue: 80,
      order_key: "a",
    }),
    fact({
      sale_date: "2026-07-04",
      order_placed_at: "2026-07-04T16:00:00.000Z",
      item_name: "Cafe",
      quantity: 5,
      revenue: 15,
      order_key: "b",
      category: "Bebidas",
    }),
    fact({
      sale_date: "2026-06-15",
      order_placed_at: "2026-06-15T14:00:00.000Z",
      item_name: "Old item",
      quantity: 100,
      revenue: 400,
      order_key: "c",
      category: "Cenas",
    }),
  ];

  it("returns the compact context shape and stays under the JSON size cap", () => {
    const snap = buildSalesSnapshot(rows, ES);
    expect(snap.available).toBe(true);
    expect(snap.period.source).toBe("latest_month");
    expect(snap.period.start).toBe("2026-07-01");
    expect(snap.period.timezone).toBe(ES);
    expect(snap.totals.revenue).toBe(95);
    expect(snap.totals.units).toBe(25);
    expect(snap.by_weekday).toHaveLength(7);
    expect(snap.by_weekday.map((d) => d.key)).toEqual([
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]);
    expect(snap.by_category.map((c) => c.key)).toEqual([
      "Desayunos",
      "Bebidas",
    ]);
    expect(snap.by_channel[0]?.key).toBe("in_store");
    expect(snap.by_payment[0]?.key).toBe("card");
    expect(snap.top_items_by_units[0]?.name).toBe("Pupusa de queso");
    expect(snap.top_items_by_revenue[0]?.name).toBe("Pupusa de queso");
    expect(snap.top_items_by_category[0]?.category).toBe("Desayunos");
    expect(snap.by_category_weekday[0]?.category).toBe("Desayunos");
    expect(Object.keys(snap).sort()).toEqual(
      [
        "available",
        "by_category",
        "by_category_weekday",
        "by_channel",
        "by_hour",
        "by_payment",
        "by_weekday",
        "period",
        "top_items_by_category",
        "top_items_by_revenue",
        "top_items_by_units",
        "totals",
        "unavailable_reason",
      ].sort()
    );
    expect(salesSnapshotJsonSize(snap)).toBeLessThanOrEqual(
      SALES_SNAPSHOT_MAX_JSON_CHARS
    );
  });

  it("attributes breakfast volume to Friday in El Salvador, not UTC Saturday", () => {
    const snap = buildSalesSnapshot(rows, ES);
    const friday = snap.by_weekday.find((d) => d.key === "Friday");
    const saturday = snap.by_weekday.find((d) => d.key === "Saturday");
    expect(friday?.units).toBe(20);
    expect(saturday?.units).toBe(5);
    const breakfastDays = snap.by_category_weekday.find(
      (c) => c.category === "Desayunos"
    );
    expect(breakfastDays?.weekdays.find((d) => d.key === "Friday")?.units).toBe(
      20
    );
    expect(snap.by_hour.find((h) => h.key === "22")?.units).toBe(20);
  });

  it("excludes rows outside the latest month", () => {
    const snap = buildSalesSnapshot(rows, ES);
    expect(snap.top_items_by_units.some((i) => i.name === "Old item")).toBe(
      false
    );
  });
});

describe("matchCategoryFromQuestion", () => {
  it("matches breakfast to Desayunos", () => {
    expect(
      matchCategoryFromQuestion("most breakfast items", [
        "Desayunos",
        "Bebidas",
      ])
    ).toBe("Desayunos");
  });

  it("matches artículos de desayuno to Desayunos", () => {
    expect(
      matchCategoryFromQuestion(
        "¿Cuáles son los artículos de desayuno más vendidos?",
        ["Desayunos"]
      )
    ).toBe("Desayunos");
  });
});

describe("detectIntent — sales questions from issue #95", () => {
  it("routes the weekday breakfast question", () => {
    expect(
      detectIntent("which days do we sell the most breakfast items?")
    ).toBe("best_sales_day");
  });

  it("routes the Spanish top-items question", () => {
    expect(
      detectIntent("¿Cuáles son los artículos de desayuno más vendidos?")
    ).toBe("top_selling_items");
  });
});

describe("buildAskMiltonContext — sales block shape", () => {
  const COMPANY_ID = "co-1";
  const USER_ID = "user-1";
  const LOC = "loc-ranchos";

  function makeClient(posRows: MockRow[]) {
    const supabase = createCappedSupabase({
      userId: USER_ID,
      tables: {
        companies: [
          {
            id: COMPANY_ID,
            created_by: USER_ID,
            name: "Los Ranchos",
            preferred_language: "es",
          },
        ],
        restaurant_pos_connections: [
          {
            id: "conn-1",
            company_id: COMPANY_ID,
            pos_source: "odoo",
            timezone: ES,
            is_active: true,
          },
        ],
        pos_sales_items: posRows,
        pos_item_mappings: [],
        menu_items: [],
        recipes: [],
        menu_recipe_inputs: [],
        prepared_components: [],
        component_recipes: [],
        component_recipe_inputs: [],
        ingredients: [],
        ingredient_cost_entries: [],
        suppliers: [],
        supplier_invoices: [],
        agent_runs: [],
        agent_actions: [],
        agent_recommendations: [],
        restaurant_brands: [],
        restaurant_locations: [
          { id: LOC, name: "Los Ranchos", brand_id: null },
        ],
      },
    });
    return supabase as unknown as SupabaseClient;
  }

  it("puts a sales snapshot on the context, scoped and timezone-aware", async () => {
    const ctx = await buildAskMiltonContext(
      makeClient([
        {
          id: "pos-1",
          company_id: COMPANY_ID,
          location_id: LOC,
          menu_item_id: null,
          sale_date: "2026-07-03",
          order_id: "o1",
          check_id: "c1",
          raw_item_name: "Pupusa",
          quantity: 4,
          gross_revenue: 16,
          net_revenue: 16,
          currency: "USD",
          sales_channel: "in_store",
          payment_type: "cash",
          category: "Desayunos",
          sub_category: null,
          order_placed_at: "2026-07-04T04:30:00.000Z",
        },
      ]),
      COMPANY_ID,
      { locationId: LOC, brandId: null },
      { question: "which days do we sell the most breakfast items?" }
    );

    expect(ctx.sales.available).toBe(true);
    expect(ctx.sales.period.timezone).toBe(ES);
    expect(ctx.sales.by_weekday.find((d) => d.key === "Friday")?.units).toBe(4);
    expect(ctx.sales.by_category[0]?.key).toBe("Desayunos");
    expect(ctx.sales.top_items_by_units[0]?.name).toBe("Pupusa");
    expect(ctx.read_errors).toBeUndefined();
  });
});

describe("buildDeterministicAnswer — sales fallback", () => {
  function salesContext(): AskMiltonContext {
    const briefing = {
      restaurant_name: "Los Ranchos",
      preferred_language: "es" as const,
      period_label: "July 2026",
      currency: "USD",
      kpis: {
        revenue: 100,
        orders: 10,
        units_sold: 20,
        avg_ticket: 10,
        cost_coverage_pct: 40,
        estimated_cogs: 0,
        estimated_gross_profit: 0,
        estimated_gross_margin_pct: null,
        food_cost_pct: null,
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
        pos_rows_reviewed: 1,
      },
    } satisfies BriefingContext;

    const sales = buildSalesSnapshot(
      [
        fact({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-04T04:30:00.000Z",
          item_name: "Pupusa de queso",
          quantity: 20,
          revenue: 80,
          order_key: "a",
        }),
      ],
      ES
    );

    return {
      context_scope: {
        mode: "single_restaurant",
        restaurant_name: "Los Ranchos",
      },
      briefing,
      menu: { most_profitable_items: [], least_profitable_items: [] },
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
      sales,
    };
  }

  const none = { resolved_ingredients: [], resolved_menu_items: [] };

  it("answers the best weekday from the snapshot in Spanish", () => {
    const out = buildDeterministicAnswer(
      salesContext(),
      "which days do we sell the most breakfast items?",
      "best_sales_day",
      none
    );
    expect(out.answer).toMatch(/viernes/i);
    expect(out.answer).toContain("Desayunos");
    expect(out.answer).not.toMatch(/No tengo esos datos/i);
  });

  it("answers top breakfast items from the snapshot in Spanish", () => {
    const out = buildDeterministicAnswer(
      salesContext(),
      "¿Cuáles son los artículos de desayuno más vendidos?",
      "top_selling_items",
      none
    );
    expect(out.answer).toContain("Pupusa de queso");
    expect(out.answer).toMatch(/más vendido/i);
    expect(out.answer).not.toMatch(/No tengo esos datos/i);
  });

  it("does not invent sales when the snapshot is empty", () => {
    const ctx = salesContext();
    ctx.sales = emptySalesSnapshot(ES, "no_sales");
    const out = buildDeterministicAnswer(
      ctx,
      "which days do we sell the most breakfast items?",
      "best_sales_day",
      none
    );
    expect(out.answer).toMatch(/aún no tengo ventas/i);
  });
});
