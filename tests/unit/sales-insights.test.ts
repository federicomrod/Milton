import { describe, it, expect } from "vitest";
import {
  buildCockpitSalesAggregate,
  type CockpitFactRow,
  type HeatmapCell,
} from "@/lib/restaurant/cockpit-aggregates";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";
import {
  buildSalesInsights,
  DINNER_START_HOUR,
  enrichHeatmapCells,
  filterRowsForSalesPeriod,
  findPeakSlot,
  findStrongestWeekday,
  findWeakestWeekday,
  flattenMixSeries,
  hourLabel,
  lunchVsDinner,
  rankCategories,
  weekdayLabel,
  weekdayTotals,
} from "@/lib/restaurant/sales-insights";
import {
  parseSalesExploreTab,
  salesHref,
} from "@/lib/restaurant/sales-explore";
import { contractEs } from "@/lib/restaurant/cockpit-executive";

const ES = "America/El_Salvador";

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
    payment_type: "card",
    category: "Mains",
    ...partial,
  };
}

function cell(
  weekday: number,
  hour: number,
  net_sales: number,
  tickets = 1
): HeatmapCell {
  const keys = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ] as const;
  return {
    weekday,
    weekday_key: keys[weekday],
    hour,
    net_sales,
    tickets,
  };
}

describe("daypart cutoff stays at 17:00", () => {
  it("documents dinner as local hour >= 17", () => {
    expect(DINNER_START_HOUR).toBe(17);
  });
});

describe("findPeakSlot", () => {
  it("picks the busiest weekday-hour and breaks ties earlier", () => {
    const peak = findPeakSlot([
      cell(5, 20, 400, 8),
      cell(5, 21, 400, 9),
      cell(4, 20, 120, 3),
      cell(0, 12, 0, 0),
    ]);
    expect(peak).toEqual({
      weekday: 5,
      weekday_key: "Friday",
      hour: 20,
      net_sales: 400,
      tickets: 8,
    });
  });

  it("returns null when nothing sold", () => {
    expect(findPeakSlot([cell(1, 12, 0, 0)])).toBeNull();
  });
});

describe("weekday strongest / weakest", () => {
  it("sums hours and ignores closed weekdays with zero", () => {
    const totals = weekdayTotals([
      cell(1, 12, 80, 2),
      cell(1, 20, 20, 1),
      cell(5, 20, 400, 8),
      cell(0, 12, 0, 0),
    ]);
    expect(findStrongestWeekday(totals)?.weekday).toBe(5);
    expect(findStrongestWeekday(totals)?.net_sales).toBe(400);
    expect(findWeakestWeekday(totals)?.weekday).toBe(1);
    expect(findWeakestWeekday(totals)?.net_sales).toBe(100);
  });

  it("is deterministic across two runs", () => {
    const cells = [cell(2, 13, 50, 1), cell(3, 19, 90, 2), cell(4, 19, 10, 1)];
    expect(findPeakSlot(cells)).toEqual(findPeakSlot(cells));
    expect(weekdayTotals(cells)).toEqual(weekdayTotals(cells));
  });
});

describe("lunch vs dinner", () => {
  it("splits at the documented 17:00 cutoff and reports shares", () => {
    const split = lunchVsDinner([
      {
        daypart: "lunch",
        hours: "00:00–17:00",
        net_sales: 40,
        tickets: 2,
        avg_ticket: 20,
      },
      {
        daypart: "dinner",
        hours: "17:00–24:00",
        net_sales: 60,
        tickets: 2,
        avg_ticket: 30,
      },
    ]);
    expect(split.winner).toBe("dinner");
    expect(split.dinner_share_pct).toBe(60);
    expect(split.lunch_share_pct).toBe(40);
  });

  it("matches the aggregate dayparts from local hours", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-03T18:00:00.000Z",
          check_id: "lunch",
          gross_revenue: 30,
        }),
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-04T00:30:00.000Z",
          check_id: "dinner",
          gross_revenue: 70,
        }),
      ],
      { timezone: ES, currency: "USD" }
    );
    const split = lunchVsDinner(agg.dayparts);
    expect(split.lunch.net_sales).toBe(30);
    expect(split.dinner.net_sales).toBe(70);
    expect(split.winner).toBe("dinner");
    expect(split.dinner_share_pct).toBe(70);
  });
});

describe("rankCategories", () => {
  it("keeps the top N and rolls the rest into other", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      category: `Cat ${i + 1}`,
      net_sales: 80 - i * 10,
      tickets: 8 - i,
      units: 8 - i,
    }));
    const ranked = rankCategories(rows, 6);
    expect(ranked.top.map((r) => r.category)).toEqual([
      "Cat 1",
      "Cat 2",
      "Cat 3",
      "Cat 4",
      "Cat 5",
      "Cat 6",
    ]);
    expect(ranked.other).toEqual({ net_sales: 30, tickets: 3, count: 2 });
    expect(ranked.total).toBe(8);
  });

  it("does not invent an other bucket when everything fits", () => {
    const ranked = rankCategories(
      [{ category: "Mains", net_sales: 10, tickets: 1, units: 1 }],
      6
    );
    expect(ranked.other).toBeNull();
    expect(ranked.total).toBe(1);
  });
});

