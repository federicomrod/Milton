import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currencyMismatchReason,
  FALLBACK_CURRENCY,
  majorityCurrency,
  normalizeCurrency,
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";
import { currencyForCountry } from "@/lib/restaurant/onboarding-copy";
import { normalizeCostImportRow } from "@/lib/restaurant/cost-import";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";
import { fetchMenuRecipesData } from "@/lib/restaurant/menu-recipes-server";
import { createCappedSupabase, type MockRow } from "./helpers/capped-supabase";

const COMPANY_ID = "co-usd";

function makeClient(tables: Record<string, MockRow[]>) {
  return createCappedSupabase({
    userId: "user-1",
    tables: {
      restaurant_pos_connections: [],
      pos_sales_items: [],
      restaurant_locations: [],
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
      companies: [
        { id: COMPANY_ID, name: "Los Ranchos", preferred_language: "en" },
      ],
      ...tables,
    },
  }) as unknown as SupabaseClient;
}

describe("currency helpers", () => {
  it("never assumes MXN — unknown/empty falls back to USD", () => {
    expect(normalizeCurrency(undefined)).toBeNull();
    expect(normalizeCurrency("mxn")).toBe("MXN");
    expect(resolveWriteCurrency(undefined, "USD")).toBe("USD");
    expect(resolveWriteCurrency("", "USD")).toBe("USD");
    expect(resolveWriteCurrency("mxn", "USD")).toBe("MXN");
    expect(FALLBACK_CURRENCY).toBe("USD");
  });

  it("flags a row whose currency differs from the company currency", () => {
    expect(currencyMismatchReason("USD", "USD")).toBeNull();
    expect(currencyMismatchReason("MXN", "USD")).toMatch(/MXN/);
    expect(currencyMismatchReason("MXN", "USD")).toMatch(/USD/);
  });

  it("maps El Salvador to USD via onboarding country", () => {
    expect(currencyForCountry("SV")).toBe("USD");
  });

  it("picks the majority POS currency", () => {
    expect(majorityCurrency(["USD", "USD", "MXN"])).toBe("USD");
    expect(majorityCurrency([null, "", "usd"])).toBe("USD");
  });
});

describe("resolveCompanyCurrency — USD company", () => {
  it("uses the onboarding country when there is no Odoo connection", async () => {
    const supabase = makeClient({
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: "SV" },
      ],
    });
    await expect(resolveCompanyCurrency(supabase, COMPANY_ID)).resolves.toBe(
      "USD"
    );
  });

  it("uses synced Odoo order currency for an Odoo-connected company", async () => {
    const supabase = makeClient({
      restaurant_pos_connections: [
        { id: "conn-1", company_id: COMPANY_ID, pos_source: "odoo" },
      ],
      pos_sales_items: [
        { company_id: COMPANY_ID, currency: "USD" },
        { company_id: COMPANY_ID, currency: "USD" },
      ],
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: null },
      ],
    });
    await expect(resolveCompanyCurrency(supabase, COMPANY_ID)).resolves.toBe(
      "USD"
    );
  });

  it("falls back to USD when country and POS are missing — never MXN", async () => {
    const supabase = makeClient({});
    await expect(resolveCompanyCurrency(supabase, COMPANY_ID)).resolves.toBe(
      "USD"
    );
  });

  it("returns MXN only when the country is actually Mexico", async () => {
    const supabase = makeClient({
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: "MX" },
      ],
    });
    await expect(resolveCompanyCurrency(supabase, COMPANY_ID)).resolves.toBe(
      "MXN"
    );
  });
});

describe("USD company create/upload defaults", () => {
  it("cost upload without a currency column uses the company USD default", () => {
    const headers = {
      cost_date: "cost_date",
      supplier_name: "supplier_name",
      ingredient_name: "ingredient_name",
      quantity: "quantity",
      unit: "unit",
      total_cost: "total_cost",
    };
    const result = normalizeCostImportRow(
      {
        cost_date: "2026-10-01",
        supplier_name: "La Central",
        ingredient_name: "Ribeye",
        quantity: 10,
        unit: "kg",
        total_cost: 120,
      },
      0,
      headers,
      "USD"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currency).toBe("USD");
      expect(currencyMismatchReason(result.value.currency, "USD")).toBeNull();
    }
  });

  it("rejects a cost row whose currency column is MXN for a USD company", () => {
    const result = normalizeCostImportRow(
      {
        cost_date: "2026-10-01",
        supplier_name: "La Central",
        ingredient_name: "Ribeye",
        quantity: 10,
        unit: "kg",
        total_cost: 120,
        currency: "MXN",
      },
      0,
      {
        cost_date: "cost_date",
        supplier_name: "supplier_name",
        ingredient_name: "ingredient_name",
        quantity: "quantity",
        unit: "unit",
        total_cost: "total_cost",
        currency: "currency",
      },
      "USD"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currency).toBe("MXN");
      expect(
        currencyMismatchReason(result.value.currency, "USD")
      ).not.toBeNull();
    }
  });

  it("new menu item / ingredient / invoice default to company USD", () => {
    expect(resolveWriteCurrency(undefined, "USD")).toBe("USD");
    expect(resolveWriteCurrency(null, "USD")).toBe("USD");
    expect(resolveWriteCurrency("USD", "USD")).toBe("USD");
    expect(
      currencyMismatchReason(resolveWriteCurrency("MXN", "USD"), "USD")
    ).not.toBeNull();
  });
});

