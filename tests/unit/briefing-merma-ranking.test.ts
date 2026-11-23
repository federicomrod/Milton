// tests/unit/briefing-merma-ranking.test.ts
//
// Issue #532: query and ranking logic for top 3 merma (waste) items. Tests
// production helpers rankTopMermaItems and mermaReportWindow with realistic data.

import { describe, it, expect } from "vitest";
import {
  rankTopMermaItems,
  mermaReportWindow,
  type RawMermaLine,
} from "@/lib/restaurant/briefing-context";

describe("rankTopMermaItems — production helper (#532)", () => {
  it("ranks items by summed value descending and returns top 3", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Tomate",
        value: 150,
        resolved_name: "Tomate roma",
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "Aguacate",
        value: 300,
        resolved_name: "Aguacate hass",
      },
      {
        ingredient_id: "ing-3",
        component_id: null,
        item_name: "Pollo",
        value: 500,
        resolved_name: "Pollo crudo",
      },
      {
        ingredient_id: "ing-4",
        component_id: null,
        item_name: "Cebolla",
        value: 50,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-5",
        component_id: null,
        item_name: "Lechuga",
        value: 25,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      item_name: "Pollo",
      value: 500,
      resolved_name: "Pollo crudo",
    });
    expect(result[1]).toEqual({
      item_name: "Aguacate",
      value: 300,
      resolved_name: "Aguacate hass",
    });
    expect(result[2]).toEqual({
      item_name: "Tomate",
      value: 150,
      resolved_name: "Tomate roma",
    });
  });

  it("aggregates same ingredient across multiple reports", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Tomate",
        value: 100,
        resolved_name: "Tomate roma",
      },
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Tomate",
        value: 150,
        resolved_name: "Tomate roma",
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "Aguacate",
        value: 200,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item_name: "Tomate",
      value: 250, // 100 + 150
      resolved_name: "Tomate roma",
    });
    expect(result[1]).toEqual({
      item_name: "Aguacate",
      value: 200,
      resolved_name: null,
    });
  });

  it("groups by ingredient_id when available, falls back to component_id then item_name", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Tomate",
        value: 100,
        resolved_name: "Tomate roma",
      },
      {
        ingredient_id: null,
        component_id: "comp-1",
        item_name: "Salsa verde",
        value: 200,
        resolved_name: "Salsa verde preparada",
      },
      {
        ingredient_id: null,
        component_id: null,
        item_name: "Pan sin mapear",
        value: 50,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(3);
    // Sorted by value: Salsa (200), Tomate (100), Pan (50)
    expect(result[0].item_name).toBe("Salsa verde");
    expect(result[1].item_name).toBe("Tomate");
    expect(result[2].item_name).toBe("Pan sin mapear");
  });

  it("filters out non-positive values (zero, negative)", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Valid",
        value: 100,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "Zero",
        value: 0,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-3",
        component_id: null,
        item_name: "Negative",
        value: -50,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-4",
        component_id: null,
        item_name: "Valid2",
        value: 200,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0].item_name).toBe("Valid2");
    expect(result[1].item_name).toBe("Valid");
  });

  it("filters out non-finite values (NaN, Infinity)", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Valid",
        value: 100,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "NaN",
        value: NaN,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-3",
        component_id: null,
        item_name: "Infinity",
        value: Infinity,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-4",
        component_id: null,
        item_name: "Valid2",
        value: 200,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0].item_name).toBe("Valid2");
    expect(result[1].item_name).toBe("Valid");
  });

  it("displays resolved_name when available, item_name as fallback", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "tomate",
        value: 100,
        resolved_name: "Tomate roma",
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "aguacate",
        value: 200,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0].resolved_name).toBe(null); // aguacate (highest value)
    expect(result[0].item_name).toBe("aguacate");
    expect(result[1].resolved_name).toBe("Tomate roma");
    expect(result[1].item_name).toBe("tomate");
  });

  it("returns empty array when all values are filtered out", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Zero",
        value: 0,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "Negative",
        value: -100,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toEqual([]);
  });

  it("returns empty array when input is empty", () => {
    const result = rankTopMermaItems([]);
    expect(result).toEqual([]);
  });

  it("rounds values to integers", () => {
    const lines: RawMermaLine[] = [
      {
        ingredient_id: "ing-1",
        component_id: null,
        item_name: "Fractional",
        value: 100.7,
        resolved_name: null,
      },
      {
        ingredient_id: "ing-2",
        component_id: null,
        item_name: "Another",
        value: 50.4,
        resolved_name: null,
      },
    ];

    const result = rankTopMermaItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(101); // rounds 100.7
    expect(result[1].value).toBe(50); // rounds 50.4
  });
});

describe("mermaReportWindow — date window helper (#532)", () => {
  it("computes [today-7, today) window in company timezone", () => {
    // Company timezone: America/El_Salvador (UTC-6)
    const now = new Date("2026-11-23T10:00:00-06:00"); // 10 AM El Salvador time
    const timezone = "America/El_Salvador";

    const window = mermaReportWindow(now, timezone);

    expect(window.from).toBe("2026-11-16");
    expect(window.to).toBe("2026-11-23");
    // Window is [2026-11-16, 2026-11-23) — today excluded
    // Valid dates: 2026-11-16 through 2026-11-22
  });

  it("handles UTC vs company timezone disagreement on date boundaries", () => {
    // 2 AM UTC on 2026-11-23 is still 2026-11-22 in El Salvador (UTC-6)
    const nowUtc = new Date("2026-11-23T02:00:00Z");
    const timezone = "America/El_Salvador";

    const window = mermaReportWindow(nowUtc, timezone);

    expect(window.to).toBe("2026-11-22"); // Still 2026-11-22 in El Salvador
    expect(window.from).toBe("2026-11-15"); // 7 days before

    // Window is [2026-11-15, 2026-11-22) in El Salvador time
    // A line with report_date 2026-11-22 would be excluded (today in that TZ)
  });

  it("confirms today is excluded from the window (< not <=)", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    const timezone = "UTC";

    const window = mermaReportWindow(now, timezone);

    expect(window.from).toBe("2026-11-16");
    expect(window.to).toBe("2026-11-23");

    // loadTopMermaItems uses .lt(window.to), so report_date must be < "2026-11-23"
    // This means 2026-11-23 is excluded, 2026-11-22 is included
  });

  it("works across month boundaries", () => {
    const now = new Date("2026-12-03T12:00:00Z");
    const timezone = "UTC";

    const window = mermaReportWindow(now, timezone);

    expect(window.from).toBe("2026-11-26"); // 7 days ago crosses into November
    expect(window.to).toBe("2026-12-03");
  });

  it("works with different timezones", () => {
    // Same UTC moment in different timezones
    const nowUtc = new Date("2026-11-23T06:00:00Z");

    // Asia/Tokyo is UTC+9, so 6 AM UTC = 3 PM Tokyo = still Nov 23
    const tokyoWindow = mermaReportWindow(nowUtc, "Asia/Tokyo");
    expect(tokyoWindow.to).toBe("2026-11-23");
    expect(tokyoWindow.from).toBe("2026-11-16");

    // America/Los_Angeles is UTC-8, so 6 AM UTC = 10 PM Nov 22
    const laWindow = mermaReportWindow(nowUtc, "America/Los_Angeles");
    expect(laWindow.to).toBe("2026-11-22");
    expect(laWindow.from).toBe("2026-11-15");
  });
});
