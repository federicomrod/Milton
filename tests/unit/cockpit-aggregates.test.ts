import { describe, it, expect } from "vitest";
import {
  buildCockpitSalesAggregate,
  daypartFromLocalHour,
  DINNER_START_HOUR,
  formatCompactDateRange,
  shiftDateKey,
  weekWindowsFromAnchor,
  type CockpitFactRow,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  toSalesFactRow,
  buildSalesSnapshot,
} from "@/lib/restaurant/ask-milton-sales";
import type { PosSalesItemRow } from "@/lib/restaurant/supabase-sales";

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

describe("daypart cutoff", () => {
  it("documents dinner as local hour >= 17", () => {
    expect(DINNER_START_HOUR).toBe(17);
    expect(daypartFromLocalHour(16)).toBe("lunch");
    expect(daypartFromLocalHour(17)).toBe("dinner");
    expect(daypartFromLocalHour(0)).toBe("lunch");
    expect(daypartFromLocalHour(23)).toBe("dinner");
  });
});

describe("week vs last week windows", () => {
  it("uses the latest sale date as the 7-day anchor, not the wall clock", () => {
    expect(weekWindowsFromAnchor("2026-07-31")).toEqual({
      thisWeek: { from: "2026-07-25", to: "2026-07-31" },
      lastWeek: { from: "2026-07-18", to: "2026-07-24" },
    });
    expect(shiftDateKey("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("buildCockpitSalesAggregate — tips, discounts, net", () => {
  const rows: CockpitFactRow[] = [
    row({
      sale_date: "2026-07-20",
      check_id: "a",
      raw_item_name: "Pupusa",
      gross_revenue: 20,
      discount_amount: 4,
    }),
    row({
      sale_date: "2026-07-20",
      check_id: "a",
      raw_item_name: "Propina",
      gross_revenue: 3,
      discount_amount: 0,
    }),
    row({
      sale_date: "2026-07-10",
      check_id: "b",
      raw_item_name: "Cafe",
      gross_revenue: 5,
    }),
  ];

  it("excludes tips from net and reports them separately", () => {
    const agg = buildCockpitSalesAggregate(rows, { currency: "USD" });
    expect(agg.revenue.net_sales).toBe(25);
    expect(agg.revenue.tips).toBe(3);
    expect(agg.revenue.discounts).toBe(4);
    expect(agg.revenue.gross_sales).toBe(29);
    expect(agg.revenue.odoo_like_total).toBe(28);
    expect(agg.revenue.discounts_estimated).toBe(false);
    expect(agg.period_from).toBe("2026-07-10");
    expect(agg.period_to).toBe("2026-07-20");
    expect(agg.tickets).toBe(2);
    expect(agg.avg_ticket).toBe(12.5);
    expect(agg.category_mix.map((c) => c.category)).toEqual(["Mains"]);
  });

  it("marks discounts estimated when a line used the percent fallback", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({
          sale_date: "2026-07-20",
          discount_amount: 3,
          source_metadata: { discount_estimated: true },
        }),
      ],
      { currency: "USD" }
    );
    expect(agg.revenue.discounts).toBe(3);
    expect(agg.revenue.discounts_estimated).toBe(true);
  });

  it("skips mixed-currency rows the same way as today's cockpit", () => {
    const mixed = [
      row({ sale_date: "2026-07-20", gross_revenue: 10, currency: "USD" }),
      row({
        sale_date: "2026-07-20",
        check_id: "mx",
        gross_revenue: 999,
        currency: "MXN",
      }),
    ];
    const agg = buildCockpitSalesAggregate(mixed, { currency: "USD" });
    expect(agg.revenue.net_sales).toBe(10);
    expect(agg.tickets).toBe(1);
  });
});

describe("heatmap buckets by restaurant timezone", () => {
  it("puts a UTC Saturday morning onto Friday evening in America/El_Salvador", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-04T04:30:00.000Z",
          check_id: "tz",
          gross_revenue: 40,
        }),
      ],
      { timezone: ES, currency: "USD" }
    );
    const cell = agg.heatmap.find((c) => c.net_sales > 0);
    expect(cell?.weekday).toBe(5); // Friday
    expect(cell?.hour).toBe(22);
    expect(cell?.net_sales).toBe(40);
  });

  it("does not put that same instant on Saturday morning when TZ is El Salvador", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-04T04:30:00.000Z",
          gross_revenue: 40,
        }),
      ],
      { timezone: ES, currency: "USD" }
    );
    const saturdayMorning = agg.heatmap.find(
      (c) => c.weekday === 6 && c.hour === 4
    );
    expect(saturdayMorning?.net_sales ?? 0).toBe(0);
  });
});

