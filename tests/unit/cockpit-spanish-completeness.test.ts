import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { primaryNavLabels } from "@/lib/restaurant/navigation";

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
  "components/restaurant/RestaurantSetupChecklist.tsx",
  "components/restaurant/BriefingCard.tsx",
  "components/restaurant/ComingSoonPage.tsx",
  "app/(restaurant-cockpit)/dashboard/restaurant/page.tsx",
  "app/dashboard/account/page.tsx",
  "components/restaurant/kitchen/KitchenQrCard.tsx",
  "components/restaurant/kitchen/KitchenStaffCard.tsx",
  "components/restaurant/kitchen/KitchenReportsCard.tsx",
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
      "Cocina",
      "Datos y configuración",
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
    const src = read("app/(restaurant-cockpit)/dashboard/restaurant/page.tsx");
    expect(src).not.toMatch(/\? "No recipe"/);
    expect(src).not.toMatch(/^\s+Low margin$/m);
    expect(src).not.toMatch(/^\s+Dish Profitability$/m);
    expect(src).toContain("Sin receta");
    expect(src).toContain("Margen bajo");
    expect(src).toContain("Atención de hoy");
    expect(src).toContain("Recomendaciones");
  });

  it("does not keep the old system-language KPI strip copy", () => {
    const strip = read("components/restaurant/cockpit/CockpitKpiStrip.tsx");
    expect(strip).not.toContain("todos los datos cargados");
    expect(strip).not.toContain("all loaded data");
    expect(strip).toContain("Ventas netas");
  });
});
