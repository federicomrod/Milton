// R1-16b: the Cockpit v2 computation. Synthetic numbers only.
import { describe, expect, it } from "vitest";
import {
  computeCockpit,
  periodRange,
  weekLabel,
  NO_CATEGORY,
  type CockpitInput,
  type MixDayRow,
} from "@/lib/restaurant/cockpit-v2";
import { eachDay, weekdayIndex } from "@/lib/restaurant/cockpit-math";
import type { TargetRow } from "@/lib/restaurant/objetivos";

const REF = "2026-10-14"; // a Wednesday
const FIRST = "2025-09-01";
const daily = eachDay(FIRST, REF).map((date) => ({ date, net_sales: 1000 }));
const scope = { locationId: null, restaurantIds: ["r1", "r2"] };
const target = (
  metric: TargetRow["metric_key"],
  value: number,
  over: Partial<TargetRow> = {}
): TargetRow => ({
  metric_key: metric,
  target_period: "monthly",
  target_value: value,
  location_id: null,
  effective_from: "2025-01-01",
  is_active: true,
  weekday_weights: null,
  ...over,
});
const base: CockpitInput = {
  daily,
  refDay: REF,
  today: "2026-10-15",
  firstDay: FIRST,
  period: "30d",
  comparison: "months_6",
  targets: [],
  scope,
  costRows: null,
  category: null,
};
const view = (over: Partial<CockpitInput> = {}) =>
  computeCockpit({ ...base, ...over });

describe("periods", () => {
  it("Hoy is the reference day; 7 d, 30 d and Trimestre end on it", () => {
    expect(periodRange("hoy", REF)).toEqual({ from: REF, to: REF });
    expect(periodRange("7d", REF)).toEqual({ from: "2026-10-08", to: REF });
    expect(periodRange("30d", REF).from).toBe("2026-09-15");
    expect(periodRange("trimestre", REF).from).toBe("2026-07-17");
  });
});

describe("the average day and its comparisons", () => {
  it("a flat series is flat against every baseline (no colour, no fake swing)", () => {
    const v = view();
    expect(v.avgDaily).toBe(1000);
    expect(v.sales).toBe(30000);
    for (const c of v.avgChips) {
      expect(c.value).toBe(0);
      expect(c.tone).toBe("flat");
    }
  });
  it("above the 6-month average is green, below is red; small moves stay flat", () => {
    const up = eachDay(FIRST, REF).map((date) => ({
      date,
      net_sales: date >= "2026-09-15" ? 1500 : 1000,
    }));
    const v = view({ daily: up, comparison: "months_3" });
    const chip = v.avgChips.find((c) => c.key === "baseline")!;
    expect(chip.value).toBeGreaterThan(2);
    expect(chip.tone).toBe("good");
    const down = eachDay(FIRST, REF).map((date) => ({
      date,
      net_sales: date >= "2026-09-15" ? 500 : 1000,
    }));
    expect(
      view({ daily: down }).avgChips.find((c) => c.key === "baseline")!.tone
    ).toBe("bad");
    const tiny = eachDay(FIRST, REF).map((date) => ({
      date,
      net_sales: date >= "2026-09-15" ? 1010 : 1000,
    }));
    expect(
      view({ daily: tiny }).avgChips.find((c) => c.key === "month")!.tone
    ).toBe("flat");
  });
  it("the selected comparison is not repeated as a second chip", () => {
    expect(
      view({ comparison: "last_week" }).avgChips.map((c) => c.key)
    ).toEqual(["baseline", "month"]);
    expect(
      view({ comparison: "last_month" }).avgChips.map((c) => c.key)
    ).toEqual(["baseline", "week"]);
    expect(view({ comparison: "months_6" }).avgChips.map((c) => c.key)).toEqual(
      ["baseline", "month", "week"]
    );
  });
  it("when the data is short the trailing window is cut and says so; a shifted window before the data is not shown", () => {
    const short = eachDay("2026-08-01", REF).map((date) => ({
      date,
      net_sales: 1000,
    }));
    const v = view({
      daily: short,
      firstDay: "2026-08-01",
      comparison: "months_6",
      period: "trimestre",
    });
    expect(v.baselineNote).toBe("solo 2 meses de datos");
    // The trimestre starts before the data: the previous 90 days do not exist, so no "mes pasado" chip.
    expect(v.avgChips.some((c) => c.key === "month")).toBe(false);
  });
  it("Hoy compares with the same weekday last week, never a different day", () => {
    const d = eachDay(FIRST, REF).map((date) => ({
      date,
      net_sales: weekdayIndex(date) === 2 ? 2000 : 1000,
    }));
    const v = view({ daily: d, period: "hoy" });
    expect(v.avgDaily).toBe(2000);
    expect(v.avgChips.find((c) => c.key === "week")!.value).toBe(0); // Wed vs last Wed
  });
  it("zero-sales days count: a closed day lowers the average", () => {
    const d = eachDay(FIRST, REF)
      .filter((x) => x !== "2026-10-13")
      .map((date) => ({ date, net_sales: 1000 }));
    expect(view({ daily: d, period: "7d" }).avgDaily).toBeCloseTo(6000 / 7, 6);
  });
});

