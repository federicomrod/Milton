import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Restaurant Onboarding Complete Route Tests (Content Regression)
 *
 * Verifies the structural guarantees the fix requires:
 * - Location insert uses only real columns (status: 'active', no currency/is_active)
 * - Insert errors surface as 500 responses and prevent onboarding_status='completed'
 * - Idempotency: re-running with existing brand but no location creates it
 *
 * Uses content regression (not full route execution) to avoid mocking complexity.
 */

const ROUTE_PATH = join(
  process.cwd(),
  "app/api/restaurant/onboarding/complete/route.ts"
);
const ADD_RESTAURANT_PATH = join(
  process.cwd(),
  "app/api/restaurant/add-restaurant/route.ts"
);

const completeSource = readFileSync(ROUTE_PATH, "utf8");
const addRestaurantSource = readFileSync(ADD_RESTAURANT_PATH, "utf8");

describe("POST /api/restaurant/onboarding/complete — location insert columns", () => {
  it("inserts restaurant_locations with status: 'active'", () => {
    const locationInsertIdx = completeSource.indexOf(
      '.from("restaurant_locations")'
    );
    expect(locationInsertIdx).toBeGreaterThan(-1);

    // Find the insert payload (the object after .insert( up to the closing })
    const insertStart = completeSource.indexOf(".insert({", locationInsertIdx);
    expect(insertStart).toBeGreaterThan(-1);
    const insertEnd = completeSource.indexOf("});", insertStart);
    const insertPayload = completeSource.slice(insertStart, insertEnd);

    expect(insertPayload).toContain("status:");
    expect(insertPayload).toContain('"active"');
  });

  it("does NOT insert currency into restaurant_locations", () => {
    const locationInsertIdx = completeSource.indexOf(
      '.from("restaurant_locations")'
    );
    expect(locationInsertIdx).toBeGreaterThan(-1);

    const insertStart = completeSource.indexOf(".insert({", locationInsertIdx);
    const insertEnd = completeSource.indexOf("});", insertStart);
    const insertPayload = completeSource.slice(insertStart, insertEnd);

    expect(insertPayload).not.toContain("currency");
  });

  it("does NOT insert is_active into restaurant_locations", () => {
    const locationInsertIdx = completeSource.indexOf(
      '.from("restaurant_locations")'
    );
    expect(locationInsertIdx).toBeGreaterThan(-1);

    const insertStart = completeSource.indexOf(".insert({", locationInsertIdx);
    const insertEnd = completeSource.indexOf("});", insertStart);
    const insertPayload = completeSource.slice(insertStart, insertEnd);

    expect(insertPayload).not.toContain("is_active");
  });
});

describe("POST /api/restaurant/onboarding/complete — error handling", () => {
  it("returns 500 when restaurant_brands insert fails", () => {
    const brandInsertIdx = completeSource.indexOf('.from("restaurant_brands")');
    expect(brandInsertIdx).toBeGreaterThan(-1);

    // Find the error check after brand insert
    const brandErrorCheckIdx = completeSource.indexOf(
      "if (brandInsertError)",
      brandInsertIdx
    );
    expect(brandErrorCheckIdx).toBeGreaterThan(brandInsertIdx);

    // Find the 500 response in that error block
    const errorBlock = completeSource.slice(
      brandErrorCheckIdx,
      completeSource.indexOf("});", brandErrorCheckIdx) + 10
    );
    expect(errorBlock).toContain("status: 500");
    expect(errorBlock).toContain("brand");
  });

  it("returns 500 when restaurant_locations insert fails", () => {
    const locationInsertIdx = completeSource.indexOf(
      '.from("restaurant_locations")'
    );
    expect(locationInsertIdx).toBeGreaterThan(-1);

    // Find the error check after location insert
    const locationErrorCheckIdx = completeSource.indexOf(
      "if (locationInsertError)",
      locationInsertIdx
    );
    expect(locationErrorCheckIdx).toBeGreaterThan(locationInsertIdx);

    // Find the 500 response in that error block
    const errorBlock = completeSource.slice(
      locationErrorCheckIdx,
      completeSource.indexOf("});", locationErrorCheckIdx) + 10
    );
    expect(errorBlock).toContain("status: 500");
    expect(errorBlock).toContain("location");
  });

  it("sets onboarding_status='completed' only after both brand and location succeed", () => {
    const brandErrorIdx = completeSource.indexOf("if (brandInsertError)");
    const locationErrorIdx = completeSource.indexOf("if (locationInsertError)");
    const completionIdx = completeSource.indexOf(
      'onboarding_status: "completed"'
    );

    expect(brandErrorIdx).toBeGreaterThan(-1);
    expect(locationErrorIdx).toBeGreaterThan(-1);
    expect(completionIdx).toBeGreaterThan(-1);

    // The completion update should come after both error checks
    expect(completionIdx).toBeGreaterThan(brandErrorIdx);
    expect(completionIdx).toBeGreaterThan(locationErrorIdx);

    // Verify both error blocks return early (contain 'return')
    const brandErrorBlock = completeSource.slice(
      brandErrorIdx,
      brandErrorIdx + 500
    );
    const locationErrorBlock = completeSource.slice(
      locationErrorIdx,
      locationErrorIdx + 500
    );

    expect(brandErrorBlock).toContain("return");
    expect(locationErrorBlock).toContain("return");
  });
});

