import { describe, it, expect } from "vitest";
import {
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  defaultPageDateRange,
  formatPageDateRangeLabel,
  hasExplicitPageDateRange,
  parsePageDateRange,
} from "@/lib/restaurant/page-date-range";

describe("page date range params (#128)", () => {
  it("defaults to the calendar month of the given date", () => {
    expect(defaultPageDateRange(new Date(2026, 6, 11))).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("reads valid from/to query params", () => {
    const params = new URLSearchParams("from=2026-07-01&to=2026-07-31");
    expect(parsePageDateRange(params)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(hasExplicitPageDateRange(params)).toBe(true);
  });

  it("falls back to the default month when params are missing or invalid", () => {
    const now = new Date(2026, 9, 11);
    expect(parsePageDateRange(new URLSearchParams(), now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(
      parsePageDateRange(new URLSearchParams("from=nope&to=2026-07-31"), now)
    ).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(hasExplicitPageDateRange(new URLSearchParams())).toBe(false);
  });

  it("swaps an inverted range instead of throwing", () => {
    const params = new URLSearchParams("from=2026-07-31&to=2026-07-01");
    expect(parsePageDateRange(params)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("formats like Jul 1 - Jul 31, 2026", () => {
    const label = formatPageDateRangeLabel(
      { from: "2026-07-01", to: "2026-07-31" },
      "en-US"
    );
    expect(label.replace(/\u00a0/g, " ")).toBe("Jul 1 - Jul 31, 2026");
    expect(DATE_FROM_PARAM).toBe("from");
    expect(DATE_TO_PARAM).toBe("to");
  });
});