describe("targets", () => {
  it("no target → no chip, no line, never 0", () => {
    const v = view();
    expect(v.salesTarget).toBeNull();
    expect(v.avgChips.some((c) => c.key === "target")).toBe(false);
    expect(v.salesChips.some((c) => c.key === "target")).toBe(false);
    expect(v.bars.every((b) => b.target === null && b.above === null)).toBe(
      true
    );
    expect(v.aboveDays + v.belowDays).toBe(0);
  });
  it("bars at or above the target are above, below are below; the counts match", () => {
    const d = eachDay(FIRST, REF).map((date) => ({
      date,
      net_sales: weekdayIndex(date) >= 4 ? 1500 : 800,
    }));
    const v = view({ daily: d, targets: [target("revenue", 31000)] }); // ≈ 1,000 a day
    const target0 = v.bars[0].target!;
    expect(target0).toBeGreaterThan(900);
    for (const b of v.bars) expect(b.above).toBe(b.sales >= b.target!);
    expect(v.aboveDays).toBe(
      v.bars.filter((b) => weekdayIndex(b.date) >= 4).length
    );
    expect(v.aboveDays + v.belowDays).toBe(v.bars.length);
    expect(v.salesTarget).toBeGreaterThan(0);
  });
  it("a target that starts mid-chart only draws from its day", () => {
    const v = view({
      targets: [target("revenue", 31000, { effective_from: "2026-10-01" })],
      period: "30d",
    });
    expect(v.bars.find((b) => b.date === "2026-09-20")!.target).toBeNull();
    expect(v.bars.find((b) => b.date === "2026-10-10")!.target).not.toBeNull();
    expect(v.salesTarget).toBeNull(); // the 30 d period is not fully covered: no period chip rather than a padded one
  });
});

describe("cost and margin", () => {
  const rows: MixDayRow[] = eachDay(FIRST, REF).flatMap((date) => [
    { date, category: "Churrascos", net: 600, cost: 180, covered_net: 600 },
    { date, category: "Bebidas", net: 300, cost: 60, covered_net: 300 },
    { date, category: NO_CATEGORY, net: 100, cost: 0, covered_net: 0 },
  ]);
  it("food cost % is Σcost ÷ Σcovered sales, and the coverage is stated", () => {
    const v = view({
      costRows: rows,
      targets: [target("food_cost_pct", 25), target("gross_margin_pct", 75)],
    });
    expect(v.cost!.food_cost_pct).toBeCloseTo((240 / 900) * 100, 6);
    expect(v.cost!.coverage_pct).toBeCloseTo(90, 6);
    expect(v.cost!.margin_pct).toBeCloseTo((660 / 900) * 100, 6);
    // 26.7% is above the 25% target: cost is red (up is bad); margin below 75% is red too.
    expect(v.foodCostOverTarget).toBe(true);
    expect(v.costChips.find((c) => c.key === "target")).toMatchObject({
      tone: "bad",
      unit: "pts",
    });
    expect(v.marginChips.find((c) => c.key === "target")!.tone).toBe("bad");
  });
  it("below the cost target is good", () => {
    const v = view({ costRows: rows, targets: [target("food_cost_pct", 35)] });
    expect(v.foodCostOverTarget).toBe(false);
    expect(v.costChips.find((c) => c.key === "target")!.tone).toBe("good");
  });
  it("no cost rows yet → no cost figures and no chips; no target → no target chip", () => {
    const loading = view();
    expect(loading.cost).toBeNull();
    expect(loading.costChips).toEqual([]);
    expect(
      view({ costRows: rows }).costChips.some((c) => c.key === "target")
    ).toBe(false);
  });
  it("uncosted sales are not $0: they lower coverage, not the cost %", () => {
    const only: MixDayRow[] = eachDay(FIRST, REF).map((date) => ({
      date,
      category: NO_CATEGORY,
      net: 100,
      cost: 0,
      covered_net: 0,
    }));
    const v = view({ costRows: only });
    expect(v.cost!.food_cost_pct).toBeNull();
    expect(v.cost!.margin).toBeNull();
    expect(v.cost!.coverage_pct).toBe(0);
  });
  it("by weekday it is a ratio of sums too, with its coverage", () => {
    const v = view({ costRows: rows, targets: [target("food_cost_pct", 25)] });
    const w = v.weekdayCost[2];
    expect(w.food_cost_pct).toBeCloseTo((240 / 900) * 100, 6);
    expect(w.coverage_pct).toBeCloseTo(90, 6);
    expect(w.above).toBe(true);
  });
});

