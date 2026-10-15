// R1-16a: the Objetivos form (presentation). Synthetic.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
}));

import {
  ObjetivosForm,
  type ObjetivosFormProps,
} from "@/components/restaurant/settings/ObjetivosForm";

const base: ObjetivosFormProps = {
  currency: "USD",
  restaurants: [
    { id: "r1", name: "Uno" },
    { id: "r2", name: "Dos" },
  ],
  applyTo: null,
  rows: [],
  available: true,
  refs: {
    refDay: "2026-10-14",
    firstDay: "2026-07-01",
    avgMonthly6: 31500,
    span6Note: "solo 3 meses de datos",
    ticket30: 17.1,
    suggestedWeights: [0.1, 0.1, 0.1, 0.12, 0.18, 0.22, 0.18],
  },
  cost30: { food_cost_pct: 34, gross_margin_pct: 66 },
  today: "2026-10-15",
  effectiveFrom: "2026-10-01",
  defaultComparison: "months_6",
  canEdit: true,
};
const draw = (over: Partial<ObjetivosFormProps> = {}) =>
  renderToString(createElement(ObjetivosForm, { ...base, ...over })).replace(
    /<!-- -->/g,
    ""
  );
const target = (
  metric: string,
  value: number,
  over: Record<string, unknown> = {}
) =>
  ({
    metric_key: metric,
    target_period: "monthly",
    target_value: value,
    location_id: null,
    effective_from: "2026-01-01",
    is_active: true,
    weekday_weights: null,
    ...over,
  }) as any;

describe("ObjetivosForm", () => {
  it("shows the four goals, the real references, the start date and one primary button", () => {
    const html = draw();
    for (const label of [
      "Ventas mensuales",
      "Costo de comida",
      "Margen bruto",
      "Ticket promedio",
    ])
      expect(html).toContain(label);
    expect(html).toContain("Promedio 6 meses: $31,500");
    expect(html).toContain("solo 3 meses de datos");
    expect(html).toContain("Actual 30 d: 34%");
    expect(html).toContain("Actual 30 d: $17.10");
    expect(html).toContain(
      "Vigente desde 1 oct 2026 · los meses anteriores guardan su objetivo"
    );
    expect(html).toContain("Guardar objetivos");
    expect(html).toContain("bg-[#1b40c8]");
    expect(html).not.toContain("bg-[#f28c28]");
  });
  it("a blank goal is 'sin objetivo', never 0", () => {
    const html = draw();
    expect(html).toContain("Sin objetivo: el Cockpit no dibuja la línea");
    expect(html).not.toContain("= $0 por día");
  });
  it("the derived daily target is shown from the monthly one (30-day month → $1,150)", () => {
    const html = draw({
      today: "2026-09-15",
      effectiveFrom: "2026-09-01",
      rows: [target("revenue", 34500)],
      refs: { ...base.refs, suggestedWeights: null },
    });
    expect(html).toContain("= $1,150 por día (30 días)");
    expect(draw({ rows: [target("food_cost_pct", 32)] })).toContain(
      "Rojo cuando pasa de 32%"
    );
    expect(draw({ rows: [target("gross_margin_pct", 68)] })).toContain(
      "Verde cuando llega a 68%"
    );
  });
  it("without migration 052 it says so and the fields are disabled", () => {
    const html = draw({ available: false });
    expect(html).toContain("falta aplicar la migración 052");
    expect(html).toMatch(/aria-label="Ventas mensuales"[^>]*disabled/);
  });
  it("the weekday split comes from real sales, or says there is not enough data", () => {
    expect(draw({ rows: [target("revenue", 34500)] })).toContain(
      "Reparto diario sugerido por Milton"
    );
    const none = draw({ refs: { ...base.refs, suggestedWeights: null } });
    expect(none).toContain("Aún no hay ventas de todos los días de la semana");
  });
  it("for one restaurant, a company-wide level is only a placeholder, not its own value", () => {
    const html = draw({ applyTo: "r1", rows: [target("food_cost_pct", 32)] });
    expect(html).toContain("32 % (todos)");
    expect(html).toContain("Sin objetivo");
  });
});
