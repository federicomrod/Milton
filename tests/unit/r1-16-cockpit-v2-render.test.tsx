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
import { WeekdayCostChart } from "@/components/restaurant/cockpit/v2/charts";
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

describe("goals that exist but do not reach these days (R1-16c)", () => {
  const later = (metric: string, value: number) =>
    ({
      ...(target(metric, value) as object),
      effective_from: "2026-12-01",
    }) as never;
  it("says why there is no line and offers «Ajusta tus objetivos», not «Definir»", () => {
    const html = draw({ targets: [later("revenue", 31000)] });
    expect(html).toContain("Tus objetivos empiezan el 1 dic 2026");
    expect(html).toContain("Ajusta tus objetivos");
    expect(html).not.toContain("Definir objetivos");
  });
  it("with a goal that applies: the chip shows and the button says «Ajusta tus objetivos»", () => {
    const html = draw({ targets: [target("revenue", 31000)] });
    expect(html).toContain("vs objetivo");
    expect(html).toContain("Ajusta tus objetivos");
  });
  it("a company-wide sales goal is not split for one restaurant, and says so", () => {
    const html = draw({
      targets: [target("revenue", 31000)],
      locationId: "r1",
    });
    expect(html).toContain("para todos los restaurantes");
  });
  it("the food cost per day bars have a height to grow in (percent heights need a sized parent)", () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      food_cost_pct: 30 + weekday,
      coverage_pct: 80,
      above: null,
    }));
    const html = renderToString(
      createElement(WeekdayCostChart, { days, target: 32, loading: false })
    );
    expect(html).toContain("flex h-full flex-1 items-end");
    expect(html).toContain("height:");
  });
  it("with no costed day it says why instead of drawing empty weekday labels", () => {
    const days = [0, 1, 2].map((weekday) => ({
      weekday,
      food_cost_pct: null,
      coverage_pct: null,
      above: null,
    }));
    const html = renderToString(
      createElement(WeekdayCostChart, {
        days: days as never,
        target: null,
        loading: false,
      })
    );
    expect(html).toContain("Sin precio");
  });
});