describe("the mix and the category filter", () => {
  const rows: MixDayRow[] = eachDay(FIRST, REF).flatMap((date) => [
    { date, category: "A", net: 600, cost: 300, covered_net: 600 },
    { date, category: "B", net: 300, cost: 60, covered_net: 300 },
    { date, category: NO_CATEGORY, net: 100, cost: 0, covered_net: 0 },
  ]);
  it("shares add up to 100 and Sin categoría is reported, not hidden or invented", () => {
    const v = view({ costRows: rows });
    expect(v.mix.map((m) => m.category)).toEqual(["A", "B", NO_CATEGORY]);
    expect(v.mix.reduce((s, m) => s + m.share_pct, 0)).toBeCloseTo(100, 9);
    expect(v.uncategorizedPct).toBeCloseTo(10, 9);
  });
  it("a category filters the whole page: sales, cost, the days — and the mix keeps all slices", () => {
    const v = view({ costRows: rows, category: "B" });
    expect(v.avgDaily).toBe(300);
    expect(v.cost!.food_cost_pct).toBeCloseTo(20, 9);
    expect(v.bars.every((b) => b.sales === 300)).toBe(true);
    expect(v.mix).toHaveLength(3);
  });
  it("a filter before the rows have loaded changes nothing", () => {
    expect(view({ category: "B" }).avgDaily).toBe(1000);
  });
});

describe("weeks and the empty case", () => {
  it("four weeks ending on the reference day, labelled by ISO week; a week before the data is left out", () => {
    const v = view();
    expect(v.weeks).toHaveLength(4);
    expect(v.weeks[3].to).toBe(REF);
    expect(v.weeks[3].sales).toBe(7000);
    const shortData = view({
      daily: eachDay("2026-10-01", REF).map((date) => ({
        date,
        net_sales: 1000,
      })),
      firstDay: "2026-10-01",
    });
    expect(shortData.weeks.length).toBeLessThan(4);
    expect(weekLabel("2026-10-14")).toBe("S42");
    expect(weekLabel("2026-01-01")).toBe("S1");
  });
  it("no data at all is empty, with nothing invented", () => {
    const v = view({ daily: [], firstDay: null });
    expect(v.empty).toBe(true);
    expect(v.avgDaily).toBeNull();
    expect(v.bars).toEqual([]);
    expect(v.avgChips).toEqual([]);
  });
});

describe("it is fast: changing period or comparison is just this function again (test 8)", () => {
  it("every period × comparison over two years of days recomputes in well under 100 ms", () => {
    const long = eachDay("2024-10-01", REF).map((date, i) => ({
      date,
      net_sales: 800 + (i % 7) * 100,
      tickets: 40,
    }));
    const rows: MixDayRow[] = long.flatMap((d) =>
      ["A", "B", "C", "D", NO_CATEGORY].map((category) => ({
        date: d.date,
        category,
        net: d.net_sales / 5,
        cost: d.net_sales / 15,
        covered_net: d.net_sales / 5,
      }))
    );
    const targets = [target("revenue", 31000), target("food_cost_pct", 30)];
    const worst: number[] = [];
    for (const period of ["hoy", "7d", "30d", "trimestre"] as const) {
      for (const comparison of [
        "last_week",
        "last_month",
        "months_3",
        "months_6",
        "months_12",
      ] as const) {
        const t0 = performance.now();
        computeCockpit({
          ...base,
          daily: long,
          firstDay: "2024-10-01",
          costRows: rows,
          period,
          comparison,
          targets,
        });
        worst.push(performance.now() - t0);
      }
    }
    expect(Math.max(...worst)).toBeLessThan(100);
  });
});
