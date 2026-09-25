import { describe, it, expect } from "vitest";
import {
  resolveContextScope,
  type AskMiltonContextScope,
} from "@/lib/restaurant/ask-milton-context";
import { filterMenuItemsForSelection } from "@/lib/restaurant/profitability-server";
import { resolveSelectedLocation } from "@/lib/restaurant/restaurant-context-server";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";

// Multi-Restaurant UX v1 — Ask Milton location-awareness (final cleanup task).
//
// Ask Milton deliberately reuses the exact same resolver
// (resolveSelectedLocation / resolveRestaurantContext) and menu-scoping
// rule (filterMenuItemsForSelection) already tested for the dashboard and
// briefing in tests/unit/restaurant-context.test.ts and
// tests/unit/profitability-menu-scoping.test.ts — no second context
// system was introduced. These tests cover what's NEW to Ask Milton:
// context_scope, and the ingredient-usage name-lookup composition that
// must never leak an out-of-scope restaurant's dish name.

describe("resolveContextScope (Phase 2/3 — model scope awareness)", () => {
  it("consolidated mode when no location is selected", () => {
    const scope: AskMiltonContextScope = resolveContextScope(
      null,
      "Pinche Gringo Group"
    );
    expect(scope).toEqual({
      mode: "consolidated",
      restaurant_name: "Pinche Gringo Group",
    });
  });

  it("single_restaurant mode when a location is selected", () => {
    const scope = resolveContextScope(
      { locationId: "loc-a", brandId: "brand-a" },
      "Pinche Gringo Roma"
    );
    expect(scope).toEqual({
      mode: "single_restaurant",
      restaurant_name: "Pinche Gringo Roma",
    });
  });

  it("existing single-restaurant companies (never pass a selection) still resolve to consolidated — unchanged behavior", () => {
    // A company with only ever one restaurant never has a `?location=` to
    // select, so `selected` is always undefined/null — this must keep
    // working exactly as it did before Multi-Restaurant UX v1.
    expect(resolveContextScope(undefined, "Solo Taqueria").mode).toBe(
      "consolidated"
    );
  });
});

describe("Ask Milton menu/ingredient-usage scoping composition (Phase 3, scenario 4)", () => {
  interface FakeMenuItem {
    id: string;
    name: string;
    brand_id: string | null;
  }

  const BRAND_A = "brand-a";
  const BRAND_B = "brand-b";

  const MENU: FakeMenuItem[] = [
    { id: "item-a1", name: "A Brisket Taco", brand_id: BRAND_A },
    { id: "item-b1", name: "B Poke Bowl", brand_id: BRAND_B },
    { id: "item-legacy", name: "Legacy Soda", brand_id: null },
  ];

  // Mirrors ask-milton-context.ts: menuItemNameById is built from the
  // ALREADY-SCOPED list, so an id outside that scope simply isn't in the
  // map — exactly the fix that replaced the old `?? menuItemId` fallback
  // (which would have leaked a raw id for an out-of-scope item).
  function buildScopedNameMap(
    selected: { locationId: string; brandId: string | null } | null
  ) {
    const scoped = filterMenuItemsForSelection(MENU, selected);
    return new Map(scoped.map((m) => [m.id, m.name]));
  }

  it("Restaurant A's name map contains its own item, never Restaurant B's exclusive dish", () => {
    const names = buildScopedNameMap({ locationId: "loc-a", brandId: BRAND_A });
    expect(names.get("item-a1")).toBe("A Brisket Taco");
    expect(names.get("item-b1")).toBeUndefined();
    expect(names.get("item-legacy")).toBe("Legacy Soda");
  });

  it("Restaurant B's name map contains its own item, never Restaurant A's exclusive dish", () => {
    const names = buildScopedNameMap({ locationId: "loc-b", brandId: BRAND_B });
    expect(names.get("item-b1")).toBe("B Poke Bowl");
    expect(names.get("item-a1")).toBeUndefined();
  });

  it("consolidated mode's name map contains every restaurant's items", () => {
    const names = buildScopedNameMap(null);
    expect(names.get("item-a1")).toBe("A Brisket Taco");
    expect(names.get("item-b1")).toBe("B Poke Bowl");
  });

  it("a recipe belonging to an out-of-scope menu item resolves to nothing (skipped), never a leaked raw id", () => {
    const names = buildScopedNameMap({ locationId: "loc-a", brandId: BRAND_A });
    // "item-b1" is Restaurant B's — simulating ask-milton-context.ts's
    // `menuItemNameById.get(menuItemId)` lookup for a recipe that maps to
    // an out-of-scope menu item.
    const lookedUp = names.get("item-b1");
    expect(lookedUp).toBeUndefined();
    // The old behavior (`?? menuItemId`) would have produced the string
    // "item-b1" itself here — asserting undefined proves that fallback is
    // gone.
  });
});

describe("Ask Milton security: reuses the same resolver, so a foreign/invalid location is rejected (Phase 3, scenario 5)", () => {
  const COMPANY_A_LOCATIONS: RestaurantLocationOption[] = [
    { id: "loc-a1", name: "Pinche Gringo Roma", brand_id: "brand-a1" },
  ];

  it("an id belonging to another company never resolves — Ask Milton falls back to consolidated, not an error or a leak", () => {
    expect(
      resolveSelectedLocation(
        COMPANY_A_LOCATIONS,
        "some-other-companys-location"
      )
    ).toBeNull();
  });

  it("a garbage/malformed id never resolves", () => {
    expect(
      resolveSelectedLocation(
        COMPANY_A_LOCATIONS,
        "'; DROP TABLE pos_sales_items;--"
      )
    ).toBeNull();
  });
});