describe("lunch / dinner split", () => {
  it("splits net sales and tickets at 17:00 local", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-03T18:00:00.000Z", // 12:00 SV
          check_id: "lunch",
          gross_revenue: 30,
        }),
        row({
          sale_date: "2026-07-03",
          order_placed_at: "2026-07-04T00:30:00.000Z", // 18:30 SV
          check_id: "dinner",
          gross_revenue: 50,
        }),
      ],
      { timezone: ES, currency: "USD" }
    );
    const lunch = agg.dayparts.find((d) => d.daypart === "lunch");
    const dinner = agg.dayparts.find((d) => d.daypart === "dinner");
    expect(lunch?.net_sales).toBe(30);
    expect(lunch?.tickets).toBe(1);
    expect(lunch?.avg_ticket).toBe(30);
    expect(dinner?.net_sales).toBe(50);
    expect(dinner?.tickets).toBe(1);
    expect(dinner?.avg_ticket).toBe(50);
  });
});

describe("week vs last week", () => {
  it("compares the last 7 local dates against the 7 before that", () => {
    const agg = buildCockpitSalesAggregate(
      [
        row({ sale_date: "2026-07-31", check_id: "w1", gross_revenue: 100 }),
        row({ sale_date: "2026-07-24", check_id: "w0", gross_revenue: 50 }),
      ],
      { timezone: ES, currency: "USD" }
    );
    expect(agg.this_week).toMatchObject({
      from: "2026-07-25",
      to: "2026-07-31",
      net_sales: 100,
      tickets: 1,
    });
    expect(agg.last_week).toMatchObject({
      from: "2026-07-18",
      to: "2026-07-24",
      net_sales: 50,
      tickets: 1,
    });
    expect(agg.week_delta_pct).toBe(100);
    expect(agg.period_from).toBe("2026-07-24");
    expect(agg.period_to).toBe("2026-07-31");
  });
});

describe("formatCompactDateRange", () => {
  it("collapses a same-month range", () => {
    expect(formatCompactDateRange("2026-07-25", "2026-07-31", "en-GB")).toBe(
      "25–31 Jul 2026"
    );
  });
});

describe("Ask Milton stays on the same net definition", () => {
  it("toSalesFactRow + snapshot exclude Propina from revenue", () => {
    const raw: PosSalesItemRow[] = [
      {
        id: "1",
        company_id: "c",
        location_id: null,
        menu_item_id: null,
        sale_date: "2026-07-15",
        order_id: "1",
        check_id: "1",
        raw_item_name: "Pupusa",
        quantity: 1,
        gross_revenue: 20,
        net_revenue: 20,
        currency: "USD",
        sales_channel: "in_store",
        payment_type: "card",
        category: "Mains",
        sub_category: null,
      },
      {
        id: "2",
        company_id: "c",
        location_id: null,
        menu_item_id: null,
        sale_date: "2026-07-15",
        order_id: "1",
        check_id: "1",
        raw_item_name: "Propina",
        quantity: 1,
        gross_revenue: 4,
        net_revenue: 4,
        currency: "USD",
        sales_channel: "in_store",
        payment_type: "card",
        category: null,
        sub_category: null,
      },
    ];
    const facts = raw.map(toSalesFactRow);
    expect(facts[1].is_tip).toBe(true);
    const snap = buildSalesSnapshot(facts, ES);
    expect(snap.totals.revenue).toBe(20);
    expect(snap.totals.net_sales).toBe(20);
    expect(snap.totals.tips).toBe(4);
    expect(snap.totals.odoo_like_total).toBe(24);
    expect(snap.top_items_by_revenue.map((i) => i.name)).toEqual(["Pupusa"]);
  });
});
