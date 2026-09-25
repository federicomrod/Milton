import { describe, it, expect } from "vitest";
import {
  findMatchingBrandByName,
  type ExistingBrandRow,
} from "@/lib/restaurant/add-restaurant-server";

describe("findMatchingBrandByName (Add Restaurant idempotency — Phase 3/7)", () => {
  it("returns null (genuinely new restaurant) when no existing brand shares the name", () => {
    const existing: ExistingBrandRow[] = [
      { id: "brand-1", name: "Restaurant A" },
    ];
    expect(findMatchingBrandByName(existing, "Restaurant B")).toBeNull();
  });

  it("finds an exact-name match — used to create the brand + location on first submit", () => {
    const existing: ExistingBrandRow[] = [
      { id: "brand-1", name: "Restaurant A" },
    ];
    const match = findMatchingBrandByName(existing, "Restaurant A");
    expect(match?.id).toBe("brand-1");
  });

  it("a retried/duplicate submission (same name, case/whitespace differences) matches the existing brand instead of creating a second one", () => {
    const existing: ExistingBrandRow[] = [
      { id: "brand-1", name: "Pinche Gringo Reforma" },
    ];
    expect(
      findMatchingBrandByName(existing, "  pinche gringo reforma  ")?.id
    ).toBe("brand-1");
    expect(findMatchingBrandByName(existing, "PINCHE GRINGO REFORMA")?.id).toBe(
      "brand-1"
    );
  });

  it("distinct restaurant names never collide", () => {
    const existing: ExistingBrandRow[] = [
      { id: "brand-1", name: "Pinche Gringo Roma" },
      { id: "brand-2", name: "Pinche Gringo Reforma" },
    ];
    expect(
      findMatchingBrandByName(existing, "Pinche Gringo Condesa")
    ).toBeNull();
  });

  it("tolerates a null/legacy brand name without throwing", () => {
    const existing: ExistingBrandRow[] = [{ id: "brand-1", name: null }];
    expect(findMatchingBrandByName(existing, "Anything")).toBeNull();
  });

  it("an empty/whitespace-only name never matches", () => {
    const existing: ExistingBrandRow[] = [
      { id: "brand-1", name: "Restaurant A" },
    ];
    expect(findMatchingBrandByName(existing, "   ")).toBeNull();
  });
});
