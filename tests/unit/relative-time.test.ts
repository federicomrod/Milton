import { describe, expect, it } from "vitest";
import { historyDelta, relativeTimeText } from "@/lib/restaurant/relative-time";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTimeText", () => {
  it("minutes, hours, days, then the date", () => {
    expect(relativeTimeText(ago(5 * 60000), NOW, "es")).toBe("hace 5 minutos");
    expect(relativeTimeText(ago(3 * 3600000), NOW, "es")).toBe("hace 3 horas");
    expect(relativeTimeText(ago(24 * 3600000), NOW, "es")).toBe("ayer");
    expect(relativeTimeText(ago(3 * 86400000), NOW, "en")).toBe("3 days ago");
    expect(relativeTimeText(ago(20 * 86400000), NOW, "en")).toMatch(/Oct/);
  });
  it("an unreadable date is empty, never «Invalid Date»", () => {
    expect(relativeTimeText("nope", NOW, "es")).toBe("");
  });
});

describe("historyDelta", () => {
  it("the change when an amount moved, the value otherwise", () => {
    expect(historyDelta(1800, 2450)).toEqual({
      kind: "delta",
      sign: "+",
      abs: 650,
    });
    expect(historyDelta(2450, 1800)).toEqual({
      kind: "delta",
      sign: "-",
      abs: 650,
    });
    expect(historyDelta(0, 650)).toEqual({
      kind: "delta",
      sign: "+",
      abs: 650,
    });
    expect(historyDelta(650, 650)).toEqual({ kind: "value" });
    expect(historyDelta(null, 650)).toEqual({ kind: "value" });
  });
});
