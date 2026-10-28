// Costos with real tabs (R1-09b, A9/D6). Synthetic data only.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  costsTabHref,
  invoiceUploadHref,
  parseCostsTab,
  pctChange,
  priceIncreaseCount,
  shellParamsOf,
  summarizePurchaseWindows,
} from "@/lib/restaurant/costs-tabs";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Costos tabs", () => {
  it("defaults to Cambios de precio and reads ?tab=", () => {
    expect(parseCostsTab(undefined)).toBe("precios");
    expect(parseCostsTab("nope")).toBe("precios");
    expect(parseCostsTab("compras")).toBe("compras");
    expect(parseCostsTab(["proveedores"])).toBe("proveedores");
    expect(parseCostsTab("costos-fijos")).toBe("costos-fijos");
    expect(parseCostsTab(["costos-fijos"])).toBe("costos-fijos");
  });

  it("builds tab hrefs keeping other params", () => {
    expect(costsTabHref("precios")).toBe("/dashboard/restaurant/costs");
    expect(costsTabHref("compras", { location: "l1", tab: "x" })).toBe(
      "/dashboard/restaurant/costs?tab=compras&location=l1"
    );
    expect(
      costsTabHref("costos-fijos", { location: "l1", month: "2026-03" })
    ).toBe(
      "/dashboard/restaurant/costs?tab=costos-fijos&location=l1&month=2026-03"
    );
    expect(invoiceUploadHref({ location: "l1" })).toBe(
      "/dashboard/restaurant/costs?tab=compras&location=l1#subir-factura"
    );
    expect(shellParamsOf({ location: "l1", producto: "7", from: "a" })).toEqual(
      { location: "l1", from: "a" }
    );
  });

  it("old /invoices and /suppliers redirect into the tabs", () => {
    const invoices = read("app/dashboard/restaurant/invoices/page.tsx");
    expect(invoices).toContain('redirect(costsTabHref("compras"');
    const suppliers = read("app/dashboard/restaurant/suppliers/page.tsx");
    expect(suppliers).toContain('redirect(costsTabHref("proveedores"');
  });

  it("the page has no orange, a blue «Subir factura», real tabs, and no link row", () => {
    const page = read("app/dashboard/restaurant/costs/page.tsx");
    expect(page).not.toContain("costLinks");
    expect(page).not.toContain("Preparaciones");
    expect(page).not.toMatch(/f28c28|e07b17|orange-/i);
    expect(page).toContain("<CostsAreaTabs");
    expect(page).toContain("<InvoicesPage");
    expect(page).toContain("<SuppliersPage");
    expect(page).toContain('"Sin precio"');
  });

  it("uses no text under 12px", () => {
    for (const file of [
      "app/dashboard/restaurant/costs/page.tsx",
      "components/restaurant/costs/CostsArea.tsx",
      "components/restaurant/InvoicesPage.tsx",
      "components/restaurant/SuppliersPage.tsx",
      "components/restaurant/settings/PosSalesUploadPanel.tsx",
      "app/dashboard/restaurant/data/page.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/text-\[(9|10|11|11\.5)px\]/);
    }
  });
});

describe("Costos KPIs", () => {
  it("counts only prices that went up", () => {
    expect(
      priceIncreaseCount([
        { pct_change: 12 },
        { pct_change: -4 },
        { pct_change: 0.5 },
      ])
    ).toBe(2);
  });

  it("sums the last 30 days vs the 30 before, skipping other currencies", () => {
    const today = new Date("2026-10-14T12:00:00Z");
    const w = summarizePurchaseWindows(
      [
        { cost_date: "2026-10-14", total_cost: 100, currency: "USD" },
        { cost_date: "2026-09-15", total_cost: 50, currency: null },
        { cost_date: "2026-09-14", total_cost: 30, currency: "USD" },
        { cost_date: "2026-08-16", total_cost: 20, currency: "USD" },
        { cost_date: "2026-08-15", total_cost: 999, currency: "USD" },
        { cost_date: "2026-10-01", total_cost: 999, currency: "MXN" },
      ],
      today,
      "USD"
    );
    expect(w).toEqual({ last30: 150, previous30: 50 });
    expect(summarizePurchaseWindows([], today, "USD")).toEqual({
      last30: null,
      previous30: null,
    });
    expect(pctChange(150, 50)).toBe(200);
    expect(pctChange(150, null)).toBeNull();
    expect(pctChange(null, 50)).toBeNull();
  });
});
