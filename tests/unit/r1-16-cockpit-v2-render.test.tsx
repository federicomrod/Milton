// R1-16b: the Cockpit v2 screen (presentation, server-rendered). Synthetic.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
}));

import {
  CockpitV2,
  type CockpitV2Props,
} from "@/components/restaurant/cockpit/v2/CockpitV2";
import { eachDay } from "@/lib/restaurant/cockpit-math";

const REF = "2026-10-14";
const daily = eachDay("2026-04-01", REF).map((date, i) => ({
  date,
  net_sales: 1000 + (i % 7) * 100,
  tickets: 40,
}));
const base: CockpitV2Props = {
  currency: "USD",
  daily,
  refDay: REF,
  today: "2026-10-15",
  firstDay: "2026-04-01",
  targets: [],
  restaurants: [
    { id: "r1", name: "Uno" },
    { id: "r2", name: "Dos" },
  ],
  locationId: null,
  defaultComparison: "months_6",
};
const draw = (over: Partial<CockpitV2Props> = {}) =>
  renderToString(createElement(CockpitV2, { ...base, ...over })).replace(
    /<!-- -->/g,
    ""
  );
const target = (metric: string, value: number) =>
  ({
    metric_key: metric,
    target_period: "monthly",
    target_value: value,
    location_id: null,
    effective_from: "2026-01-01",
    is_active: true,
    weekday_weights: null,
  }) as never;

describe("CockpitV2", () => {
  it("has the one period control, one «Comparar con» and the restaurant filter", () => {
    const html = draw();
    for (const p of ["Hoy", "7 d", "30 d", "Trimestre"])
      expect(html).toContain(p);
    expect(html).toContain("Comparar con");
    expect(html).toContain("Últimos 6 meses");
    expect(html).toContain("Todos los restaurantes");
  });
  it("shows the four big cards and a loading cost, never a fake number", () => {
    const html = draw();
    for (const l of [
      "Venta promedio diaria",
      "Ventas · 30 d",
      "Costo de comida",
      "Margen bruto",
    ])
      expect(html).toContain(l);
    expect(html).toContain("Calculando");
    expect(html).not.toContain("$0%");
  });
  it("without a target: no line, no chip, and a way to set one", () => {
    const html = draw();
    expect(html).not.toContain("vs objetivo");
    expect(html).toContain("Sin objetivo de ventas: no hay línea");
    expect(html).toContain("Definir objetivos");
  });
  it("with a target: the chip, the legend and the chart title say so", () => {
    const html = draw({ targets: [target("revenue", 31000)] });
    expect(html).toContain("vs objetivo");
    expect(html).toContain("Ventas diarias vs objetivo");
    expect(html).toContain("Sobre objetivo");
    expect(html).toContain("Bajo objetivo");
    expect(html).toContain("del objetivo del periodo");
  });
  it("the comparison chips and the mini range cards are there", () => {
    const html = draw();
    expect(html).toContain("vs 6 meses");
    expect(html).toContain("vs mes pasado");
    expect(html).toContain("vs semana pasada");
    expect(html).toMatch(/Trimestre<\/span><span[^>]*><b>\$/);
  });
  it("uses the brand blue for primary things, not orange buttons", () => {
    const html = draw();
    expect(html).toContain("bg-[#1b40c8]");
    expect(html).not.toContain("bg-[#f28c28]");
  });
  it("an empty history says so instead of drawing zeros", () => {
    const html = draw({ daily: [], firstDay: null });
    expect(html).toContain("Aún no hay ventas para mostrar");
    expect(html).not.toContain("Venta promedio diaria");
  });
});
