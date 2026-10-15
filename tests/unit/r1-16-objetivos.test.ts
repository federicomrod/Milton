// R1-16a: Objetivos. Synthetic numbers only.
import { describe, expect, it } from "vitest";
import {
  dailySalesTarget,
  daysInMonth,
  eachDay,
  levelTarget,
  parseWeights,
  periodSalesTarget,
  pickTargetRow,
  roundWeights,
  suggestWeekdayWeights,
  toTargetRow,
  weekdayAmounts,
  weekdayIndex,
  weightsFromAmounts,
  type TargetRow,
} from "@/lib/restaurant/objetivos";

const row = (over: Partial<TargetRow> = {}): TargetRow => ({
  metric_key: "revenue",
  target_period: "monthly",
  target_value: 34500,
  location_id: null,
  effective_from: "2026-01-01",
  is_active: true,
  weekday_weights: null,
  ...over,
});
const all = { locationId: null, restaurantIds: ["r1", "r2"] } as const;

describe("daily sales target from a monthly one", () => {
  it("flat: 34,500 in a 30-day month is 1,150 a day; in a 31-day month 1,112.90", () => {
    const rows = [row()];
    expect(daysInMonth("2026-09-10")).toBe(30);
    expect(dailySalesTarget(rows, "2026-09-10", all)).toBeCloseTo(1150, 6);
    expect(dailySalesTarget(rows, "2026-10-10", all)).toBeCloseTo(1112.903, 3);
    expect(
      Math.round(dailySalesTarget(rows, "2026-10-10", all)! * 100) / 100
    ).toBe(1112.9);
  });
  it("weighted: the days of the month add up to the monthly target exactly", () => {
    const weights = roundWeights([0.1, 0.1, 0.1, 0.12, 0.18, 0.22, 0.18]);
    const rows = [row({ weekday_weights: weights })];
    for (const month of ["2026-09", "2026-10", "2026-02"]) {
      const total = eachDay(
        `${month}-01`,
        `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}`
      )
        .map((d) => dailySalesTarget(rows, d, all)!)
        .reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(34500, 6);
    }
    // A Saturday is worth more than a Monday.
    expect(dailySalesTarget(rows, "2026-10-10", all)!).toBeGreaterThan(
      dailySalesTarget(rows, "2026-10-05", all)!
    );
    expect(weekdayIndex("2026-10-10")).toBe(5);
  });
  it("the period target is the sum of its days; a period with a day without a target has none", () => {
    const rows = [row({ effective_from: "2026-10-01" })];
    const oct = periodSalesTarget(rows, "2026-10-01", "2026-10-31", all)!;
    expect(oct).toBeCloseTo(34500, 6);
    expect(periodSalesTarget(rows, "2026-09-28", "2026-10-03", all)).toBeNull(); // never padded with 0
  });
});

