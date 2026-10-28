// R1-17a: Configuración › Turnos (presentation, server-rendered). Synthetic.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
}));

import {
  TurnosForm,
  weekdaysLabel,
  type TurnosFormProps,
} from "@/components/restaurant/settings/TurnosForm";

const ALL = [1, 2, 3, 4, 5, 6, 7];
const base: TurnosFormProps = {
  restaurants: [
    { id: "r1", name: "Uno" },
    { id: "r2", name: "Dos" },
  ],
  shiftsByRestaurant: {
    r1: [
      {
        name: "Almuerzo",
        start_time: "11:00",
        end_time: "17:00",
        weekdays: ALL,
        active: true,
      },
      {
        name: "Cena",
        start_time: "17:00",
        end_time: "24:00",
        weekdays: ALL,
        active: true,
      },
    ],
    r2: [
      {
        name: "Cena",
        start_time: "18:00",
        end_time: "02:00",
        weekdays: ALL,
        active: true,
      },
    ],
  },
  available: true,
  canEdit: true,
};
const draw = (over: Partial<TurnosFormProps> = {}) =>
  renderToString(createElement(TurnosForm, { ...base, ...over })).replace(
    /<!-- -->/g,
    ""
  );

describe("TurnosForm", () => {
  it("shows the shifts, the 24 h preview, the cutoff and the one primary button", () => {
    const html = draw();
    expect(html).toContain("Almuerzo");
    expect(html).toContain("Cena");
    expect(html).toContain("+ Añadir turno");
    expect(html).toContain("Guardar turnos");
    expect(html).toContain("Vista de 24 horas");
    expect(html).toContain("Otro horario");
    // nothing crosses midnight in the first restaurant: 04:00
    expect(html).toContain("<b>04:00</b>");
    expect(html).toContain("Ahora: 2 turnos activos");
  });
  it("an end at 24:00 is shown as 00:00 (a time input cannot show 24:00)", () => {
    expect(draw()).toMatch(/aria-label="Fin"[^>]*value="00:00"/);
  });
  it("the save button is never disabled for being clean (it answers instead)", () => {
    expect(draw()).toMatch(
      /<button type="button"(?![^>]*disabled="")[^>]*>Guardar turnos/
    );
  });
  it("without migration 054 it says so and the fields are disabled", () => {
    const html = draw({ available: false });
    expect(html).toContain("Esto aún no está disponible en tu cuenta.");
    expect(html).toMatch(/aria-label="Nombre del turno"[^>]*disabled/);
  });
  it("a restaurant with no shifts says what that means", () => {
    const html = draw({ shiftsByRestaurant: {} });
    expect(html).toContain("aún no tiene turnos");
    expect(html).toContain("Ahora: sin turnos activos");
  });
  it("weekday summaries", () => {
    expect(weekdaysLabel(ALL)).toBe("Lun–Dom");
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe("Lun–Vie");
    expect(weekdaysLabel([5, 6])).toBe("Vie, Sáb");
    expect(weekdaysLabel([1, 3, 5])).toBe("Lun, Mié, Vie");
    expect(weekdaysLabel([])).toBe("Ningún día");
  });
});
