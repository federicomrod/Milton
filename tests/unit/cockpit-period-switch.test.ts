import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { buildCockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import {
  periodCostKpisFromProductLines,
  periodCostKpisFromRows,
  productLinesFromCostRows,
} from "@/lib/restaurant/cockpit-cost-coverage";
import { buildCockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

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

const casa: CockpitFactRow[] = [
  row({
    sale_date: "2026-07-02",
    check_id: "a",
    menu_item_id: "steak",
    raw_item_name: "Steak",
    gross_revenue: 80_000,
    quantity: 400,
  }),
  row({
    sale_date: "2026-07-15",
    check_id: "b",
    raw_item_name: "Propina",
    gross_revenue: 1_200.59,
  }),
  row({
    sale_date: "2026-07-28",
    check_id: "c",
    menu_item_id: "steak",
    raw_item_name: "Steak",
    gross_revenue: 4_743,
    quantity: 20,
    sales_channel: "delivery",
  }),
];

const lavara: CockpitFactRow[] = [
  row({
    sale_date: "2026-07-10",
    check_id: "l1",
    menu_item_id: "pupusa",
    raw_item_name: "Pupusa",
    gross_revenue: 46_087.9,
    quantity: 2000,
  }),
  row({
    sale_date: "2026-07-20",
    check_id: "l2",
    raw_item_name: "Propina",
    gross_revenue: 4_632.9,
  }),
];

const lookup = {
  unitCostByMenuItemId: new Map<string, number | null>([
    ["steak", 12],
    ["pupusa", 1.1],
    ["soda", null],
  ]),
};

describe("rollup-based period costs match the row walk", () => {
  it("matches food cost / margin on mixed covered and uncovered dishes", () => {
    const rows = [
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
      row({
        sale_date: "2026-07-29",
        menu_item_id: "steak",
        raw_item_name: "Steak",
        gross_revenue: 50,
        quantity: 1,
      }),
    ];
    const fromRows = periodCostKpisFromRows(rows, lookup, "USD");
    const fromRollup = periodCostKpisFromProductLines(
      productLinesFromCostRows(rows, "USD"),
      lookup,
      "USD"
    );
    expect(fromRollup).toEqual(fromRows);
    expect(fromRollup.coverage_pct).toBe(88.2);
    expect(fromRollup.food_cost_pct).toBe(24);
    expect(fromRollup.gross_margin_pct).toBe(76);
  });

  it("keeps July month net + tips and the same cost KPIs for both periods", () => {
    const casaMonth = resolveCockpitPeriod("month", "2026-07-31")!;
    const casaLast7 = resolveCockpitPeriod("last_7", "2026-07-31")!;
    const casaAgg = buildCockpitSalesAggregate(casa, { currency: "USD" });
    expect(casaAgg.revenue.net_sales + casaAgg.revenue.tips).toBeCloseTo(
      85_943.59,
      2
    );

    for (const period of [casaMonth, casaLast7]) {
      const snap = buildCockpitPeriodSnapshot(casa, period, {
        currency: "USD",
        lang: "es",
        marginRows: [
          {
            menu_item_id: "steak",
            raw_pos_names: ["Steak"],
            cost: { status: "complete", cost: 12 },
          },
        ],
      });
      const currentRows = casa.filter((r) => {
        const date = r.sale_date;
        return date >= period.current.from && date <= period.current.to;
      });
      const fromRollup = periodCostKpisFromProductLines(
        productLinesFromCostRows(currentRows, "USD"),
        lookup,
        "USD"
      );
      expect(fromRollup).toEqual(snap.cost);
    }

    const lavaraMonth = buildCockpitPeriodSnapshot(
      lavara,
      resolveCockpitPeriod("month", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    expect(
      lavaraMonth.current.net_sales + lavaraMonth.current.tips
    ).toBeCloseTo(50_720.8, 2);
    expect(lavaraMonth.current.net_sales).toBeCloseTo(46_087.9, 2);
    expect(lavaraMonth.current.tips).toBeCloseTo(4_632.9, 2);
  });
});

describe("period switch stays on the already-loaded cockpit", () => {
  it("R1-16b: the Cockpit v2 changes period, comparison and category in the browser, with no request and no navigation", () => {
    const page = read("app/(restaurant-cockpit)/dashboard/restaurant/page.tsx");
    const cockpit = read("components/restaurant/cockpit/v2/CockpitV2.tsx");
    expect(page).toContain("CockpitV2");
    // The handlers only set state (computeCockpit recomputes from the loaded data).
    expect(cockpit).toContain("onClick={() => setPeriod(p.key)}");
    expect(cockpit).toContain("setComparison(e.target.value as Comparison)");
    expect(cockpit).toContain("onSlice={setCategory}");
    // The one extra read depends on the restaurant only, never on period/comparison/category.
    const fetches = cockpit.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(cockpit).toContain("[costKey, props.locationId, attempt]");
    // Period/comparison/category never reach the router or the network.
    expect(cockpit).not.toMatch(
      /router\.(replace|push)\([^)]*(period|comparison|category)/
    );
    expect(cockpit).not.toContain("useTransition");
  });
});
