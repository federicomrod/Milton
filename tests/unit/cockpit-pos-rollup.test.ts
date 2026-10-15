import { describe, it, expect } from "vitest";
import {
  buildCockpitSalesAggregate,
  type CockpitFactRow,
} from "@/lib/restaurant/cockpit-aggregates";
import { buildCockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";
import {
  buildCockpitPeriodSnapshotFromRollup,
  isMissingRpcError,
  parseCockpitPosRollup,
  rollupToCockpitSalesAggregate,
  type CockpitPosRollup,
} from "@/lib/restaurant/cockpit-pos-rollup";
import { classifySaleLine } from "@/lib/restaurant/sales-revenue";

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

describe("cockpit POS rollup converters", () => {
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
  const casasur: CockpitFactRow[] = [
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

  it("July net + tips stay $85,943.59 / $50,720.80 via the rollup DTO", () => {
    const casaRollup = rollupFromRows(casa);
    const casaAgg = rollupToCockpitSalesAggregate(casaRollup, {
      currency: "USD",
    });
    expect(casaAgg.revenue.net_sales + casaAgg.revenue.tips).toBeCloseTo(
      85_943.59,
      2
    );
    expect(casaAgg.revenue.net_sales).toBeCloseTo(84_743, 2);
    expect(casaAgg.revenue.tips).toBeCloseTo(1_200.59, 2);

    const casasurRollup = rollupFromRows(casasur);
    const casasurAgg = rollupToCockpitSalesAggregate(casasurRollup, {
      currency: "USD",
    });
    expect(casasurAgg.revenue.net_sales + casasurAgg.revenue.tips).toBeCloseTo(
      50_720.8,
      2
    );
  });

  it("period snapshot from rollup matches the row walk for July month", () => {
    const period = resolveCockpitPeriod("month", "2026-07-31")!;
    const fromRows = buildCockpitPeriodSnapshot(casa, period, {
      currency: "USD",
      lang: "es",
    });
    const fromRollup = buildCockpitPeriodSnapshotFromRollup(
      rollupFromRows(casa),
      period,
      { currency: "USD", lang: "es" }
    );
    expect(fromRollup.current.net_sales).toBeCloseTo(
      fromRows.current.net_sales,
      2
    );
    expect(fromRollup.current.tips).toBeCloseTo(fromRows.current.tips, 2);
    expect(fromRollup.current.tickets).toBe(fromRows.current.tickets);
    expect(fromRollup.channels.map((c) => c.channel).sort()).toEqual(
      fromRows.channels.map((c) => c.channel).sort()
    );
  });

  it("in-memory aggregate still matches the rollup converter on the same rows", () => {
    const rows = [...casa, ...casasur];
    const direct = buildCockpitSalesAggregate(rows, { currency: "USD" });
    const via = rollupToCockpitSalesAggregate(rollupFromRows(rows), {
      currency: "USD",
    });
    expect(via.revenue.net_sales).toBeCloseTo(direct.revenue.net_sales, 2);
    expect(via.revenue.tips).toBeCloseTo(direct.revenue.tips, 2);
    expect(via.tickets).toBe(direct.tickets);
    expect(via.this_week?.net_sales).toBeCloseTo(
      direct.this_week?.net_sales ?? 0,
      2
    );
  });

  it("parseCockpitPosRollup rejects garbage and flags a missing RPC", () => {
    expect(parseCockpitPosRollup(null)).toBeNull();
    expect(parseCockpitPosRollup("nope")).toBeNull();
    expect(isMissingRpcError({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpcError({ message: "Could not find the function" })).toBe(
      true
    );
    expect(isMissingRpcError({ message: "permission denied" })).toBe(false);
  });
});

function rollupFromRows(rows: CockpitFactRow[]): CockpitPosRollup {
  const daily = new Map<
    string,
    {
      date: string;
      net_sales: number;
      gross_sales: number;
      discounts: number;
      tips: number;
      tickets: Set<string>;
      units: number;
      discounts_estimated: boolean;
    }
  >();
  const channels = new Map<string, Map<string, number>>();
  const orders = new Set<string>();
  let net = 0;
  let tips = 0;
  let gross = 0;
  let discounts = 0;
  let units = 0;
  let discountsEstimated = false;
  let from: string | null = null;
  let to: string | null = null;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.sale_date)) continue;
    const date = r.sale_date;
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
    const line = classifySaleLine(r);
    const key = r.check_id ?? r.order_id ?? null;
    if (key) orders.add(key);
    net += line.net;
    tips += line.tip;
    gross += line.gross;
    discounts += line.discount;
    if (!line.isTip) units += r.quantity ?? 0;
    if (line.discountEstimated) discountsEstimated = true;
    let day = daily.get(date);
    if (!day) {
      day = {
        date,
        net_sales: 0,
        gross_sales: 0,
        discounts: 0,
        tips: 0,
        tickets: new Set(),
        units: 0,
        discounts_estimated: false,
      };
      daily.set(date, day);
    }
    day.net_sales += line.net;
    day.gross_sales += line.gross;
    day.discounts += line.discount;
    day.tips += line.tip;
    if (key) day.tickets.add(key);
    if (!line.isTip) day.units += r.quantity ?? 0;
    if (line.discountEstimated) day.discounts_estimated = true;
    if (!line.isTip) {
      const ch = r.sales_channel?.trim() || "unknown";
      let byCh = channels.get(date);
      if (!byCh) {
        byCh = new Map();
        channels.set(date, byCh);
      }
      byCh.set(ch, (byCh.get(ch) ?? 0) + line.net);
    }
  }
  const agg = buildCockpitSalesAggregate(rows, { currency: "USD" });
  return {
    row_count: rows.length,
    period_from: from,
    period_to: to,
    revenue: {
      gross_sales: Math.round(gross * 100) / 100,
      discounts: Math.round(discounts * 100) / 100,
      net_sales: Math.round(net * 100) / 100,
      tips: Math.round(tips * 100) / 100,
      odoo_like_total: Math.round((net + tips) * 100) / 100,
      discounts_estimated: discountsEstimated,
    },
    tickets: orders.size,
    units,
    daily: Array.from(daily.values()).map((d) => ({
      date: d.date,
      net_sales: Math.round(d.net_sales * 100) / 100,
      gross_sales: Math.round(d.gross_sales * 100) / 100,
      discounts: Math.round(d.discounts * 100) / 100,
      tips: Math.round(d.tips * 100) / 100,
      tickets: d.tickets.size,
      units: d.units,
      discounts_estimated: d.discounts_estimated,
    })),
    heatmap_cells: [],
    hours_seen: [],
    lunch: { net_sales: 0, tickets: 0 },
    dinner: { net_sales: 0, tickets: 0 },
    channel_weeks: [],
    payment_weeks: [],
    category_mix: [],
    channel_by_day: Array.from(channels.entries()).flatMap(([date, map]) =>
      Array.from(map.entries()).map(([channel, net_sales]) => ({
        date,
        channel,
        net_sales: Math.round(net_sales * 100) / 100,
      }))
    ),
    this_week: agg.this_week,
    last_week: agg.last_week,
  };
}
