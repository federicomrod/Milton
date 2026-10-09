import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRealRestaurantDashboardData } from "@/lib/restaurant/supabase-sales";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";
import { fetchMenuRecipesData } from "@/lib/restaurant/menu-recipes-server";
import { buildAskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import {
  createCappedSupabase,
  type MockRow,
  type PageErrorSpec,
} from "./helpers/capped-supabase";
import { POSTGREST_MAX_ROWS } from "@/lib/restaurant/paginated-read";

const COMPANY_ID = "co-1";
const USER_ID = "user-1";
const LOC_A = "loc-a";
const LOC_B = "loc-b";
const ROW_REVENUE = 10;
const TOTAL_ROWS = 2_500;
const ROWS_A = 1_500;
const ROWS_B = TOTAL_ROWS - ROWS_A;

function posRow(i: number): MockRow {
  const location_id = i < ROWS_A ? LOC_A : LOC_B;
  return {
    id: `pos-${String(i).padStart(5, "0")}`,
    company_id: COMPANY_ID,
    location_id,
    menu_item_id: null,
    sale_date: "2026-07-15",
    order_id: `ord-${i}`,
    check_id: `chk-${i}`,
    raw_item_name: location_id === LOC_A ? "Ranchos Dish" : "Lavara Dish",
    quantity: 1,
    gross_revenue: ROW_REVENUE,
    net_revenue: ROW_REVENUE,
    currency: "USD",
    sales_channel: "in_store",
    payment_type: "card",
    category: "mains",
    sub_category: null,
  };
}

function makeClient(
  extraTables: Record<string, MockRow[]> = {},
  pageErrors: PageErrorSpec[] = []
) {
  const supabase = createCappedSupabase({
    maxRowsPerRequest: POSTGREST_MAX_ROWS,
    userId: USER_ID,
    pageErrors,
    tables: {
      companies: [
        {
          id: COMPANY_ID,
          created_by: USER_ID,
          name: "Test Co",
          preferred_language: "en",
        },
      ],
      pos_sales_items: Array.from({ length: TOTAL_ROWS }, (_, i) => posRow(i)),
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
      supplier_ingredients: [],
      supplier_invoices: [],
      agent_runs: [],
      agent_actions: [],
      agent_recommendations: [],
      restaurant_brands: [],
      restaurant_locations: [],
      ...extraTables,
    },
  });
  return supabase as unknown as SupabaseClient;
}

describe("fetchRealRestaurantDashboardData — PostgREST 1,000-row cap", () => {
  it("sums every in-scope POS row even when each request returns at most 1,000", async () => {
    const data = await fetchRealRestaurantDashboardData(makeClient());
    expect(data.mode).toBe("live");
    if (data.mode !== "live") return;
    expect(data.rowCount).toBe(TOTAL_ROWS);
    expect(data.truncated).toBe(false);
    expect(data.overview.total_revenue).toBe(TOTAL_ROWS * ROW_REVENUE);
    expect(data.overview.total_orders).toBe(TOTAL_ROWS);
    expect(data.explorerRows).toHaveLength(TOTAL_ROWS);
    const ranchos = data.dishSales.find((d) => d.item_name === "Ranchos Dish");
    const lavara = data.dishSales.find((d) => d.item_name === "Lavara Dish");
    expect(ranchos?.revenue).toBe(ROWS_A * ROW_REVENUE);
    expect(lavara?.revenue).toBe(ROWS_B * ROW_REVENUE);
  });

  it("location scoping still applies — Restaurant A excludes B's rows", async () => {
    const data = await fetchRealRestaurantDashboardData(makeClient(), LOC_A);
    expect(data.mode).toBe("live");
    if (data.mode !== "live") return;
    expect(data.rowCount).toBe(ROWS_A);
    expect(data.overview.total_revenue).toBe(ROWS_A * ROW_REVENUE);
    expect(data.dishSales.some((d) => d.item_name === "Lavara Dish")).toBe(
      false
    );
    expect(data.explorerRows.every((r) => r.item_name === "Ranchos Dish")).toBe(
      true
    );
  });

  it("location scoping still applies — Restaurant B excludes A's rows", async () => {
    const data = await fetchRealRestaurantDashboardData(makeClient(), LOC_B);
    expect(data.mode).toBe("live");
    if (data.mode !== "live") return;
    expect(data.rowCount).toBe(ROWS_B);
    expect(data.overview.total_revenue).toBe(ROWS_B * ROW_REVENUE);
    expect(data.dishSales.map((d) => d.item_name)).toEqual(["Lavara Dish"]);
  });
});

describe("fetchProfitabilityData — PostgREST 1,000-row cap", () => {
  it("revenue_total includes every POS row under a 1,000-row response cap", async () => {
    const data = await fetchProfitabilityData(makeClient(), COMPANY_ID);
    expect(data.kpis.revenue_total).toBe(TOTAL_ROWS * ROW_REVENUE);
    expect(data.setupCounts.pos_sales_count).toBe(TOTAL_ROWS);
    expect(data.truncated).toBe(false);
    expect(data.readError).toBe(false);
  });

  it("location scoping still applies to profitability revenue", async () => {
    const a = await fetchProfitabilityData(makeClient(), COMPANY_ID, {
      locationId: LOC_A,
      brandId: "brand-a",
    });
    const b = await fetchProfitabilityData(makeClient(), COMPANY_ID, {
      locationId: LOC_B,
      brandId: "brand-b",
    });
    expect(a.kpis.revenue_total).toBe(ROWS_A * ROW_REVENUE);
    expect(b.kpis.revenue_total).toBe(ROWS_B * ROW_REVENUE);
    expect(a.setupCounts.pos_sales_count).toBe(ROWS_A);
    expect(b.setupCounts.pos_sales_count).toBe(ROWS_B);
  });

  it("a failed POS page does not become a smaller revenue_total", async () => {
    const data = await fetchProfitabilityData(
      makeClient({}, [
        {
          table: "pos_sales_items",
          from: POSTGREST_MAX_ROWS,
          message: "pos page 2 failed",
        },
      ]),
      COMPANY_ID
    );
    expect(data.readError).toBe(true);
    expect(data.kpis.revenue_total).toBe(0);
    expect(data.setupCounts.pos_sales_count).toBe(0);
    expect(data.truncated).toBe(false);
  });
});

describe("fetchMenuRecipesData — failed page is not a partial unmatched list", () => {
  it("surfaces the error instead of using the first 1,000 POS rows", async () => {
    const data = await fetchMenuRecipesData(
      makeClient({}, [
        {
          table: "pos_sales_items",
          from: POSTGREST_MAX_ROWS,
          message: "pos page 2 failed",
        },
      ]),
      COMPANY_ID
    );
    expect(data.readError).toBe(true);
    expect(data.unmatched).toEqual([]);
    expect(data.summary.unmatched_pos_count).toBe(0);
  });
});

describe("buildAskMiltonContext — failed page is not a partial cost snapshot", () => {
  it("surfaces the error instead of using the first 1,000 cost entries", async () => {
    const ingredients = Array.from({ length: 5 }, (_, i) => ({
      id: `ing-${i}`,
      company_id: COMPANY_ID,
      name: `Ingredient ${i}`,
      category: "produce",
      default_unit: "kg",
      current_unit_cost: null,
      currency: "USD",
      supplier_id: null,
    }));
    const costEntries = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
      id: `ce-${String(i).padStart(5, "0")}`,
      company_id: COMPANY_ID,
      ingredient_id: ingredients[i % ingredients.length].id,
      supplier_id: null,
      source_type: "manual",
      source_id: null,
      cost_date: "2026-07-01",
      created_at: `2026-07-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      quantity: 1,
      unit: "kg",
      total_cost: 50,
      unit_cost: 50,
      normalized_unit: "kg",
      normalized_unit_cost: 50,
      currency: "USD",
      notes: null,
    }));
    const ctx = await buildAskMiltonContext(
      makeClient({ ingredients, ingredient_cost_entries: costEntries }, [
        {
          table: "ingredient_cost_entries",
          from: POSTGREST_MAX_ROWS,
          message: "cost entries page 2 failed",
        },
      ]),
      COMPANY_ID
    );
    expect(ctx.read_errors).toContain("ingredient_cost_entries");
    expect(ctx.expensive_ingredients).toEqual([]);
  });
});

describe("fetchRealRestaurantDashboardData — failed page is sample, not a live partial", () => {
  it("falls back to sample mode when a POS page fails", async () => {
    const data = await fetchRealRestaurantDashboardData(
      makeClient({}, [
        {
          table: "pos_sales_items",
          from: POSTGREST_MAX_ROWS,
          message: "pos page 2 failed",
        },
      ])
    );
    expect(data.mode).toBe("sample");
    if (data.mode !== "sample") return;
    expect(data.reason).toBe("supabase_error");
  });
});
