// R1-16: Cockpit arithmetic. Synthetic numbers only.
import { describe, expect, it } from "vitest";
import {
  dataSpanNote,
  daysBetween,
  indexByDate,
  pctChange,
  previousMonthRange,
  previousWeekRange,
  ptsChange,
  ratioOfSums,
  subMonths,
  trailingWindow,
  windowSales,
  eachDay,
  weekdayIndex,
} from "@/lib/restaurant/cockpit-math";

const series = (from: string, values: number[]) =>
  values.map((v, i) => ({
    date: eachDay(from, "2099-01-01").slice(0, values.length)[i],
    net_sales: v,
  }));

describe("trailing average daily sales", () => {
  it("10 days of 100 + 2 zero days in a 12-day window → 83.33", () => {
    const daily = series(
      "2026-09-01",
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    );
    // Sep 11 and Sep 12 are closed days: no row at all.
    const w = windowSales(
      indexByDate(daily),
      "2026-09-01",
      "2026-09-12",
      "2026-09-01"
    );
    expect(w.days).toBe(12);
    expect(w.avg).toBeCloseTo(83.3333, 4);
    expect(Math.round(w.avg! * 100) / 100).toBe(83.33);
  });
  it("an explicit zero-sales row counts the same as a missing day", () => {
    const daily = series("2026-09-01", [100, 0, 100]);
    expect(
      windowSales(indexByDate(daily), "2026-09-01", "2026-09-03").avg
    ).toBeCloseTo(200 / 3, 9);
  });
  it("days before the first POS day do not count: the window is cut to the data", () => {
    const daily = series("2026-09-01", [100, 100, 100, 100]);
    const w = windowSales(
      indexByDate(daily),
      "2026-08-01",
      "2026-09-04",
      "2026-09-01"
    );
    expect(w.from).toBe("2026-09-01");
    expect(w.days).toBe(4);
    expect(w.avg).toBe(100);
  });
  it("N months ending yesterday, cut to the data start, with an honest note", () => {
    expect(trailingWindow("2026-10-14", 6, "2025-01-01")).toMatchObject({
      from: "2026-04-15",
      to: "2026-10-14",
      cut: false,
    });
    const cut = trailingWindow("2026-10-14", 6, "2026-06-20");
    expect(cut).toMatchObject({ from: "2026-06-20", cut: true });
    expect(dataSpanNote(cut)).toBe("solo 3 meses de datos");
    expect(
      dataSpanNote(trailingWindow("2026-10-14", 3, "2026-07-01"))
    ).toBeNull();
    expect(dataSpanNote(trailingWindow("2026-10-14", 6, "2026-10-01"))).toBe(
      "solo 14 días de datos"
    );
  });
  it("months back clamp the day (31 Mar − 1 month is the end of February)", () => {
    expect(subMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(subMonths("2024-03-31", 1)).toBe("2024-02-29");
    expect(subMonths("2026-01-15", 2)).toBe("2025-11-15");
  });
});

describe("percent KPIs are ratios of sums", () => {
  it("food cost % = Σcost ÷ Σsales, which differs from the average of daily %", () => {
    const days = [
      { cost: 10, sales: 100 },
      { cost: 50, sales: 200 },
      { cost: 90, sales: 100 },
    ];
    const sumCost = days.reduce((a, d) => a + d.cost, 0);
    const sumSales = days.reduce((a, d) => a + d.sales, 0);
    const ratio = ratioOfSums(sumCost, sumSales)!;
    const avgOfPct =
      days.reduce((a, d) => a + (d.cost / d.sales) * 100, 0) / days.length;
    expect(ratio).toBeCloseTo(37.5, 9);
    expect(avgOfPct).toBeCloseTo(41.6667, 4);
    expect(ratio).not.toBeCloseTo(avgOfPct, 1);
  });
  it("no sales → no percentage (never 0 or NaN); changes are in points and percent", () => {
    expect(ratioOfSums(0, 0)).toBeNull();
    expect(ptsChange(34, 32)).toBe(2);
    expect(ptsChange(null, 32)).toBeNull();
    expect(pctChange(1273, 1052)).toBe(21);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(null, 10)).toBeNull();
  });
});

describe("aligned comparisons", () => {
  it("this week Mon–Wed compares only with last Mon–Wed", () => {
    const thisWeek = { from: "2026-10-12", to: "2026-10-14" }; // Mon–Wed
    expect(weekdayIndex(thisWeek.from)).toBe(0);
    const last = previousWeekRange(thisWeek);
    expect(last).toEqual({ from: "2026-10-05", to: "2026-10-07" });
    expect(daysBetween(last.from, last.to)).toBe(3);
    // And a full week is never compared with a partial one:
    const month = previousMonthRange(thisWeek);
    expect(daysBetween(month.from, month.to)).toBe(3);
    expect(weekdayIndex(month.from)).toBe(0);
    expect(month).toEqual({ from: "2026-09-14", to: "2026-09-16" }); // four weeks earlier
  });
  it("30 d vs the 30 d before", () => {
    const cur = { from: "2026-09-15", to: "2026-10-14" };
    expect(daysBetween(cur.from, cur.to)).toBe(30);
    expect(previousMonthRange(cur)).toEqual({
      from: "2026-08-16",
      to: "2026-09-14",
    });
  });
  it("the same range keeps its length and weekdays when shifted a week", () => {
    const r = { from: "2026-10-01", to: "2026-10-30" };
    const w = previousWeekRange(r);
    expect(daysBetween(w.from, w.to)).toBe(30);
    expect(weekdayIndex(w.from)).toBe(weekdayIndex(r.from));
  });
});