describe("POST /api/restaurant/onboarding/complete — idempotency", () => {
  it("checks if brand exists before creating a new one", () => {
    const brandCheckIdx = completeSource.indexOf(
      '.from("restaurant_brands")\n      .select("id")'
    );
    const brandInsertIdx = completeSource.indexOf(
      '.from("restaurant_brands")\n        .insert({'
    );

    expect(brandCheckIdx).toBeGreaterThan(-1);
    expect(brandInsertIdx).toBeGreaterThan(-1);
    // The check should come before the insert
    expect(brandCheckIdx).toBeLessThan(brandInsertIdx);
  });

  it("checks if location exists before creating a new one", () => {
    const locationCheckIdx = completeSource.indexOf(
      '.from("restaurant_locations")\n        .select("id")'
    );
    const locationInsertIdx = completeSource.indexOf(
      '.from("restaurant_locations")\n        .insert({'
    );

    expect(locationCheckIdx).toBeGreaterThan(-1);
    expect(locationInsertIdx).toBeGreaterThan(-1);
    // The check should come before the insert
    expect(locationCheckIdx).toBeLessThan(locationInsertIdx);
  });

  it("creates location even when brand already exists", () => {
    // Look for the pattern: if existingBrand is found, use its ID
    // then still check and potentially create the location
    const useBrandIdIdx = completeSource.indexOf("if (existingBrand?.id)");
    const locationCheckIdx = completeSource.indexOf(
      '.from("restaurant_locations")\n        .select("id")'
    );

    expect(useBrandIdIdx).toBeGreaterThan(-1);
    expect(locationCheckIdx).toBeGreaterThan(-1);
    // Location check should happen after we potentially use existing brand
    expect(locationCheckIdx).toBeGreaterThan(useBrandIdIdx);
  });
});

describe("POST /api/restaurant/add-restaurant — location insert columns", () => {
  it("inserts restaurant_locations with status: 'active'", () => {
    // Find restaurant_locations insert specifically (not restaurant_brands)
    const locationsTableIdx = addRestaurantSource.indexOf(
      '.from("restaurant_locations")\n      .insert({'
    );
    expect(locationsTableIdx).toBeGreaterThan(-1);

    const insertStart =
      locationsTableIdx + '.from("restaurant_locations")'.length;
    const insertEnd = addRestaurantSource.indexOf("})", insertStart);
    const insertPayload = addRestaurantSource.slice(insertStart, insertEnd);

    expect(insertPayload).toContain("status:");
    expect(insertPayload).toContain('"active"');
  });

  it("does NOT insert currency into restaurant_locations", () => {
    const locationsTableIdx = addRestaurantSource.indexOf(
      '.from("restaurant_locations")\n      .insert({'
    );
    expect(locationsTableIdx).toBeGreaterThan(-1);

    const insertStart =
      locationsTableIdx + '.from("restaurant_locations")'.length;
    const insertEnd = addRestaurantSource.indexOf("})", insertStart);
    const insertPayload = addRestaurantSource.slice(insertStart, insertEnd);

    expect(insertPayload).not.toContain("currency");
  });

  it("does NOT insert is_active into restaurant_locations", () => {
    const locationsTableIdx = addRestaurantSource.indexOf(
      '.from("restaurant_locations")\n      .insert({'
    );
    expect(locationsTableIdx).toBeGreaterThan(-1);

    const insertStart =
      locationsTableIdx + '.from("restaurant_locations")'.length;
    const insertEnd = addRestaurantSource.indexOf("})", insertStart);
    const insertPayload = addRestaurantSource.slice(insertStart, insertEnd);

    expect(insertPayload).not.toContain("is_active");
  });
});
