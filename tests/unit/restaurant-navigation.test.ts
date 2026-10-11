import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  LEGACY_ROUTE_MAP,
  PRIMARY_NAV_ITEMS,
  REQUIRED_LEGACY_HREFS,
  everyRequiredLegacyRouteIsMapped,
  isPrimaryNavActive,
  primaryNavHasTelegramLabel,
  primaryNavLabel,
  primaryNavLabels,
  withLocationParam,
  withShellParams,
} from "@/lib/restaurant/navigation";

describe("primary restaurant navigation (#128)", () => {
  it("lists Cockpit, Sales, Menu, Costs, Kitchen, then Data & Settings", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.id)).toEqual([
      "cockpit",
      "sales",
      "menu",
      "costs",
      "kitchen",
      "data_settings",
    ]);
    expect(primaryNavLabels("en")).toEqual([
      "Cockpit",
      "Sales",
      "Menu",
      "Costs",
      "Kitchen",
      "Data & Settings",
    ]);
  });

  it("never puts Telegram in a primary-nav label", () => {
    expect(primaryNavHasTelegramLabel("en")).toBe(false);
    expect(primaryNavHasTelegramLabel("es")).toBe(false);
    expect(primaryNavLabel("kitchen", "en")).toBe("Kitchen");
    expect(primaryNavLabel("kitchen", "es")).toBe("Cocina");
    for (const lang of ["en", "es"] as const) {
      for (const label of primaryNavLabels(lang)) {
        expect(label.toLowerCase()).not.toContain("telegram");
      }
    }
  });

  it("keeps every old route mapped so nothing was deleted", () => {
    expect(everyRequiredLegacyRouteIsMapped()).toBe(true);
    const hrefs = LEGACY_ROUTE_MAP.map((route) => route.href);
    for (const href of REQUIRED_LEGACY_HREFS) {
      expect(hrefs).toContain(href);
    }
    const legacyLabels = LEGACY_ROUTE_MAP.map((route) => route.legacyLabel);
    for (const label of [
      "POS Sales",
      "Targets",
      "Menu & Recipes",
      "Ingredients",
      "Import Costs",
      "Suppliers",
      "Supplier Invoices",
      "Agents",
      "Settings",
      "Account",
      "Invitations",
    ]) {
      expect(legacyLabels).toContain(label);
    }
  });

  it("highlights Cockpit only on the exact cockpit path", () => {
    const cockpit = PRIMARY_NAV_ITEMS.find((item) => item.id === "cockpit")!;
    expect(isPrimaryNavActive(cockpit, "/dashboard/restaurant")).toBe(true);
    expect(isPrimaryNavActive(cockpit, "/dashboard/restaurant/sales")).toBe(
      false
    );
  });
});

describe("withShellParams", () => {
  it("carries location and date range before a hash", () => {
    expect(
      withShellParams("/dashboard/restaurant#targets", {
        locationId: "loc-1",
        from: "2026-07-01",
        to: "2026-07-31",
      })
    ).toBe(
      "/dashboard/restaurant?location=loc-1&from=2026-07-01&to=2026-07-31#targets"
    );
  });

  it("keeps withLocationParam working for Ask Milton links", () => {
    expect(withLocationParam("/dashboard/restaurant/briefing", "abc")).toBe(
      "/dashboard/restaurant/briefing?location=abc"
    );
  });
});

describe("shell source has no Telegram primary label", () => {
  it("does not render Kitchen (Telegram) in the shell", () => {
    const shell = readFileSync(
      join(process.cwd(), "components/restaurant/RestaurantShell.tsx"),
      "utf8"
    );
    expect(shell).not.toContain("Kitchen (Telegram)");
    expect(shell).toContain("primaryNavLabel(item.id, lang)");
  });
});
