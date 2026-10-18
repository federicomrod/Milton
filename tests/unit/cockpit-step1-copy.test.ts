import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("cockpit step-1 review nits", () => {
  it("does not render a visible TODO step 2 box on the Menu tab", () => {
    const page = read("app/dashboard/restaurant/(cockpit)/page.tsx");
    const menuTab = read(
      "components/restaurant/cockpit/MenuProfitabilityTab.tsx"
    );
    expect(page + menuTab).toContain("TODO(step 2, #123)");
    expect(page).not.toContain("TODO step 2: category mix");
    expect(page).not.toContain("TODO paso 2:");
  });

  it("names the two revenue figures so the strip and Explorer cannot be confused", () => {
    const strip = read("components/restaurant/cockpit/CockpitKpiStrip.tsx");
    const explorer = read("components/restaurant/sales/detail/KpiRow.tsx");
    expect(strip).toContain("Net sales");
    expect(strip).toContain("Ventas netas");
    expect(strip).not.toContain("all loaded data");
    expect(strip).not.toContain("todos los datos cargados");
    expect(explorer).toContain("Ventas netas");
  });

  it("keeps the Cockpit strip to 4 KPIs (R1-09b, wireframe 0)", () => {
    const strip = read("components/restaurant/cockpit/CockpitKpiStrip.tsx");
    expect(strip).toContain("Ventas netas");
    expect(strip).toContain("Ticket promedio");
    expect(strip).not.toContain('"Tickets", "Tickets"');
    expect(strip).toContain("xl:grid-cols-4");
  });

  it("labels mix charts as calendar weeks, not the rolling KPI window", () => {
    const hero = read("components/restaurant/cockpit/SalesHero.tsx");
    expect(hero).toContain("Calendar weeks Mon–Sun");
  });

  it("exposes the exact heatmap value on hover and focus", () => {
    const heat = read("components/restaurant/cockpit/SalesHeatmap.tsx");
    expect(heat).toContain("<title>{exact}</title>");
    expect(heat).toContain("onMouseEnter");
    expect(heat).toContain("onFocus");
    expect(heat).toContain('aria-live="polite"');
  });

  it("isolates the pending service-charge decision in one constant", () => {
    const src = read("lib/restaurant/sales-revenue.ts");
    expect(src).toContain("export const SERVICE_CHARGE_NAMES_ARE_TIPS = false");
    expect(src).toContain("export const SERVICE_CHARGE_NAMES");
    expect(src).toContain("Fede has not decided");
  });
});
