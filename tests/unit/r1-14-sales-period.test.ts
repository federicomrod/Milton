// R1-14: Ventas period figures from the SQL rollup (047). Synthetic data.

import { describe, expect, it } from "vitest";
import {
  parseSalesPeriodRollup,
  salesDayStatsFromRollup,
} from "@/lib/restaurant/sales-period-rollup";
import { salesDayStatsFromRows } from "@/lib/restaurant/sales-insights";

// Three local days: Sat 2026-07-04 (Saturday), Sun 2026-07-05, Sat 2026-07-11.
const rows = [
  line("2026-07-04", "2026-07-04T18:30:00-06:00", "a1", 40),
  line("2026-07-04", "2026-07-04T18:45:00-06:00", "a1", 10),
  line("2026-07-04", "2026-07-04T13:05:00-06:00", "a2", 30),
  line("2026-07-05", "2026-07-05T13:10:00-06:00", "b1", 25),
  line("2026-07-11", "2026-07-11T18:10:00-06:00", "c1", 50),
  // A tip never counts as sales or tickets in the day stats.
  { ...line("2026-07-11", "2026-07-11T18:11:00-06:00", "c1", 5), is_tip: true },
];

function line(sale_date: string, placed: string, order: string, gross: number) {
  return {
    sale_date,
    order_placed_at: placed,
    order_id: order,
    check_id: null,
    raw_item_name: "Plato",
    quantity: 1,
    gross_revenue: gross,
    net_revenue: gross,
    discount_amount: 0,
    is_tip: false as boolean | null,
    sales_channel: "in_store",
    payment_type: "card",
    category: "Fuertes",
    currency: "USD",
  };
}

/** What 047 returns for those rows (computed by hand, as SQL would). */
const sql = {
  row_count: 6,
  period_from: "2026-07-04",
  period_to: "2026-07-11",
  revenue: {
    gross_sales: 155,
    discounts: 0,
    net_sales: 155,
    tips: 5,
    odoo_like_total: 160,
    discounts_estimated: false,
  },
  tickets: 4,
  units: 5,
  daily: [],
  heatmap_cells: [],
  hours_seen: [],
  lunch: { net_sales: 0, tickets: 0 },
  dinner: { net_sales: 0, tickets: 0 },
  channel_weeks: [],
  payment_weeks: [],
  category_mix: [],
  channel_by_day: [],
  this_week: null,
  last_week: null,
  stat_days: [
    { date: "2026-07-04", weekday: 6, net_sales: 80, net_raw: 80, tickets: 2 },
    { date: "2026-07-05", weekday: 0, net_sales: 25, net_raw: 25, tickets: 1 },
    { date: "2026-07-11", weekday: 6, net_sales: 50, net_raw: 50, tickets: 1 },
  ],
  stat_weekdays: [
    { weekday: 0, net_sales: 25, tickets: 1 },
    { weekday: 6, net_sales: 130, tickets: 3 },
  ],
  stat_slots: [
    { weekday: 0, hour: 13, net_sales: 25, tickets: 1, days: 1 },
    { weekday: 6, hour: 13, net_sales: 30, tickets: 1, days: 1 },
    { weekday: 6, hour: 18, net_sales: 100, tickets: 2, days: 2 },
  ],
  stat_tickets: 4,
};

describe("Ventas day stats from the SQL rollup", () => {
  it("equals the row walk", () => {
    const fromSql = salesDayStatsFromRollup(parseSalesPeriodRollup(sql)!);
    const fromRows = salesDayStatsFromRows(rows, {
      timezone: "America/El_Salvador",
      currency: "USD",
    });
    expect(fromSql).toEqual(fromRows);
  });

  it("best date: the biggest day; on a tie the earlier one", () => {
    const tie = parseSalesPeriodRollup({
      ...sql,
      stat_days: [
        {
          date: "2026-07-11",
          weekday: 6,
          net_sales: 80,
          net_raw: 80,
          tickets: 1,
        },
        {
          date: "2026-07-04",
          weekday: 6,
          net_sales: 80,
          net_raw: 80,
          tickets: 2,
        },
      ],
    })!;
    expect(salesDayStatsFromRollup(tie).best_date?.date).toBe("2026-07-04");
  });

  it("an empty period gives empty stats, not an error", () => {
    const empty = parseSalesPeriodRollup({ row_count: 0 })!;
    const stats = salesDayStatsFromRollup(empty);
    expect(stats).toMatchObject({
      days_with_sales: 0,
      tickets: 0,
      best_date: null,
      slots: [],
    });
    expect(stats.weekdays).toHaveLength(7);
  });
});
