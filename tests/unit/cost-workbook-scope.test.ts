import { describe, expect, it } from "vitest";
import {
  PICK_RESTAURANT_ERROR_ES,
  resolveUploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook/scope";

const RANCHOS = {
  id: "loc-ranchos",
  name: "Stage Test 1",
  brand_id: "brand-ranchos",
};
const LAVARA = {
  id: "loc-lavara",
  name: "Lavara",
  brand_id: "brand-lavara",
};

describe("resolveUploadRestaurantScope", () => {
  it("allows a company with no location rows (single-restaurant fallback)", () => {
    expect(
      resolveUploadRestaurantScope({
        locations: [],
        requestedLocationId: null,
      })
    ).toEqual({ ok: true, locationId: null, brandId: null, name: null });
  });

  it("uses the only restaurant even when All Restaurants is selected", () => {
    expect(
      resolveUploadRestaurantScope({
        locations: [RANCHOS],
        requestedLocationId: null,
      })
    ).toEqual({
      ok: true,
      locationId: RANCHOS.id,
      brandId: RANCHOS.brand_id,
      name: RANCHOS.name,
    });
  });

  it("refuses All Restaurants when there are two restaurants", () => {
    const result = resolveUploadRestaurantScope({
      locations: [RANCHOS, LAVARA],
      requestedLocationId: null,
    });
    expect(result).toEqual({ ok: false, code: "pick_restaurant" });
    expect(PICK_RESTAURANT_ERROR_ES).toMatch(/Elige un restaurante/);
    expect(PICK_RESTAURANT_ERROR_ES).toMatch(/tú|Elige|no subo/i);
  });

  it("accepts an explicit restaurant", () => {
    expect(
      resolveUploadRestaurantScope({
        locations: [RANCHOS, LAVARA],
        requestedLocationId: RANCHOS.id,
      })
    ).toEqual({
      ok: true,
      locationId: RANCHOS.id,
      brandId: RANCHOS.brand_id,
      name: RANCHOS.name,
    });
  });

  it("refuses an unknown location id instead of guessing", () => {
    expect(
      resolveUploadRestaurantScope({
        locations: [RANCHOS, LAVARA],
        requestedLocationId: "loc-other",
      })
    ).toEqual({ ok: false, code: "pick_restaurant" });
  });
});
