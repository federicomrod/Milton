import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { unavailableCostKpi } from "@/lib/restaurant/cockpit-executive";
import { buildCockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const NEW_FILES = [
  "lib/restaurant/cockpit-period.ts",
  "lib/restaurant/cockpit-executive.ts",
  "lib/restaurant/cockpit-insights.ts",
  "lib/restaurant/cockpit-data-health.ts",
  "components/restaurant/cockpit/CockpitPeriodControl.tsx",
  "components/restaurant/cockpit/CockpitPeriodShell.tsx",
  "components/restaurant/cockpit/CockpitKpiStrip.tsx",
  "components/restaurant/cockpit/CockpitHeroChart.tsx",
  "components/restaurant/cockpit/CockpitChannelBreakdown.tsx",
  "components/restaurant/cockpit/CockpitInsightsCard.tsx",
  "components/restaurant/cockpit/CockpitOnboardingChip.tsx",
  "components/restaurant/shell/DataHealthIndicator.tsx",
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

describe("Spanish completeness for the executive cockpit (#129)", () => {
  it("ships the required Spanish operator copy", () => {
    expect(unavailableCostKpi("es").reason).toBe("Pendiente de recetas");
    expect(unavailableCostKpi("es").link_label).toBe("Agregar costos");
    const strip = read("components/restaurant/cockpit/CockpitKpiStrip.tsx");
    expect(strip).toContain("Ventas netas");
    expect(strip).toContain("Margen bruto %");
    expect(strip).toContain("% costo de comida");
    expect(strip).toContain("Ticket promedio");
    expect(strip).toContain("NotAvailableYet");
    expect(read("components/restaurant/shell/NotAvailableYet.tsx")).toContain(
      "Aún no disponible"
    );
    expect(
      read("components/restaurant/cockpit/CockpitOnboardingChip.tsx")
    ).toContain("Configura tu menú");
    expect(
      read("components/restaurant/cockpit/CockpitInsightsCard.tsx")
    ).toContain("Briefing de Milton");
    expect(
      read("components/restaurant/shell/DataHealthIndicator.tsx")
    ).toContain("Salud de los datos");
  });

  it("does not put English chrome in t() Spanish slots", () => {
    const banned = [
      /\bOverview\b/,
      /Not available yet/,
      /Add costs$/,
      /Last 7 days/,
      /Data health:/,
    ];
    for (const file of NEW_FILES) {
      const src = read(file);
      for (const es of spanishSlots(src)) {
        for (const pattern of banned) {
          expect(es, `${file}: ${es}`).not.toMatch(pattern);
        }
      }
    }
  });

  it("React KPI views do not compute period totals", () => {
    const reactFiles = [
      "components/restaurant/cockpit/CockpitKpiStrip.tsx",
      "components/restaurant/cockpit/CockpitHeroChart.tsx",
      "components/restaurant/cockpit/CockpitChannelBreakdown.tsx",
      "components/restaurant/cockpit/CockpitHeadline.tsx",
    ];
    for (const file of reactFiles) {
      const src = read(file);
      expect(src).not.toContain("buildCockpitPeriodSnapshot");
      expect(src).not.toContain("classifySaleLine");
      expect(src).not.toContain("deltaPct(");
    }
  });

  it("data-health copy is Spanish when lang is es", () => {
    const health = buildCockpitDataHealth({
      lang: "es",
      currency: "USD",
      saleLineCount: 12,
      otherCurrencyExcluded: 1,
      dishesWithoutRecipe: 3,
      recipeCoveragePct: 10,
      costCoveragePct: 0,
      lastSyncedAt: null,
      posConnected: true,
      salesLoaded: true,
      readError: false,
      truncated: false,
    });
    expect(health.issue_count).toBeGreaterThan(0);
    expect(health.items.some((i) => i.label.includes("POS conectado"))).toBe(
      true
    );
    expect(health.items.some((i) => i.label.includes("Divisa USD"))).toBe(true);
    expect(health.items.some((i) => i.label.includes("líneas de venta"))).toBe(
      true
    );
    expect(health.items.some((i) => i.label.includes("otra divisa"))).toBe(
      true
    );
    expect(health.items.some((i) => i.label.includes("sin receta"))).toBe(true);
    expect(
      health.items.some((i) => i.detail.includes("platillos con costo"))
    ).toBe(true);
  });
});
