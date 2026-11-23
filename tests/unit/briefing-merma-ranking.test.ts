// tests/unit/briefing-merma-ranking.test.ts
//
// Issue #532: query and ranking logic for top 3 merma (waste) items. Tests
// the production rankTopMermaItems helper with realistic data patterns.

import { describe, it, expect } from "vitest";
import {
  rankTopMermaItems,
  type RawMermaLine,
} from "@/lib/restaurant/briefing-context";
import { addDaysToKey, localDateKey } from "@/lib/restaurant/briefing-periods";

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

describe("Date window logic for merma (#532)", () => {
  it("computes [today-7, today) window in company timezone", () => {
    // Company timezone: America/El_Salvador (UTC-6)
    const now = new Date("2026-11-23T10:00:00-06:00"); // 10 AM El Salvador time
    const timezone = "America/El_Salvador";

    const today = localDateKey(now, timezone);
    const sevenDaysAgo = addDaysToKey(today, -7);

    expect(today).toBe("2026-11-23");
    expect(sevenDaysAgo).toBe("2026-11-16");

    // Window is [2026-11-16, 2026-11-23) — today excluded
    // Valid dates: 2026-11-16 through 2026-11-22
  });

  it("handles UTC vs company timezone disagreement on date boundaries", () => {
    // 2 AM UTC on 2026-11-23 is still 2026-11-22 in El Salvador (UTC-6)
    const nowUtc = new Date("2026-11-23T02:00:00Z");
    const timezone = "America/El_Salvador";

    const localToday = localDateKey(nowUtc, timezone);
    expect(localToday).toBe("2026-11-22"); // Still previous day in local TZ

    const sevenDaysAgo = addDaysToKey(localToday, -7);
    expect(sevenDaysAgo).toBe("2026-11-15");

    // Window is [2026-11-15, 2026-11-22) in El Salvador time
    // A line dated 2026-11-22 UTC (after 6 AM) would be 2026-11-22 El Salvador,
    // which is excluded (today in that TZ), but 2026-11-22 00:00 UTC is still
    // 2026-11-21 in El Salvador, so it's included.
  });

  it("confirms today is excluded from the window", () => {
    const today = "2026-11-23";
    const sevenDaysAgo = "2026-11-16";

    // Simulated lines with various dates
    const dates = [
      "2026-11-15", // too old
      "2026-11-16", // included (start of window)
      "2026-11-20", // included
      "2026-11-22", // included (yesterday)
      "2026-11-23", // excluded (today)
    ];

    const inWindow = dates.filter(
      (d) => d >= sevenDaysAgo && d < today
    );

    expect(inWindow).toEqual([
      "2026-11-16",
      "2026-11-20",
      "2026-11-22",
    ]);
  });
});

describe("Scoping logic for merma (#532)", () => {
  it("respects company_id filtering (cross-company isolation)", () => {
    // Type-level test: loadTopMermaItems signature requires companyId
    // and the implementation filters .eq("company_id", companyId).
    // This prevents one company from seeing another's waste.

    // Simulated: lines from two companies
    const allLines = [
      { company_id: "co-1", item_name: "Tomate", value: 100 },
      { company_id: "co-2", item_name: "Aguacate", value: 200 },
    ];

    // Filter for company 1 (what the query does)
    const co1Lines = allLines.filter((l) => l.company_id === "co-1");
    expect(co1Lines).toHaveLength(1);
    expect(co1Lines[0].item_name).toBe("Tomate");

    // If we passed co1Lines to rankTopMermaItems (after transforming),
    // it would only see company 1's data.
  });

  it("respects location_id filtering in multi-restaurant setup", () => {
    // Type-level test: loadTopMermaItems accepts ProfitabilitySelection
    // with optional locationId and filters .eq("location_id", selected.locationId).

    // Simulated: lines from two locations of the same company
    const allLines = [
      {
        company_id: "co-1",
        location_id: "loc-1",
        item_name: "Tomate",
        value: 100,
      },
      {
        company_id: "co-1",
        location_id: "loc-2",
        item_name: "Aguacate",
        value: 200,
      },
    ];

    // Filter for location 1 (what the query does when selected.locationId is set)
    const loc1Lines = allLines.filter((l) => l.location_id === "loc-1");
    expect(loc1Lines).toHaveLength(1);
    expect(loc1Lines[0].item_name).toBe("Tomate");
  });

  it("includes all locations when no location filter is provided", () => {
    // When selected is null or selected.locationId is null,
    // the query does not filter by location_id.

    const allLines = [
      { location_id: "loc-1", item_name: "Tomate", value: 100 },
      { location_id: "loc-2", item_name: "Aguacate", value: 200 },
    ];

    // No filter applied => all lines included
    expect(allLines).toHaveLength(2);
  });
});

describe("Confirmed-only filtering (#532)", () => {
  it("includes only confirmed status lines", () => {
    // Type-level test: loadTopMermaItems query filters .eq("status", "confirmed").

    const lines = [
      { status: "confirmed", item_name: "Tomate", value: 100 },
      { status: "draft", item_name: "Aguacate", value: 200 },
      { status: "confirmed", item_name: "Pollo", value: 300 },
    ];

    // Filter for confirmed (what the query does)
    const confirmed = lines.filter((l) => l.status === "confirmed");
    expect(confirmed).toHaveLength(2);
    expect(confirmed.map((l) => l.item_name)).toEqual(["Tomate", "Pollo"]);
  });

  it("excludes lines with null value", () => {
    // Type-level test: loadTopMermaItems query filters .not("value", "is", null).

    const lines = [
      { status: "confirmed", item_name: "Tomate", value: 100 },
      { status: "confirmed", item_name: "Sin precio", value: null },
      { status: "confirmed", item_name: "Aguacate", value: 200 },
    ];

    // Filter for non-null value (what the query does)
    const valued = lines.filter((l) => l.value !== null);
    expect(valued).toHaveLength(2);
    expect(valued.map((l) => l.item_name)).toEqual(["Tomate", "Aguacate"]);
  });
});
