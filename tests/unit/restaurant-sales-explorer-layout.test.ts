import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// R1-17b: layout of Ventas › Detalle after the redesign (replaces the checks
// of the old English explorer: Targets tab, "More filters", mix-over-time
// charts, AI placeholder…). Source-level checks: the unit suite has no browser.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const D = "components/restaurant/sales/detail";
const container = read(`${D}/SalesDetailV2.tsx`);
const filterBar = read(`${D}/FilterBar.tsx`);
const kpis = read(`${D}/KpiRow.tsx`);
const chart = read(`${D}/DailyChart.tsx`);
const dims = read(`${D}/DimensionPanel.tsx`);
const page = read("app/dashboard/restaurant/sales/detalle/page.tsx");

describe("Ventas › Detalle structure", () => {
  it("has three tabs: Tendencia · Desglose · Platos", () => {
    for (const t of ["Tendencia", "Desglose", "Platos"])
      expect(filterBar).toContain(t);
    for (const gone of ["Overview", "Trends", "Channels", "Items", "Targets"]) {
      expect(filterBar).not.toContain(`"${gone}"`);
    }
  });

  it("has one sticky filter bar: período, comparar, canal, pago, categoría, turno", () => {
    expect(filterBar).toContain("sticky top-0");
    for (const l of [
      '"Período"',
      '"Comparar con"',
      'label="Canal"',
      'label="Pago"',
      'label="Categoría"',
      'label="Turno"',
    ]) {
      expect(filterBar).toContain(l);
    }
    expect(filterBar).not.toContain("More filters");
  });

  it("removed the old pieces: Targets tab, Edit targets, AI placeholder, mix-over-time, Más hallazgos, orange ask link", () => {
    const all = [container, filterBar, kpis, chart, dims, page].join("\n");
    for (const gone of [
      "Edit targets",
      "Add targets",
      "AI recommendations",
      "Mix de canales en el tiempo",
      "Mix de pagos en el tiempo",
      "Más hallazgos",
      "¿Qué más debo revisar",
      "More filters",
      "SalesContextualAsk",
    ]) {
      expect(all, gone).not.toContain(gone);
    }
    // Targets are only a link to Configuración › Objetivos
    expect(filterBar).toContain("OBJECTIVES_HREF");
    expect(filterBar).toContain("Configuración › Objetivos");
  });

  it("has exactly five KPI cards, with Ventas netas' breakdown in a tooltip", () => {
    for (const l of [
      'label="Ventas netas"',
      'label="Tickets"',
      'label="Ticket promedio"',
      'label="Unidades"',
      'label="Mejor día"',
    ]) {
      expect(kpis).toContain(l);
    }
    expect((kpis.match(/<Card\b/g) ?? []).length).toBe(5);
    expect(kpis).toContain('role="tooltip"');
    expect(kpis).toContain("Propinas");
    expect(kpis).toContain("vs objetivo");
  });

  it("draws bars below 8 days, a straight line beyond (no smoothing) and a dashed daily goal", () => {
    expect(chart).toContain("n < 8");
    expect(chart).toContain("<polyline");
    expect(chart).not.toMatch(/curveMonotone|bezier|\bd=\{?["'`]?[^>]*\bC\d/i);
    expect(chart).toContain("strokeDasharray");
    expect(chart).toContain("Tickets");
  });

  it("Desglose ships Tarjetas (default) and Tabla over the same rows; 5 tiles per row", () => {
    expect(dims).toContain("▦ Tarjetas");
    expect(dims).toContain("☰ Tabla");
    expect(dims).toContain("xl:grid-cols-5");
    expect(dims).toContain("$/unid.");
    expect(container).toContain("vista");
  });

  it("the whole page is one request and no per-control fetch", () => {
    expect(container.match(/fetch\(/g)?.length).toBe(1);
    for (const f of [filterBar, kpis, chart, dims])
      expect(f).not.toContain("fetch(");
  });

  it("Spanish only: a single «Preguntar a Milton» (the header's), no English channel names", () => {
    expect(page).toContain("OperatingPageHeader");
    expect(page).not.toContain("hideAskButton");
    for (const f of [container, filterBar, kpis, chart, dims]) {
      expect(f).not.toMatch(/Eat In|To Go|Unknown/);
    }
  });
});
