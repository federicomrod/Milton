import { describe, expect, it } from "vitest";
import {
  barRatio,
  deltaOf,
  formatDay,
  formatFraction,
  formatMoney,
  formatNumber,
  formatPercent,
  initials,
  monthLabel,
  monthShort,
  shiftMonth,
} from "./format";

describe("money", () => {
  it("is formatted per language and currency, no decimals by default", () => {
    expect(formatMoney(1235, "USD", "en")).toBe("$1,235");
    expect(formatMoney(1235.4, "USD", "de")).toMatch(/1\.235\s?\$/);
    expect(formatMoney(12.5, "USD", "en", 2)).toBe("$12.50");
    // Spanish shows «$1,235» for dollars (like the web), pesos in es-MX.
    expect(formatMoney(1235, "USD", "es")).toBe("$1,235");
    expect(formatMoney(1235, "MXN", "es")).toMatch(/\$1,235/);
  });

  it("a missing value is «—», never 0", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatMoney(v as never, "USD", "es")).toBe("—");
      expect(formatNumber(v as never, "es")).toBe("—");
      expect(formatPercent(v as never, "es")).toBe("—");
      expect(formatFraction(v as never, "es")).toBe("—");
    }
    expect(formatMoney(0, "USD", "en")).toBe("$0");
  });

  it("a weird currency code falls back instead of throwing", () => {
    expect(formatMoney(5, "not a code", "en")).toBe("$5");
  });
});

describe("percentages and deltas", () => {
  it("whole percents; fractions 0–1", () => {
    expect(formatFraction(0.103, "en")).toBe("10 %");
    expect(formatPercent(12.4, "en")).toBe("12 %");
    expect(formatPercent(12.46, "en", 1)).toBe("12.5 %");
  });

  it("up is mint, down is rosa, zero and unknown are neutral", () => {
    expect(deltaOf(12.4, "en")).toEqual({ text: "+12 %", tone: "up" });
    expect(deltaOf(-3.2, "en")).toEqual({ text: "−3 %", tone: "down" });
    expect(deltaOf(0.2, "en")).toEqual({ text: "0 %", tone: "flat" });
    expect(deltaOf(null, "en")).toEqual({ text: null, tone: "flat" });
    expect(deltaOf(undefined, "es").text).toBeNull();
  });
});

describe("dates", () => {
  it("days and months do not drift with the timezone", () => {
    expect(formatDay("2026-10-30", "en")).toBe("Oct 30");
    expect(formatDay("2026-10-30", "es")).toMatch(/30/);
    expect(monthLabel("2026-10-01", "en")).toBe("October 2026");
    expect(monthLabel("2026-10", "de")).toBe("Oktober 2026");
    expect(monthShort("2026-03", "en")).toBe("Mar");
  });

  it("shifts months across a year", () => {
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
});

describe("bars and initials", () => {
  it("bar ratios stay between 0 and 1", () => {
    expect(barRatio(5, 10)).toBe(0.5);
    expect(barRatio(50, 10)).toBe(1);
    expect(barRatio(-4, 10)).toBe(0);
    expect(barRatio(4, 0)).toBe(0);
    expect(barRatio(Number.NaN, 10)).toBe(0);
  });

  it("initials of a name or an email", () => {
    expect(initials("Ana López")).toBe("AL");
    expect(initials("ana.lopez@example.test")).toBe("AL");
    expect(initials(null)).toBe("M");
  });
});
