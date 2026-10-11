import { describe, it, expect } from "vitest";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import {
  salesWeightedCoverage,
  periodCostKpisFromRows,
} from "@/lib/restaurant/cockpit-cost-coverage";
import {
  buildCockpitHeadline,
  buildCockpitKpiStripModel,
  buildCockpitPeriodSnapshot,
  unavailableCostKpi,
} from "@/lib/restaurant/cockpit-executive";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";

function row(
  partial: Partial<CockpitFactRow> & Pick<CockpitFactRow, "sale_date">
): CockpitFactRow {
  return {
    raw_item_name: "Pupusa",
    quantity: 1,
    gross_revenue: 10,
    discount_amount: 0,
    check_id: "o1",
    currency: "USD",
    sales_channel: "in_store",
    ...partial,
  };
}

describe("cost coverage is sales-weighted (#129)", () => {
  it("is the share of net sales from dishes with a cost, not ingredient counts", () => {
    const coverage = salesWeightedCoverage([
      { net: 80, has_cost: true },
      { net: 20, has_cost: false },
    ]);
    expect(coverage.coverage_pct).toBe(80);
    expect(coverage.net_sales).toBe(100);
    expect(coverage.covered_sales).toBe(80);
  });

  it("stays 0 when nothing is costed — never a fake percent", () => {
    expect(
      salesWeightedCoverage([
        { net: 50, has_cost: false },
        { net: 25, has_cost: false },
      ]).coverage_pct
    ).toBe(0);
    expect(salesWeightedCoverage([]).coverage_pct).toBe(0);
  });

  it("computes food cost % and margin only on covered net sales", () => {
    const kpis = periodCostKpisFromRows(
      [
        row({
          sale_date: "2026-07-28",
          menu_item_id: "steak",
          raw_item_name: "Steak",
          gross_revenue: 100,
          quantity: 2,
        }),
        row({
          sale_date: "2026-07-28",
          menu_item_id: "soda",
          raw_item_name: "Soda",
          gross_revenue: 20,
          quantity: 1,
        }),
      ],
      {
        unitCostByMenuItemId: new Map([
          ["steak", 20],
          ["soda", null],
        ]),
      },
      "USD"
    );
    expect(kpis.coverage_pct).toBe(83.3);
    expect(kpis.covered_net).toBe(100);
    expect(kpis.estimated_cogs).toBe(40);
    expect(kpis.food_cost_pct).toBe(40);
    expect(kpis.gross_margin_pct).toBe(60);
  });
});

describe("not-available cost KPIs", () => {
  it("uses the recipe-cost reason and the cost-import link — never a dash", () => {
    const na = unavailableCostKpi("es");
    expect(na.available).toBe(false);
    expect(na.reason).toBe("Se necesitan costos de recetas");
    expect(na.link_label).toBe("Agregar costos");
    expect(na.href).toBe("/dashboard/restaurant/costs/upload");
    expect(JSON.stringify(na)).not.toContain("—");
  });

  it("marks margin and food cost unavailable when coverage is 0", () => {
    const snap = buildCockpitPeriodSnapshot(
      [row({ sale_date: "2026-07-28", gross_revenue: 30 })],
      resolveCockpitPeriod("last_7", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    expect(snap.cost.coverage_pct).toBe(0);
    const strip = buildCockpitKpiStripModel(snap, "es", {
      thisWeek: snap.period.current,
      lastWeek: snap.period.previous,
      deltaPct: null,
    });
    expect(strip.gross_margin_pct.available).toBe(false);
    expect(strip.food_cost_pct.available).toBe(false);
    if (!strip.gross_margin_pct.available) {
      expect(strip.gross_margin_pct.reason).toBe(
        "Se necesitan costos de recetas"
      );
    }
    expect(strip.net_sales.available).toBe(true);
    expect(strip.tickets.available).toBe(true);
  });
});

describe("headline is deterministic from backend numbers", () => {
  it("states last-7 net sales and the previous-period delta in Spanish", () => {
    const snap = buildCockpitPeriodSnapshot(
      [
        row({
          sale_date: "2026-07-20",
          check_id: "p",
          gross_revenue: 100,
        }),
        row({
          sale_date: "2026-07-28",
          check_id: "c",
          gross_revenue: 150,
        }),
      ],
      resolveCockpitPeriod("last_7", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    const headline = buildCockpitHeadline(snap, "es");
    expect(headline).toContain("Ventas netas");
    expect(headline).toContain("últimos 7 días");
    expect(headline).toMatch(/\+50\.0%/);
  });
});
