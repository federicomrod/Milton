import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  DATA_SETTINGS_SECTIONS,
  LEGACY_ROUTE_MAP,
  PRIMARY_NAV_ITEMS,
  REQUIRED_LEGACY_HREFS,
  everyRequiredLegacyRouteIsMapped,
  hrefKeepingParams,
  posUploadHref,
  routesForSection,
  isPrimaryNavActive,
  primaryNavHasTelegramLabel,
  primaryNavLabel,
  primaryNavLabels,
  withLocationParam,
  withShellParams,
} from "@/lib/restaurant/navigation";

describe("primary restaurant navigation (#128)", () => {
  it("lists Cockpit, Sales, Menu, Costs, Kitchen, then Settings", () => {
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
      "Settings",
    ]);
    expect(primaryNavLabels("es")).toEqual([
      "Cockpit",
      "Ventas",
      "Menú",
      "Costos",
      "Cocina",
      "Configuración",
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

  it("every old href still answers: a screen, or a redirect to resolvesTo", () => {
    const appDirs = ["app", "app/(restaurant-cockpit)"];
    for (const route of LEGACY_ROUTE_MAP) {
      const path = route.href.split("#")[0].split("?")[0];
      const page = appDirs
        .map((dir) => join(process.cwd(), dir, path, "page.tsx"))
        .find((file) => existsSync(file));
      expect(page, route.href).toBeTruthy();
      const src = readFileSync(page!, "utf8");
      if (route.resolvesTo) {
        expect(src, route.href).toMatch(/redirect\(/);
        // No JSX: a redirect, not a screen.
        expect(src, route.href).not.toMatch(/<[A-Z]\w*[\s/>]/);
        const target = appDirs
          .map((dir) => join(process.cwd(), dir, route.resolvesTo!, "page.tsx"))
          .find((file) => existsSync(file));
        expect(target, route.resolvesTo).toBeTruthy();
      }
    }
  });

  it("Configuración has Restaurante, Conexiones, Objetivos, Turnos, Equipo and Cuenta (A10/A11, R1-16a, R1-17a)", () => {
    expect(DATA_SETTINGS_SECTIONS).toEqual([
      "restaurant",
      "connections",
      "objectives",
      "shifts",
      "team",
      "account",
    ]);
    const listed = DATA_SETTINGS_SECTIONS.flatMap((s) =>
      routesForSection(s, { isAdmin: true }).map((r) => r.id)
    );
    for (const gone of [
      "ingredients",
      "suppliers",
      "supplier-invoices",
      "import-costs",
      "menu-recipes",
      "targets",
      "ask-milton",
    ]) {
      expect(listed).not.toContain(gone);
    }
    expect(routesForSection("connections").map((r) => r.id)).toEqual(
      expect.arrayContaining(["connect-data", "pos-sales"])
    );
    expect(routesForSection("team", { isAdmin: false })).toEqual([]);
    expect(
      routesForSection("team", { isAdmin: true }).map((r) => r.id)
    ).toEqual(["invitations"]);
    expect(routesForSection("account").map((r) => r.id)).toEqual(
      expect.arrayContaining(["account", "settings"])
    );
  });

  it("the old POS upload lands in Conexiones with its params", () => {
    expect(posUploadHref({ location: "l1" })).toBe(
      "/dashboard/restaurant/data?location=l1&seccion=conexiones#conexiones"
    );
    const page = readFileSync(
      join(process.cwd(), "app/dashboard/restaurant/upload/page.tsx"),
      "utf8"
    );
    expect(page).toContain("redirect(posUploadHref(");
    expect(
      readFileSync(
        join(process.cwd(), "app/dashboard/restaurant/data/page.tsx"),
        "utf8"
      )
    ).toContain("<PosSalesUploadPanel");
  });

  it("hrefKeepingParams carries every param and the hash", () => {
    expect(
      hrefKeepingParams("/x", { a: "1", b: ["2", "3"], c: undefined }, "h")
    ).toBe("/x?a=1&b=2&b=3#h");
    expect(hrefKeepingParams("/x", {})).toBe("/x");
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
