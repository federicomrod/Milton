import { describe, it, expect } from "vitest";
import {
  resolveSelectedLocation,
  type RestaurantLocationOption,
} from "@/lib/restaurant/restaurant-context-server";

const COMPANY_A_LOCATIONS: RestaurantLocationOption[] = [
  { id: "loc-a1", name: "Pinche Gringo Roma", brand_id: "brand-a1" },
  { id: "loc-a2", name: "Pinche Gringo Reforma", brand_id: "brand-a2" },
];

describe("resolveSelectedLocation (Multi-Restaurant UX v1 — Phase 6 security core)", () => {
  it("resolves to null (consolidated) when no location is requested", () => {
    expect(resolveSelectedLocation(COMPANY_A_LOCATIONS, null)).toBeNull();
    expect(resolveSelectedLocation(COMPANY_A_LOCATIONS, undefined)).toBeNull();
    expect(resolveSelectedLocation(COMPANY_A_LOCATIONS, "")).toBeNull();
  });

  it("resolves a location that belongs to the given company's list", () => {
    expect(resolveSelectedLocation(COMPANY_A_LOCATIONS, "loc-a1")).toEqual({
      locationId: "loc-a1",
      brandId: "brand-a1",
    });
    expect(resolveSelectedLocation(COMPANY_A_LOCATIONS, "loc-a2")).toEqual({
      locationId: "loc-a2",
      brandId: "brand-a2",
    });
  });

  it("SECURITY: silently falls back to consolidated for a location id from a different company", () => {
    // "company-b-location" is never in company A's own list — exactly the
    // scenario where a user tampers with ?location= to point at another
    // tenant's UUID.
    expect(
      resolveSelectedLocation(COMPANY_A_LOCATIONS, "company-b-location")
    ).toBeNull();
  });

  it("SECURITY: silently falls back to consolidated for a garbage/malformed id", () => {
    expect(
      resolveSelectedLocation(COMPANY_A_LOCATIONS, "not-a-uuid; DROP TABLE")
    ).toBeNull();
  });

  it("resolves a legacy location with a null brand_id", () => {
    const locations: RestaurantLocationOption[] = [
      { id: "loc-legacy", name: "Original Spot", brand_id: null },
    ];
    expect(resolveSelectedLocation(locations, "loc-legacy")).toEqual({
      locationId: "loc-legacy",
      brandId: null,
    });
  });

  it("never matches when the company has no locations at all", () => {
    expect(resolveSelectedLocation([], "loc-a1")).toBeNull();
  });
});
