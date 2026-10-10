import {
  buildSalesSnapshot,
  weekdayFromDateKey,
  type SalesFactRow,
} from "@/lib/restaurant/ask-milton-sales";
import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";

export const ES_TZ = "America/El_Salvador";

export function salesFact(
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

function july2026DateKeys(): string[] {
  return Array.from(
    { length: 31 },
    (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`
  );
}

function dayFacts(
  date: string,
  revenue: number,
  orders: number,
  extra: Partial<SalesFactRow> = {}
): SalesFactRow[] {
  return Array.from({ length: orders }, (_, i) =>
    salesFact({
      sale_date: date,
      order_placed_at: null,
      revenue: i === 0 ? revenue : 0,
      quantity: 1,
      order_key: `${date}-${i}`,
      ...extra,
    })
  );
}

/** July 2026: 5 Wed/Thu/Fri, 4 of every other weekday. Thursday has the
 *  highest per-day average; Friday 17 is the single best date. */
export function july2026UnevenRows(): SalesFactRow[] {
  return july2026DateKeys().flatMap((date) => {
    const weekday = weekdayFromDateKey(date);
    if (date === "2026-07-17") return dayFacts(date, 9000, 200);
    if (weekday === 4) return dayFacts(date, 5846, 135);
    if (weekday === 6) return dayFacts(date, 5000, 100);
    if (weekday === 5) return dayFacts(date, 3000, 70);
    return dayFacts(date, 4000, 80);
  });
}

/** Thursday total beats Saturday, but Saturday's per-day average is higher. */
export function july2026AverageBeatsTotalRows(): SalesFactRow[] {
  return july2026DateKeys().flatMap((date) => {
    const weekday = weekdayFromDateKey(date);
    if (weekday === 4) return dayFacts(date, 5846, 10);
    if (weekday === 6) return dayFacts(date, 7000, 10);
    return dayFacts(date, 1000, 5);
  });
}

export function salesContext(
  rows: SalesFactRow[] = [
    salesFact({
      sale_date: "2026-07-03",
      order_placed_at: "2026-07-04T04:30:00.000Z",
      item_name: "Pupusa de queso",
      quantity: 20,
      revenue: 80,
      order_key: "a",
    }),
  ],
  lang: "es" | "en" = "es"
): AskMiltonContext {
  const briefing = {
    restaurant_name: "Los Ranchos",
    preferred_language: lang,
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

  const sales = buildSalesSnapshot(rows, ES_TZ, {
    question: "julio",
  });

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