describe("flattenMixSeries / heatmap enrich", () => {
  it("sums mix series deterministically", () => {
    const mix = flattenMixSeries([
      { period: "2026-07-20", values: { in_store: 10, delivery: 4 } },
      { period: "2026-07-27", values: { in_store: 5, takeaway: 2 } },
    ]);
    expect(mix.map((m) => m.key)).toEqual(["in_store", "delivery", "takeaway"]);
    expect(mix[0].net_sales).toBe(15);
  });

  it("adds avg ticket and vs typical from the backend", () => {
    const enriched = enrichHeatmapCells([
      cell(5, 20, 40, 2),
      cell(4, 20, 20, 1),
    ]);
    const friday = enriched.find((c) => c.weekday === 5);
    expect(friday?.avg_ticket).toBe(20);
    expect(friday?.typical_net).toBe(30);
    expect(friday?.vs_typical_pct).toBe(33.3);
  });
});

describe("filterRowsForSalesPeriod", () => {
  it("keeps only the current cockpit window by local date", () => {
    const period = resolveCockpitPeriod("last_7", "2026-07-31");
    expect(period).not.toBeNull();
    const rows = [
      row({ sale_date: "2026-07-31", check_id: "in", gross_revenue: 10 }),
      row({ sale_date: "2026-07-20", check_id: "out", gross_revenue: 99 }),
    ];
    const filtered = filterRowsForSalesPeriod(rows, period!, ES);
    expect(filtered.map((r) => r.check_id)).toEqual(["in"]);
  });
});

describe("buildSalesInsights — copy, money, no invented numbers", () => {
  const agg = buildCockpitSalesAggregate(
    [
      row({
        sale_date: "2026-07-31",
        order_placed_at: "2026-07-31T18:00:00.000Z",
        check_id: "fri-lunch",
        gross_revenue: 80,
        category: "Mains",
      }),
      row({
        sale_date: "2026-07-31",
        order_placed_at: "2026-08-01T02:00:00.000Z",
        check_id: "fri-dinner",
        gross_revenue: 200,
        category: "Mains",
      }),
      row({
        sale_date: "2026-07-27",
        order_placed_at: "2026-07-27T18:00:00.000Z",
        check_id: "mon",
        gross_revenue: 40,
        category: "Drinks",
        sales_channel: "delivery",
        payment_type: "cash",
      }),
      row({
        sale_date: "2026-07-31",
        check_id: "fri-dinner",
        raw_item_name: "Propina",
        gross_revenue: 20,
      }),
    ],
    { timezone: ES, currency: "USD" }
  );

  it("excludes tips from net and keeps them on their own line", () => {
    expect(agg.revenue.net_sales).toBe(320);
    expect(agg.revenue.tips).toBe(20);
    const insights = buildSalesInsights(agg, "es");
    expect(insights.summaries[0].value).toBe("$320.00");
    expect(insights.summaries[0].value).not.toContain("USD");
    expect(insights.summaries[0].hint).toContain("$20.00");
  });

  it("is deterministic and Spanish-complete", () => {
    const a = buildSalesInsights(agg, "es");
    const b = buildSalesInsights(agg, "es");
    expect(a.peak_slot).toEqual(b.peak_slot);
    expect(a.weakest_weekday).toEqual(b.weakest_weekday);
    expect(a.interpretation.body).toEqual(b.interpretation.body);
    expect(a.highlights.map((h) => h.title)).toEqual([
      "Pico del periodo",
      "Periodo más fuerte",
      "Periodo más flojo",
    ]);
    expect(a.interpretation.title).toBe("La lectura de Milton");
    expect(a.interpretation.body).toMatch(/el viernes/);
    expect(a.interpretation.body).not.toMatch(/\bde el\b/);
    expect(a.interpretation.body).not.toMatch(/\ba el\b/);
    expect(weekdayLabel(5, "es")).toBe("viernes");
    expect(hourLabel(20)).toBe("20:00");
    for (const highlight of a.highlights) {
      expect(highlight.ask_question).toMatch(/¿/);
      expect(highlight.ask_question).not.toMatch(/\bde el\b/);
      expect(contractEs(highlight.ask_question)).toBe(highlight.ask_question);
    }
  });

  it("does not put KPI math in the interpretation facts that React would need", () => {
    const insights = buildSalesInsights(agg, "es");
    expect(insights.interpretationFact.kind).toBe("sales_change");
    expect(insights.interpretationFact.facts.peak_net).toBe(
      insights.peak_slot?.net_sales
    );
    expect(insights.ranked_categories.top[0]?.category).toBe("Mains");
  });
});

describe("explore switcher + href helpers", () => {
  it("defaults to channels and accepts the three tabs", () => {
    expect(parseSalesExploreTab(null)).toBe("channels");
    expect(parseSalesExploreTab("categories")).toBe("categories");
    expect(parseSalesExploreTab("payments")).toBe("payments");
    expect(parseSalesExploreTab("nope")).toBe("channels");
  });

  it("keeps location and month period on detalle links", () => {
    expect(
      salesHref("/dashboard/restaurant/sales/detalle", {
        locationId: "loc-1",
        period: "month",
        hash: "categorias",
      })
    ).toBe(
      "/dashboard/restaurant/sales/detalle?location=loc-1&period=month#categorias"
    );
    expect(
      salesHref("/dashboard/restaurant/sales/detalle", { period: "last_7" })
    ).toBe("/dashboard/restaurant/sales/detalle");
  });
});
