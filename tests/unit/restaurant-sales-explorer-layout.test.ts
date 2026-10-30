import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { sales } from "@/lib/i18n/es/sales";

// R1-17b: layout of Ventas › Detalle after the redesign (replaces the checks
// of the old English explorer: Targets tab, "More filters", mix-over-time
// charts, AI placeholder…). Source-level checks: the unit suite has no browser.

// Spanish copy lives in lib/i18n/es/sales.ts (the default language); the
// components reference it by key, so each check asserts both halves.
const ES = sales.detail;
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const D = "components/restaurant/sales/detail";
const container = read(`${D}/SalesDetailV2.tsx`);
const filterBar = read(`${D}/FilterBar.tsx`);
const kpis = read(`${D}/KpiRow.tsx`);
const chart = read(`${D}/DailyChart.tsx`);
const dims = read(`${D}/DimensionPanel.tsx`);
const page = read("app/dashboard/restaurant/sales/page.tsx");

describe("Ventas › Detalle structure", () => {
  it("has three tabs: Tendencia · Desglose · Platos", () => {
    expect([ES.tabs.trend, ES.tabs.breakdown, ES.tabs.dishes]).toEqual([
      "Tendencia",
      "Desglose",
      "Platos",
    ]);
    for (const k of ["trend", "breakdown", "dishes"])
      expect(filterBar).toContain(`d.sales.detail.tabs.${k}`);
    for (const gone of ["Overview", "Trends", "Channels", "Items", "Targets"]) {
      expect(filterBar).not.toContain(`"${gone}"`);
    }
  });

  it("has one sticky filter bar: período, comparar, canal, pago, categoría, turno", () => {
    expect(filterBar).toContain("sticky top-0");
    const f = ES.filter;
    expect([
      f.period,
      f.compareWith,
      f.channel,
      f.payment,
      f.category,
      f.shift,
    ]).toEqual([
      "Período",
      "Comparar con",
      "Canal",
      "Pago",
      "Categoría",
      "Turno",
    ]);
    for (const l of [
      "aria-label={f0.period}",
      "aria-label={f0.compareWith}",
      "label={f0.channel}",
      "label={f0.payment}",
      "label={f0.category}",
      "label={f0.shift}",
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
    expect(ES.filter.targetsLink).toBe("Configuración › Objetivos");
    expect(filterBar).toContain("f0.targetsLink");
  });

  it("has exactly five KPI cards, with Ventas netas' breakdown in a tooltip", () => {
    expect([
      ES.kpi.net,
      ES.kpi.tickets,
      ES.kpi.avgTicket,
      ES.kpi.units,
      ES.kpi.bestDay,
    ]).toEqual([
      "Ventas netas",
      "Tickets",
      "Ticket promedio",
      "Unidades",
      "Mejor día",
    ]);
    for (const l of [
      "label={k0.net}",
      "label={k0.tickets}",
      "label={k0.avgTicket}",
      "label={k0.units}",
      "label={k0.bestDay}",
    ]) {
      expect(kpis).toContain(l);
    }
    expect((kpis.match(/<Card\b/g) ?? []).length).toBe(5);
    expect(kpis).toContain('role="tooltip"');
    expect(ES.kpi.tipsApart).toContain("Propinas");
    expect(kpis).toContain("k0.tipsApart");
    expect(ES.kpi.vsTarget).toContain("vs objetivo");
  });

  it("draws bars below 8 days, a straight line beyond (no smoothing) and a dashed daily goal", () => {
    expect(chart).toContain("n < 8");
    expect(chart).toContain("<polyline");
    expect(chart).not.toMatch(/curveMonotone|bezier|\bd=\{?["'`]?[^>]*\bC\d/i);
    expect(chart).toContain("strokeDasharray");
    expect(ES.daily.tickets).toBe("Tickets");
    expect(chart).toContain("t0.tickets");
  });

  it("Desglose ships Tarjetas (default) and Tabla over the same rows; 5 tiles per row", () => {
    expect(ES.dim.cards).toBe("▦ Tarjetas");
    expect(ES.dim.table).toBe("☰ Tabla");
    expect(dims).toContain("{dm.cards}");
    expect(dims).toContain("{dm.table}");
    expect(dims).toContain("xl:grid-cols-5");
    expect(ES.dim.perUnitCol).toBe("$/unid.");
    expect(dims).toContain("dm.perUnitCol");
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
