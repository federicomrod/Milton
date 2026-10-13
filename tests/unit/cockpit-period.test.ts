import { describe, it, expect } from "vitest";
import {
  buildCockpitSalesAggregate,
  type CockpitFactRow,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  deltaPct,
  enumerateDates,
  parseCockpitPeriodPreset,
  resolveCockpitPeriod,
} from "@/lib/restaurant/cockpit-period";
import { buildCockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";

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

describe("cockpit period contract (#129)", () => {
  it("defaults to last_7 and reads month from the query", () => {
    expect(parseCockpitPeriodPreset(null)).toBe("last_7");
    expect(parseCockpitPeriodPreset("month")).toBe("month");
    expect(parseCockpitPeriodPreset("nope")).toBe("last_7");
  });

  it("anchors last 7 vs previous 7 to the latest sale date", () => {
    expect(resolveCockpitPeriod("last_7", "2026-07-31")).toEqual({
      preset: "last_7",
      current: { from: "2026-07-25", to: "2026-07-31" },
      previous: { from: "2026-07-18", to: "2026-07-24" },
      month_complete: null,
    });
  });

  it("uses the calendar month of the latest sale vs the month before", () => {
    expect(resolveCockpitPeriod("month", "2026-07-31")).toEqual({
      preset: "month",
      current: { from: "2026-07-01", to: "2026-07-31" },
      previous: { from: "2026-06-01", to: "2026-06-30" },
      month_complete: true,
    });
    expect(enumerateDates("2026-06-01", "2026-06-30")).toHaveLength(30);
    expect(enumerateDates("2026-07-01", "2026-07-31")).toHaveLength(31);
  });

  it("returns null delta when previous is zero and current is not", () => {
    expect(deltaPct(100, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(110, 100)).toBe(10);
    expect(deltaPct(90, 100)).toBe(-10);
  });
});

describe("period aggregation matches full-period totals", () => {
  const casa: CockpitFactRow[] = [
    row({
      sale_date: "2026-07-02",
      check_id: "a",
      gross_revenue: 80_000,
      sales_channel: "in_store",
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
      gross_revenue: 4_743,
      sales_channel: "delivery",
    }),
  ];
  const lavara: CockpitFactRow[] = [
    row({
      sale_date: "2026-07-10",
      check_id: "l1",
      gross_revenue: 50_000,
    }),
    row({
      sale_date: "2026-07-20",
      check_id: "l2",
      raw_item_name: "Propina",
      gross_revenue: 720.8,
    }),
  ];

  it("July month net + tips matches the unfiltered aggregate (Casa Prueba / Lavara lock)", () => {
    const casaAll = buildCockpitSalesAggregate(casa, { currency: "USD" });
    const casaMonth = buildCockpitPeriodSnapshot(
      casa,
      resolveCockpitPeriod("month", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    expect(casaAll.revenue.net_sales + casaAll.revenue.tips).toBeCloseTo(
      85_943.59,
      2
    );
    expect(casaMonth.current.net_sales + casaMonth.current.tips).toBeCloseTo(
      85_943.59,
      2
    );

    const lavaraAll = buildCockpitSalesAggregate(lavara, { currency: "USD" });
    const lavaraMonth = buildCockpitPeriodSnapshot(
      lavara,
      resolveCockpitPeriod("month", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    expect(lavaraAll.revenue.net_sales + lavaraAll.revenue.tips).toBeCloseTo(
      50_720.8,
      2
    );
    expect(
      lavaraMonth.current.net_sales + lavaraMonth.current.tips
    ).toBeCloseTo(50_720.8, 2);
  });

  it("last 7 only includes the current window and compares the 7 before", () => {
    const rows: CockpitFactRow[] = [
      row({
        sale_date: "2026-07-20",
        check_id: "prev",
        gross_revenue: 40,
      }),
      row({
        sale_date: "2026-07-28",
        check_id: "cur",
        gross_revenue: 80,
      }),
      row({
        sale_date: "2026-07-28",
        check_id: "cur",
        raw_item_name: "Propina",
        gross_revenue: 5,
      }),
    ];
    const snap = buildCockpitPeriodSnapshot(
      rows,
      resolveCockpitPeriod("last_7", "2026-07-31")!,
      { currency: "USD", lang: "es" }
    );
    expect(snap.period.current).toEqual({
      from: "2026-07-25",
      to: "2026-07-31",
    });
    expect(snap.current.net_sales).toBe(80);
    expect(snap.current.tips).toBe(5);
    expect(snap.previous.net_sales).toBe(40);
    expect(snap.daily).toHaveLength(7);
    expect(snap.daily.some((d) => d.date === "2026-07-28")).toBe(true);
  });
});