describe("which row applies", () => {
  it("a target set on 1 Oct does not change September", () => {
    const rows = [
      row({ target_value: 30000, effective_from: "2026-01-01" }),
      row({ target_value: 34500, effective_from: "2026-10-01" }),
    ];
    expect(dailySalesTarget(rows, "2026-09-15", all)).toBeCloseTo(
      30000 / 30,
      6
    );
    expect(dailySalesTarget(rows, "2026-10-15", all)).toBeCloseTo(
      34500 / 31,
      6
    );
    expect(dailySalesTarget(rows, "2026-10-01", all)).toBeCloseTo(
      34500 / 31,
      6
    ); // from that very day
  });
  it("a restaurant's own target overrides the company-wide one for that restaurant", () => {
    const rows = [
      row({ target_value: 31000 }),
      row({ target_value: 15000, location_id: "r1" }),
    ];
    expect(
      dailySalesTarget(rows, "2026-09-10", {
        locationId: "r1",
        restaurantIds: ["r1", "r2"],
      })
    ).toBeCloseTo(15000 / 30, 6);
    expect(dailySalesTarget(rows, "2026-09-10", all)).toBeCloseTo(
      31000 / 30,
      6
    );
  });
  it("a company-wide SALES target is not split per restaurant", () => {
    const rows = [row()];
    expect(
      dailySalesTarget(rows, "2026-09-10", {
        locationId: "r2",
        restaurantIds: ["r1", "r2"],
      })
    ).toBeNull();
  });
  it("Todos adds up per-restaurant targets only when every restaurant has one", () => {
    const some = [row({ location_id: "r1", target_value: 15000 })];
    expect(dailySalesTarget(some, "2026-09-10", all)).toBeNull();
    const both = [...some, row({ location_id: "r2", target_value: 9000 })];
    expect(dailySalesTarget(both, "2026-09-10", all)).toBeCloseTo(
      24000 / 30,
      6
    );
  });
  it("a company-wide row is what Todos shows, even if restaurants have their own", () => {
    const rows = [
      row({ target_value: 40000 }),
      row({ location_id: "r1", target_value: 15000 }),
    ];
    expect(dailySalesTarget(rows, "2026-09-10", all)).toBeCloseTo(
      40000 / 30,
      6
    );
  });
  it("a missing target is no target — never 0", () => {
    expect(dailySalesTarget([], "2026-09-10", all)).toBeNull();
    expect(pickTargetRow([], "food_cost_pct", "2026-09-10", null)).toBeNull();
    expect(levelTarget([], "food_cost_pct", "2026-09-10", null)).toBeNull();
    // A target that starts later has not started yet.
    expect(
      dailySalesTarget(
        [row({ effective_from: "2026-11-01" })],
        "2026-09-10",
        all
      )
    ).toBeNull();
  });
  it("clearing a target (an inactive row from a day) stops it from that day, not before", () => {
    const rows = [
      row(),
      row({ effective_from: "2026-10-01", is_active: false, target_value: 0 }),
    ];
    expect(dailySalesTarget(rows, "2026-09-10", all)).toBeCloseTo(
      34500 / 30,
      6
    );
    expect(dailySalesTarget(rows, "2026-10-10", all)).toBeNull();
  });
});

describe("levels (food cost %, margin %, ticket)", () => {
  const rows = [
    row({ metric_key: "food_cost_pct", target_value: 32 }),
    row({ metric_key: "food_cost_pct", target_value: 30, location_id: "r1" }),
    row({ metric_key: "gross_margin_pct", target_value: 68 }),
  ];
  it("a company-wide level applies to each restaurant; its own row wins", () => {
    expect(levelTarget(rows, "food_cost_pct", "2026-09-10", null)).toBe(32);
    expect(levelTarget(rows, "food_cost_pct", "2026-09-10", "r1")).toBe(30);
    expect(levelTarget(rows, "food_cost_pct", "2026-09-10", "r2")).toBe(32);
    expect(levelTarget(rows, "gross_margin_pct", "2026-09-10", "r1")).toBe(68);
  });
  it("Todos never averages the restaurants' own levels", () => {
    const own = [
      row({ metric_key: "food_cost_pct", target_value: 30, location_id: "r1" }),
    ];
    expect(levelTarget(own, "food_cost_pct", "2026-09-10", null)).toBeNull();
  });
});

describe("rows from the old Ventas editor still load", () => {
  it("a pre-052 daily row (no effective_from, no location) is valid for all history", () => {
    const legacy = toTargetRow({
      metric_key: "revenue",
      target_value: "20000.0000",
      target_period: "daily",
      is_active: true,
    })!;
    expect(legacy.effective_from).toBe("1900-01-01");
    expect(legacy.location_id).toBeNull();
    expect(dailySalesTarget([legacy], "2024-03-05", all)).toBe(20000);
    expect(dailySalesTarget([legacy], "2026-10-15", all)).toBe(20000);
    expect(periodSalesTarget([legacy], "2026-10-01", "2026-10-07", all)).toBe(
      140000
    );
  });
  it("a newer monthly row replaces it from its date; before that the old daily one holds", () => {
    const legacy = toTargetRow({
      metric_key: "revenue",
      target_value: 1000,
      target_period: "daily",
    })!;
    const rows = [
      legacy,
      row({ effective_from: "2026-10-01", target_value: 31000 }),
    ];
    expect(dailySalesTarget(rows, "2026-09-30", all)).toBe(1000);
    expect(dailySalesTarget(rows, "2026-10-01", all)).toBeCloseTo(1000, 6); // 31,000 / 31 days
    expect(dailySalesTarget(rows, "2026-10-01", all)).toBeCloseTo(
      31000 / 31,
      6
    );
  });
  it("bad rows are dropped, not turned into 0", () => {
    expect(toTargetRow({ metric_key: "bogus", target_value: 1 })).toBeNull();
    expect(toTargetRow({ metric_key: "revenue", target_value: -5 })).toBeNull();
    expect(
      toTargetRow({ metric_key: "revenue", target_value: "abc" })
    ).toBeNull();
  });
});

