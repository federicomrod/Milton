import { describe, it, expect } from "vitest";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";
import {
  buildCockpitPosProductRollupFromRows,
  emptyCockpitPosProductRollup,
  parseCockpitPosProductRollup,
} from "@/lib/restaurant/cockpit-pos-product-rollup";
import { isMissingRpcError } from "@/lib/restaurant/cockpit-pos-rollup";
import { createCappedSupabase, type MockRow } from "./helpers/capped-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const COMPANY_ID = "co-1";
const LOC = "loc-lavara";

function posRow(
  partial: Partial<MockRow> & { raw_item_name: string }
): MockRow {
  return {
    id: partial.id ?? `pos-${partial.raw_item_name}`,
    company_id: COMPANY_ID,
    location_id: LOC,
    sale_date: "2026-07-15",
    order_id: "o1",
    check_id: "c1",
    quantity: 1,
    gross_revenue: 10,
    net_revenue: 10,
    currency: "USD",
    is_tip: false,
    ...partial,
  };
}

function makeClient(posRows: MockRow[]) {
  return createCappedSupabase({
    userId: "user-1",
    tables: {
      companies: [{ id: COMPANY_ID, name: "Test" }],
      restaurant_locations: [
        { id: LOC, company_id: COMPANY_ID, country: "SV" },
      ],
      pos_sales_items: posRows,
      pos_item_mappings: [
        {
          raw_pos_item_name: "Pupusa",
          menu_item_id: "mi-1",
          location_id: null,
        },
      ],
      menu_items: [
        {
          id: "mi-1",
          name: "Pupusa",
          category: "mains",
          selling_price: 10,
          currency: "USD",
          brand_id: null,
        },
      ],
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
    },
  }) as unknown as SupabaseClient;
}

describe("cockpit POS product rollup", () => {
  const julyLavara = [
    posRow({
      id: "a",
      raw_item_name: "Pupusa",
      check_id: "l1",
      order_id: "o1",
      gross_revenue: 50_000,
    }),
    posRow({
      id: "b",
      raw_item_name: "Propina",
      check_id: "l2",
      order_id: "o2",
      gross_revenue: 720.8,
    }),
  ];

  const julyCasa = [
    posRow({
      id: "r1",
      raw_item_name: "Pupusa",
      check_id: "a",
      gross_revenue: 80_000,
    }),
    posRow({
      id: "r2",
      raw_item_name: "Propina",
      check_id: "b",
      gross_revenue: 1_200.59,
    }),
    posRow({
      id: "r3",
      raw_item_name: "Pupusa",
      check_id: "c",
      gross_revenue: 4_743,
    }),
  ];

  it("July net + tips stay $85,943.59 / $50,720.80 on the product grouping", () => {
    const casa = buildCockpitPosProductRollupFromRows(julyCasa, "USD");
    const casaNet = casa.products
      .filter((p) => !p.is_tip)
      .reduce((s, p) => s + p.net, 0);
    const casaTips = casa.products
      .filter((p) => p.is_tip)
      .reduce((s, p) => s + p.posted, 0);
    expect(casaNet + casaTips).toBeCloseTo(85_943.59, 2);

    const lavara = buildCockpitPosProductRollupFromRows(julyLavara, "USD");
    const lavaraNet = lavara.products
      .filter((p) => !p.is_tip)
      .reduce((s, p) => s + p.net, 0);
    const lavaraTips = lavara.products
      .filter((p) => p.is_tip)
      .reduce((s, p) => s + p.posted, 0);
    expect(lavaraNet + lavaraTips).toBeCloseTo(50_720.8, 2);
  });

  it("profitability from the product rollup matches the row walk", async () => {
    const rows = [
      ...julyLavara,
      posRow({
        id: "mxn",
        raw_item_name: "Taco",
        currency: "MXN",
        gross_revenue: 999,
        check_id: "mx",
      }),
      posRow({
        id: "empty",
        raw_item_name: "   ",
        check_id: "blank",
        gross_revenue: 5,
      }),
    ];
    const fromRows = await fetchProfitabilityData(
      makeClient(rows),
      COMPANY_ID,
      {
        locationId: LOC,
        brandId: null,
      }
    );
    const rollup = buildCockpitPosProductRollupFromRows(rows, "USD");
    const fromRollup = await fetchProfitabilityData(
      makeClient([]),
      COMPANY_ID,
      { locationId: LOC, brandId: null },
      { posProductRollup: rollup }
    );
    expect(fromRollup.kpis.revenue_total).toBe(fromRows.kpis.revenue_total);
    expect(fromRollup.setupCounts.pos_sales_count).toBe(
      fromRows.setupCounts.pos_sales_count
    );
    expect(fromRollup.distinct_check_count).toBe(fromRows.distinct_check_count);
    expect(fromRollup.dataQuality.currency_mismatch_rows).toBe(
      fromRows.dataQuality.currency_mismatch_rows
    );
    expect(fromRollup.posSource).toBe("product-rpc");
    const pupusa = fromRollup.marginRows.find((r) => r.name === "Pupusa");
    const pupusaRows = fromRows.marginRows.find((r) => r.name === "Pupusa");
    expect(pupusa?.revenue).toBe(pupusaRows?.revenue);
    expect(pupusa?.units_sold).toBe(pupusaRows?.units_sold);
  });

  it("fail-closes to empty totals on an explicit POS error", async () => {
    const data = await fetchProfitabilityData(
      makeClient(julyLavara),
      COMPANY_ID,
      { locationId: LOC, brandId: null },
      { posReadError: true }
    );
    expect(data.readError).toBe(true);
    expect(data.kpis.revenue_total).toBe(0);
    expect(data.setupCounts.pos_sales_count).toBe(0);
    expect(data.posSource).toBe("error");
  });

  it("parse rejects garbage and empty helper is zeros", () => {
    expect(parseCockpitPosProductRollup(null)).toBeNull();
    expect(parseCockpitPosProductRollup("nope")).toBeNull();
    expect(emptyCockpitPosProductRollup().row_count).toBe(0);
    expect(emptyCockpitPosProductRollup().products).toEqual([]);
    expect(
      parseCockpitPosProductRollup({
        row_count: 2,
        distinct_check_count: 2,
        currency_mismatch_rows: 0,
        products: [
          {
            raw_item_name: "Pupusa",
            location_id: LOC,
            currency: "USD",
            is_tip: false,
            units: 2,
            net: 20,
            posted: 20,
          },
        ],
      })?.products[0].net
    ).toBe(20);
  });

  it("missing-RPC helper accepts the product function name", () => {
    expect(
      isMissingRpcError({ code: "PGRST202" }, "cockpit_pos_product_rollup")
    ).toBe(true);
    expect(
      isMissingRpcError({
        message: "Could not find the function cockpit_pos_product_rollup",
      })
    ).toBe(true);
  });
});
