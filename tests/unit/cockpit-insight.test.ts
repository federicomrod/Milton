// The Cockpit «✦ Milton» lines: deterministic, from the daily bars only.
import { describe, expect, it } from "vitest";
import {
  cockpitSummaryLines,
  NO_COCKPIT_SUMMARY,
  NO_TARGETS_SUMMARY,
} from "@/lib/restaurant/cockpit-insight";
import { eachDay } from "@/lib/restaurant/cockpit-math";

type Bar = {
  date: string;
  sales: number;
  target: number | null;
  above: boolean | null;
  deltaPct: number | null;
};

// 2026-10-05 is a Monday. Mondays sell 600 against a 1000 target; the rest 1200.
const bars = (): Bar[] =>
  eachDay("2026-10-05", "2026-10-25").map((date, i) => {
    const monday = i % 7 === 0;
    const sales = monday ? 600 : 1200;
    return {
      date,
      sales,
      target: 1000,
      above: sales >= 1000,
      deltaPct: ((sales - 1000) / 1000) * 100,
    };
  });
const view = (b: Bar[]) => ({
  bars: b,
  aboveDays: b.filter((x) => x.above === true).length,
  belowDays: b.filter((x) => x.above === false).length,
});

describe("cockpitSummaryLines", () => {
  it("names the weakest weekday against the objetivo", () => {
    const lines = cockpitSummaryLines(view(bars()), true);
    expect(lines[0]).toBe(
      "Los lunes son lo más flojo frente al objetivo (-40% en promedio)."
    );
  });
  it("counts the days below the objetivo", () => {
    expect(cockpitSummaryLines(view(bars()), true)).toContain(
      "3 de 21 días quedaron bajo el objetivo."
    );
  });
  it("says so when no day fell below, and never claims a cause", () => {
    const b = bars().map((x) => ({
      ...x,
      sales: 1200,
      above: true,
      deltaPct: 20,
    }));
    const lines = cockpitSummaryLines(view(b), true);
    expect(lines).toContain("Ningún día quedó bajo el objetivo.");
    expect(lines.join(" ")).not.toMatch(/porque|debido|culpa/i);
  });
  it("names the strongest weekday without a target too", () => {
    const b = bars().map((x, i) => ({
      ...x,
      target: null,
      above: null,
      deltaPct: null,
      sales: i % 7 === 5 ? 2000 : 1000,
    }));
    const lines = cockpitSummaryLines(view(b), false);
    expect(lines).toEqual(["Los sábados son tu día más fuerte del periodo."]);
  });
  it("never restates a number the chips or tiles show (no money, no totals)", () => {
    const text = cockpitSummaryLines(view(bars()), true).join(" ");
    expect(text).not.toMatch(/\$|vs |promedio diario|ventas del periodo/);
  });
  it("is at most 3 lines", () => {
    expect(cockpitSummaryLines(view(bars()), true).length).toBeLessThanOrEqual(
      3
    );
  });
  it("falls back to one line when there is not enough data", () => {
    const few = bars().slice(0, 2);
    expect(cockpitSummaryLines(view(few), true)).toEqual([NO_COCKPIT_SUMMARY]);
    expect(cockpitSummaryLines(view([]), false)).toEqual([NO_TARGETS_SUMMARY]);
  });
});