describe("the weekday split", () => {
  const daily = eachDay("2026-04-01", "2026-09-30").map((date) => ({
    date,
    net_sales: [820, 900, 900, 1050, 1400, 1650, 1330][weekdayIndex(date)],
  }));
  it("suggests the shares of the average day of each weekday", () => {
    const w = suggestWeekdayWeights(daily)!;
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(w[5] / w[0]).toBeCloseTo(1650 / 820, 6);
  });
  it("no split from too little data (a weekday never seen)", () => {
    expect(suggestWeekdayWeights(daily.slice(0, 5))).toBeNull();
  });
  it("amounts per weekday add up to about the monthly target and round-trip to weights", () => {
    const w = suggestWeekdayWeights(daily)!;
    const amounts = weekdayAmounts(34500, w);
    expect(amounts.reduce((a, b) => a + b, 0) * (365.25 / 12 / 7)).toBeCloseTo(
      34500,
      4
    );
    const back = weightsFromAmounts(amounts)!;
    back.forEach((x, i) => expect(x).toBeCloseTo(w[i], 9));
    expect(weightsFromAmounts([0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(weightsFromAmounts([1, 2, -1, 1, 1, 1, 1])).toBeNull();
  });
  it("stored weights are validated and rounded to sum exactly 1", () => {
    expect(parseWeights([1, 0, 0, 0, 0, 0, 0])).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(parseWeights([0.5, 0.5])).toBeNull();
    expect(parseWeights([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2])).toBeNull();
    const r = roundWeights(suggestWeekdayWeights(daily)!);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(parseWeights(r)).not.toBeNull();
  });
});

import { objetivosReferences } from "@/lib/restaurant/objetivos-references";

describe("the reference column is real data or nothing", () => {
  it("no sales → every reference is null, nothing invented", () => {
    const r = objetivosReferences([], "2026-10-15");
    expect(r).toMatchObject({
      refDay: null,
      avgMonthly6: null,
      ticket30: null,
      suggestedWeights: null,
    });
  });
  it("an average month is the daily average × 30.44; the note says when the data is short", () => {
    const daily = eachDay("2026-07-01", "2026-10-14").map((date) => ({
      date,
      net_sales: 1000,
      tickets: 50,
    }));
    const r = objetivosReferences(daily, "2026-10-15");
    expect(r.refDay).toBe("2026-10-14");
    expect(r.firstDay).toBe("2026-07-01");
    expect(r.avgMonthly6).toBeCloseTo(1000 * (365.25 / 12), 6);
    expect(r.span6Note).toBe("solo 3 meses de datos");
    expect(r.ticket30).toBe(20);
    expect(r.suggestedWeights).not.toBeNull();
  });
  it("sales after today are ignored; no tickets → no average ticket", () => {
    const daily = [
      ...eachDay("2026-10-01", "2026-10-10").map((date) => ({
        date,
        net_sales: 100,
      })),
      { date: "2026-12-01", net_sales: 99999 },
    ];
    const r = objetivosReferences(daily, "2026-10-15");
    expect(r.refDay).toBe("2026-10-10");
    expect(r.ticket30).toBeNull();
  });
});

import { explainMissingSalesTarget } from "@/lib/restaurant/objetivos";

describe("why a goal is not drawn", () => {
  const julyDays = eachDay("2026-07-01", "2026-07-31");
  it("a goal that starts after the days shown says when it starts", () => {
    const g = explainMissingSalesTarget(
      [row({ effective_from: "2026-10-01" })],
      all,
      julyDays
    );
    expect(g).toEqual({ reason: "starts_later", from: "2026-10-01" });
  });
  it("a company-wide sales goal is not drawn for one restaurant, and says so", () => {
    const g = explainMissingSalesTarget(
      [row()],
      { locationId: "r1", restaurantIds: ["r1", "r2"] },
      julyDays
    );
    expect(g).toEqual({ reason: "company_only" });
  });
  it("no goals at all → none; a goal that applies → nothing to explain", () => {
    expect(explainMissingSalesTarget([], all, julyDays)).toEqual({
      reason: "none",
    });
    expect(explainMissingSalesTarget([row()], all, julyDays)).toBeNull();
  });
});
