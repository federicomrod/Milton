import { describe, expect, it } from "vitest";
import {
  estimateLabelWidth,
  fitFontSize,
  selectTicks,
  type Tick,
} from "@/lib/restaurant/ui/axis-ticks";
import { addDays } from "@/lib/restaurant/cockpit-math";
import { dayLabelEs } from "@/components/restaurant/sales/detail/format";

const FS = 10.5;
const PADL = 8;

function run(count: number, width: number, start = "2026-09-26", fs = FS) {
  const slot = (width - 2 * PADL) / Math.max(count, 1);
  const labels = Array.from({ length: count }, (_, i) =>
    dayLabelEs(addDays(start, i))
  );
  const ticks = selectTicks({
    count,
    positionOf: (i) => PADL + slot * i + slot / 2,
    labelOf: (i) => labels[i],
    width,
    fontSize: fs,
  });
  return { ticks, labels };
}

function box(t: Tick, fs = FS) {
  const w = estimateLabelWidth(t.label, fs);
  if (t.anchor === "start") return [t.x, t.x + w];
  if (t.anchor === "end") return [t.x - w, t.x];
  return [t.x - w / 2, t.x + w / 2];
}

function expectClean(ticks: Tick[], width: number, count: number, gap = 8) {
  for (let i = 0; i < ticks.length; i++) {
    const [l, r] = box(ticks[i]);
    expect(l).toBeGreaterThanOrEqual(-1e-6);
    expect(r).toBeLessThanOrEqual(width + 1e-6);
    if (i > 0)
      expect(l - box(ticks[i - 1])[1]).toBeGreaterThanOrEqual(gap - 1e-6);
  }
  expect(ticks[ticks.length - 1].index).toBe(count - 1);
}

describe("estimateLabelWidth", () => {
  it("grows with length and font size", () => {
    expect(estimateLabelWidth("25 oct", 10)).toBeLessThan(
      estimateLabelWidth("sáb 24 oct", 10)
    );
    expect(estimateLabelWidth("abc", 10)).toBeLessThan(
      estimateLabelWidth("abc", 12)
    );
  });
});

describe("selectTicks", () => {
  it("regression: 30 days at 640px never prints «sáb 24 oct» next to «dom 25 oct»", () => {
    const { ticks, labels } = run(30, 640);
    expect(ticks[0].index).toBe(0);
    expect(ticks[ticks.length - 1].label).toBe("dom 25 oct");
    expect(labels[28]).toBe("sáb 24 oct");
    expect(ticks.map((t) => t.label)).not.toContain("sáb 24 oct");
    expectClean(ticks, 640, 30);
  });
  it("31 and 90 days are clean at 640 and 900px", () => {
    for (const n of [31, 90])
      for (const w of [640, 900]) expectClean(run(n, w).ticks, w, n);
  });
  it("7 days show all seven at 640px and stay clean at 320px", () => {
    expect(run(7, 640).ticks).toHaveLength(7);
    expectClean(run(7, 320).ticks, 320, 7);
  });
  it("1 day and 0 days", () => {
    expect(run(1, 640).ticks).toHaveLength(1);
    expect(run(0, 640).ticks).toEqual([]);
  });
  it("narrow screens stay clean", () => {
    expectClean(run(30, 360).ticks, 360, 30);
    expectClean(run(30, 280).ticks, 280, 30);
    expectClean(run(90, 320).ticks, 320, 90);
  });
  it("very narrow: only the last, anchored end", () => {
    const { ticks } = run(30, 60);
    expect(ticks).toHaveLength(1);
    expect(ticks[0].index).toBe(29);
    expect(ticks[0].anchor).toBe("end");
    expect(ticks[0].x).toBe(60);
  });
  it("anchors at the edges", () => {
    const { ticks } = run(30, 640);
    expect(ticks[0].anchor).toBe("start");
    expect(ticks[0].x).toBe(0);
    const t = selectTicks({
      count: 3,
      positionOf: (i) => [300, 400, 638][i],
      labelOf: () => "25 oct",
      width: 640,
      fontSize: FS,
    });
    expect(t[t.length - 1].anchor).toBe("end");
    expect(t[t.length - 1].x).toBe(640);
    expect(t[1].anchor).toBe("middle");
  });
  it("is deterministic", () => {
    expect(run(45, 500)).toEqual(run(45, 500));
  });
  it("property: any count/width has no overlaps, stays inside, keeps the last", () => {
    for (let n = 1; n <= 120; n++)
      for (const w of [240, 320, 360, 480, 640, 900, 1200])
        expectClean(run(n, w).ticks, w, n);
  });
});

describe("fitFontSize", () => {
  it("a long total gets a smaller font than a short one, never below the minimum", () => {
    const short = fitFontSize("$12,345", 80, 17, 12, 0.62);
    const long = fitFontSize("$1,234,567", 80, 17, 12, 0.62);
    expect(long).toBeLessThan(short);
    expect(short).toBe(17);
    expect(fitFontSize("$123,456,789,012", 80, 17, 12, 0.62)).toBe(12);
  });
});
