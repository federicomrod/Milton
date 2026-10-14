import { describe, expect, it } from "vitest";
import {
  confirmPosProductLink,
  confirmPosProductLinkError,
  matchPosProductLink,
  odooProductIdFromMetadata,
  suggestPosProductLink,
  unlinkedPosProduct,
} from "@/lib/restaurant/pos-product-links";

const base = unlinkedPosProduct({
  company_id: "co-a",
  odoo_product_id: 55,
  odoo_name: "Hamburguesa",
});

describe("pos product link states", () => {
  it("defaults to Por clasificar / Sin vincular and never auto-confirms", () => {
    expect(base.classification).toBe("por_clasificar");
    expect(base.link_state).toBe("sin_vincular");
    expect(base.confirmed_by).toBeNull();
    expect(base.confirmed_at).toBeNull();
    expect(base.confirmed_how).toBeNull();
    expect(base.menu_item_id).toBeNull();
  });

  it("suggestions stay Sugerido — never Confirmado", () => {
    const suggested = suggestPosProductLink(base, {
      menu_item_id: "menu-1",
      evidence: { score: 0.91, source: "fuzzy" },
    });
    expect(suggested.link_state).toBe("sugerido");
    expect(suggested.menu_item_id).toBe("menu-1");
    expect(suggested.confirmed_by).toBeNull();
    expect(suggested.confirmed_at).toBeNull();
    expect(suggested.confirmed_how).toBeNull();
    expect(suggested.evidence).toEqual({ score: 0.91, source: "fuzzy" });
  });

  it("refuses Confirmado without who, when and how", () => {
    expect(confirmPosProductLinkError({})).toMatch(/persona/i);
    expect(
      confirmPosProductLinkError({
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T12:00:00Z",
        confirmed_how: "",
      })
    ).not.toBeNull();
    expect(() =>
      confirmPosProductLink(base, {
        confirmed_by: "",
        confirmed_at: "2026-10-12T12:00:00Z",
        confirmed_how: "manual",
      })
    ).toThrow(/persona/i);
  });

  it("only confirmPosProductLink can set Confirmado, with a recorded person", () => {
    const confirmed = confirmPosProductLink(base, {
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T12:00:00.000Z",
      confirmed_how: "manual",
    });
    expect(confirmed.link_state).toBe("confirmado");
    expect(confirmed.confirmed_by).toBe("user-1");
    expect(confirmed.confirmed_at).toBe("2026-10-12T12:00:00.000Z");
    expect(confirmed.confirmed_how).toBe("manual");
  });
});

describe("matchPosProductLink", () => {
  it("prefers the location-scoped link and ignores another company", () => {
    const companyWide = {
      ...base,
      location_id: null,
      menu_item_id: "menu-wide",
      link_state: "sugerido" as const,
    };
    const scoped = {
      ...base,
      location_id: "loc-1",
      menu_item_id: "menu-loc",
      link_state: "sugerido" as const,
    };
    const otherCompany = {
      ...base,
      company_id: "co-b",
      location_id: "loc-1",
      menu_item_id: "menu-leak",
      link_state: "confirmado" as const,
      confirmed_by: "x",
      confirmed_at: "2026-10-12T00:00:00Z",
      confirmed_how: "manual",
    };
    expect(
      matchPosProductLink(
        [otherCompany, companyWide, scoped],
        "co-a",
        55,
        "loc-1"
      )?.menu_item_id
    ).toBe("menu-loc");
    expect(
      matchPosProductLink([otherCompany, companyWide], "co-a", 55, "loc-1")
        ?.menu_item_id
    ).toBe("menu-wide");
    expect(matchPosProductLink([otherCompany], "co-a", 55, "loc-1")).toBeNull();
  });
  it("with no restaurant selected, finds a restaurant-only link (confirmed first)", () => {
    const loc2 = {
      ...base,
      location_id: "loc-2",
      menu_item_id: "menu-2",
      link_state: "sugerido" as const,
    };
    const loc1 = {
      ...base,
      location_id: "loc-1",
      menu_item_id: "menu-1",
      link_state: "confirmado" as const,
      confirmed_by: "u",
      confirmed_at: "2026-10-12T00:00:00Z",
      confirmed_how: "manual",
    };
    expect(matchPosProductLink([loc2], "co-a", 55, null)?.menu_item_id).toBe(
      "menu-2"
    );
    expect(
      matchPosProductLink([loc2, loc1], "co-a", 55, null)?.menu_item_id
    ).toBe("menu-1");
    // A company-wide link still wins, and a selected restaurant never
    // borrows another restaurant's link.
    const wide = { ...base, location_id: null, menu_item_id: "menu-wide" };
    expect(
      matchPosProductLink([loc1, wide], "co-a", 55, null)?.menu_item_id
    ).toBe("menu-wide");
    expect(matchPosProductLink([loc2], "co-a", 55, "loc-1")).toBeNull();
  });
});

describe("odooProductIdFromMetadata", () => {
  it("reads product_id or odoo_product_id", () => {
    expect(odooProductIdFromMetadata({ product_id: 9 })).toBe(9);
    expect(odooProductIdFromMetadata({ odoo_product_id: 8 })).toBe(8);
    expect(odooProductIdFromMetadata({ product_id: "9" })).toBeNull();
    expect(odooProductIdFromMetadata(null)).toBeNull();
  });
});
