import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { primaryNavLabels } from "@/lib/restaurant/navigation";
import { resolveRestaurantCockpitLanguage } from "@/lib/restaurant/language";
import { selectCockpitInsights } from "@/lib/restaurant/cockpit-insights";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";
import { buildCockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const SHELL_FILES = [
  "lib/restaurant/navigation.ts",
  "lib/restaurant/last-synced.ts",
  "components/restaurant/shell/DateRangeControl.tsx",
  "components/restaurant/shell/SyncNowButton.tsx",
  "components/restaurant/shell/NotAvailableYet.tsx",
  "components/restaurant/shell/AskMiltonDrawer.tsx",
  "components/restaurant/cockpit/CockpitKpiStrip.tsx",
  "components/restaurant/cockpit/CockpitPeriodControl.tsx",
  "components/restaurant/cockpit/CockpitPeriodShell.tsx",
  "components/restaurant/cockpit/CockpitInsightsCard.tsx",
  "components/restaurant/cockpit/CockpitOnboardingChip.tsx",
  "components/restaurant/AskMiltonWorkspace.tsx",
  "components/restaurant/ProfitabilityCockpit.tsx",
  "app/dashboard/restaurant/(cockpit)/page.tsx",
  "app/dashboard/account/page.tsx",
  "components/restaurant/kitchen/KitchenQrCard.tsx",
  "components/restaurant/kitchen/KitchenStaffCard.tsx",
  "components/restaurant/kitchen/KitchenReportsCard.tsx",
  "components/restaurant/RestaurantShell.tsx",
  "components/restaurant/cockpit/CockpitTabs.tsx",
  "components/restaurant/cockpit/MenuProfitabilityTab.tsx",
  "components/restaurant/cockpit/MenuProfitabilityTable.tsx",
  "components/dashboard/logout-button.tsx",
  "lib/restaurant/cockpit-insights.ts",
  "lib/restaurant/briefing-context.ts",
];

const COCKPIT_TAB_FILES = [
  "components/restaurant/ProfitabilityCockpit.tsx",
  "components/restaurant/cockpit/MenuProfitabilityTab.tsx",
  "components/restaurant/cockpit/MenuProfitabilityTable.tsx",
  "components/restaurant/cockpit/CockpitTabs.tsx",
  "components/restaurant/RestaurantShell.tsx",
  "components/dashboard/logout-button.tsx",
];

const BANNED_IN_ES = [
  /\bOverview\b/,
  /\bComing soon\b/,
  /\bRecommendations\b/,
  /\bSettings\b/,
  /Not available yet/,
  /all loaded data/,
  /KPI strip/,
  /Today's attention/,
  /Top Margin/,
  /Margin Risk/,
  /Totals may be incomplete/,
];

function spanishSlots(src: string): string[] {
  const out: string[] = [];
  const re =
    /t\(\s*(?:lang|"es"|RESTAURANT_COCKPIT_DEFAULT_LANGUAGE)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(m[2]);
  }
  return out;
}

describe("Spanish completeness for cockpit chrome", () => {
  it("uses the pilot Spanish nav labels", () => {
    expect(primaryNavLabels("es")).toEqual([
      "Cockpit",
      "Ventas",
      "Menú",
      "Costos",
      "Rentabilidad",
      "Cocina",
      "Configuración",
    ]);
  });

  it("does not put common English words in t() Spanish slots for new chrome", () => {
    for (const file of SHELL_FILES) {
      const src = read(file);
      for (const es of spanishSlots(src)) {
        for (const banned of BANNED_IN_ES) {
          expect(es, `${file}: ${es}`).not.toMatch(banned);
        }
      }
    }
  });

  it("does not leave listed English chrome on the live Cockpit body", () => {
    const src = read("app/dashboard/restaurant/(cockpit)/page.tsx");
    expect(src).not.toMatch(/\? "No recipe"/);
    expect(src).not.toMatch(/^\s+Low margin$/m);
    expect(src).not.toMatch(/^\s+Dish Profitability$/m);
    // R1 prod bugs 1: the sample (mock) cockpit is gone; the empty state is
    // the Spanish Cockpit v2.
    expect(src).not.toContain("Showing sample data");
    expect(read("components/restaurant/cockpit/v2/CockpitEmpty.tsx")).toContain(
      "Sin datos aún"
    );
  });

  it("does not keep the old system-language KPI strip copy", () => {
    const strip = read("components/restaurant/cockpit/CockpitKpiStrip.tsx");
    expect(strip).not.toContain("todos los datos cargados");
    expect(strip).not.toContain("all loaded data");
    expect(strip).toContain("Ventas netas");
  });

  it("treats the migration-016 English backfill as Spanish for the R1 cockpit", () => {
    expect(resolveRestaurantCockpitLanguage("en")).toBe("es");
    expect(resolveRestaurantCockpitLanguage("es")).toBe("es");
    expect(resolveRestaurantCockpitLanguage(null)).toBe("es");
  });

  it('does not hardcode t("es") in cockpit/tab chrome — language comes from lang', () => {
    for (const file of COCKPIT_TAB_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/t\(\s*"es"\s*,/);
    }
  });

  it("localizes Logout and Ask Milton in the shell", () => {
    const logout = read("components/dashboard/logout-button.tsx");
    expect(logout).toContain("Cerrar sesión");
    expect(logout).toContain("t(lang,");
    const shell = read("components/restaurant/RestaurantShell.tsx");
    expect(shell).toContain('<LogoutButton lang={lang} variant="link" />');
    expect(shell).toContain("Todos los restaurantes");
    // One "✦ Preguntar a Milton", top right in every page header (A2).
    const header = read("components/restaurant/shell/OperatingPageHeader.tsx");
    expect(header).toContain("Preguntar a Milton");
    expect(shell).not.toContain("AskMiltonButton");
  });

  it("builds briefing / Ask Milton context with the cockpit language resolver", () => {
    const src = read("lib/restaurant/briefing-context.ts");
    expect(src).toContain("resolveRestaurantCockpitLanguage");
    expect(src).not.toMatch(/resolvePreferredLanguage\(/);
  });

  it("does not emit English worst-day copy when lang is Spanish", () => {
    const period = resolveCockpitPeriod("last_7", "2026-07-31");
    expect(period).not.toBeNull();
    const rows: CockpitFactRow[] = [
      fact("2026-07-25", 2000),
      fact("2026-07-26", 1900),
      fact("2026-07-27", 2100),
      fact("2026-07-28", 1800),
      fact("2026-07-29", 1037),
    ];
    const snapshot = buildCockpitPeriodSnapshot(rows, period!, {
      currency: "USD",
      lang: "es",
    });
    const insights = selectCockpitInsights(snapshot, "es");
    const text = insights.map((i) => `${i.title} ${i.body}`).join(" ");
    expect(text).not.toMatch(/did \$/);
    expect(text).not.toMatch(/in net sales/);
    expect(text).not.toMatch(/below the daily average/);
    expect(text).toMatch(
      /ventas netas|promedio diario|día más flojo|mejor día/i
    );
  });
});

function fact(sale_date: string, net: number): CockpitFactRow {
  return {
    sale_date,
    check_id: `c-${sale_date}`,
    raw_item_name: "Pupusa",
    quantity: 1,
    gross_revenue: net,
    net_revenue: net,
    discount_amount: 0,
    is_tip: false,
    sales_channel: "in_store",
    currency: "USD",
  };
}