describe("cockpit KPIs use company currency, not the first menu item", () => {
  it("USD company with MXN menu items still reports USD KPIs", async () => {
    const supabase = makeClient({
      restaurant_locations: [
        {
          id: "loc-1",
          company_id: COMPANY_ID,
          country: "SV",
          brand_id: "brand-1",
        },
      ],
      pos_sales_items: [
        {
          company_id: COMPANY_ID,
          location_id: "loc-1",
          raw_item_name: "Ribeye",
          quantity: 2,
          gross_revenue: 40,
          net_revenue: 40,
          currency: "USD",
        },
      ],
      menu_items: [
        {
          id: "mi-1",
          company_id: COMPANY_ID,
          name: "Ribeye",
          category: "mains",
          selling_price: 20,
          currency: "MXN",
          brand_id: "brand-1",
        },
      ],
    });

    const data = await fetchProfitabilityData(supabase, COMPANY_ID);
    expect(data.kpis.currency).toBe("USD");
    expect(data.kpis.revenue_total).toBe(40);
  });

  it("does not silently sum a POS row in a different currency", async () => {
    const supabase = makeClient({
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: "SV" },
      ],
      pos_sales_items: [
        {
          company_id: COMPANY_ID,
          location_id: "loc-1",
          raw_item_name: "USD dish",
          quantity: 1,
          gross_revenue: 10,
          net_revenue: 10,
          currency: "USD",
        },
        {
          company_id: COMPANY_ID,
          location_id: "loc-1",
          raw_item_name: "MXN dish",
          quantity: 1,
          gross_revenue: 999,
          net_revenue: 999,
          currency: "MXN",
        },
      ],
    });

    const data = await fetchProfitabilityData(supabase, COMPANY_ID);
    expect(data.kpis.currency).toBe("USD");
    expect(data.kpis.revenue_total).toBe(10);
    expect(data.dataQuality.currency_mismatch_rows).toBeGreaterThan(0);
  });

  it("menu page currency is the company currency, not the first menu item", async () => {
    const supabase = makeClient({
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: "SV" },
      ],
      menu_items: [
        {
          id: "mi-1",
          company_id: COMPANY_ID,
          name: "Taco",
          currency: "MXN",
          brand_id: null,
          status: "active",
          is_live: true,
          selling_price: 5,
          category: "mains",
        },
      ],
    });
    const data = await fetchMenuRecipesData(supabase, COMPANY_ID);
    expect(data.currency).toBe("USD");
  });
});

describe("listed create/upload paths no longer hardcode an MXN fallback", () => {
  const files = [
    "app/api/restaurant/costs/upload/route.ts",
    "app/api/restaurant/ingredients/route.ts",
    "app/api/restaurant/ingredient-costs/route.ts",
    "app/api/restaurant/menu-items/route.ts",
    "app/api/restaurant/invoices/route.ts",
    "app/api/restaurant/invoices/upload/route.ts",
    "app/api/restaurant/invoices/[id]/lines/route.ts",
    "app/api/restaurant/pos/upload/route.ts",
    "app/api/restaurant/pos/odoo-sync/route.ts",
    "app/api/restaurant/agent-actions/execute/route.ts",
    "lib/restaurant/profitability-server.ts",
    "lib/restaurant/menu-recipes-server.ts",
    "lib/restaurant/supabase-targets.ts",
  ];

  it.each(files)(
    "%s calls resolveCompanyCurrency or resolveWriteCurrency",
    (file) => {
      const src = readFileSync(file, "utf8");
      expect(
        src.includes("resolveCompanyCurrency") ||
          src.includes("resolveWriteCurrency") ||
          src.includes('?? "USD"')
      ).toBe(true);
      expect(src).not.toMatch(/:\s*"MXN"\s*;?\s*\/\/ Pinche/);
      expect(src).not.toContain('defaultCurrency: "MXN"');
    }
  );
});
