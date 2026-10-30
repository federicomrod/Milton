// @vitest-environment jsdom
// Configuración › Objetivos and Turnos: read-only summaries, Editar opens the
// form in place, «Aplica a» stays on the page. Synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const replace = vi.fn();
const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push, replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { ObjetivosCard } from "@/components/restaurant/config/goals/ObjetivosCard";
import { TurnosCard } from "@/components/restaurant/config/goals/TurnosCard";
import { ConfigProvider } from "@/components/restaurant/config/ConfigProvider";
import type { ObjetivosFormProps } from "@/components/restaurant/settings/ObjetivosForm";

const objBase: ObjetivosFormProps = {
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
    span6Note: null,
    ticket30: 17.1,
    suggestedWeights: null,
  },
  cost30: { food_cost_pct: 30, gross_margin_pct: null },
  today: "2026-10-15",
  startOptions: [{ value: "2026-10-01", label: "1 oct 2026 · este mes" }],
  defaultComparison: "months_6",
  canEdit: true,
};
const target = (metric: string, value: number, over = {}) =>
  ({
    metric_key: metric,
    target_period: "monthly",
    target_value: value,
    location_id: null,
    effective_from: "2026-01-01",
    is_active: true,
    weekday_weights: null,
    ...over,
  }) as never;

const mountObj = (over: Partial<ObjetivosFormProps> = {}) =>
  render(
    <ConfigProvider>
      <ObjetivosCard {...objBase} {...over} />
    </ConfigProvider>
  );

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  search = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Objetivos: read-only on load", () => {
  it("shows the saved target, and the default (never 0) when unset", () => {
    mountObj({ rows: [target("food_cost_pct", 32)] });
    const food = screen.getByText("Costo de comida").parentElement!;
    expect(food.textContent).toContain("32 %");
    // Unset: labelled default values from the references.
    expect(screen.getByText("Por defecto: $31,500")).toBeTruthy();
    expect(screen.getByText("Por defecto: $17.10")).toBeTruthy();
    // Unset and no default: «Falta: añadir».
    const margin = screen.getByText("Margen bruto").parentElement!;
    expect(margin.textContent).toContain("Falta: añadir");
    expect(document.body.textContent).not.toMatch(/\$0\b/);
  });
  it("a company-wide target is shown as such for one restaurant", () => {
    mountObj({ applyTo: "r1", rows: [target("food_cost_pct", 32)] });
    expect(document.body.textContent).toContain(
      "32 % (todos los restaurantes)"
    );
  });
  it("Editar opens the form in place with Guardar / Cancelar; Cancelar goes back", () => {
    mountObj();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Ventas mensuales")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Ventas mensuales")).toBeNull();
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
  });
  it("without permission there is no Editar", () => {
    mountObj({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(
      screen.getByText("Solo el dueño puede cambiar esto.", {
        exact: false,
      })
    ).toBeTruthy();
  });
  it("saves a typed number and closes", async () => {
    mountObj();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Costo de comida %"), {
      target: { value: "31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy()
    );
    const body = JSON.parse(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.food_cost_pct).toBe(31);
  });
  it("an API error keeps the form and the typed value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "Valor no válido" }),
      }))
    );
    mountObj();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Costo de comida %"), {
      target: { value: "31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(
      (screen.getByLabelText("Costo de comida %") as HTMLInputElement).value
    ).toBe("31");
  });
});

describe("«Aplica a» stays on the page", () => {
  it("replaces ?aplica= with #objetivos and no scroll jump; never navigates to ?tab=", () => {
    search = "location=l1";
    mountObj();
    fireEvent.change(screen.getByLabelText("Aplica a"), {
      target: { value: "r2" },
    });
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("?location=l1&aplica=r2#objetivos", {
      scroll: false,
    });
    fireEvent.change(screen.getByLabelText("Aplica a"), {
      target: { value: "" },
    });
    expect(replace).toHaveBeenLastCalledWith("?location=l1#objetivos", {
      scroll: false,
    });
  });
});

const ALL = [1, 2, 3, 4, 5, 6, 7];
const turBase = {
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
        end_time: "02:00",
        weekdays: [5, 6],
        active: true,
      },
    ],
  },
  available: true,
  canEdit: true,
};
const mountTur = (over = {}) =>
  render(
    <ConfigProvider>
      <TurnosCard {...turBase} {...over} />
    </ConfigProvider>
  );

describe("Turnos", () => {
  it("one read-only table per restaurant with name, hours, days, active and the cutoff", () => {
    mountTur();
    const uno = screen.getByTestId("turnos-r1");
    expect(within(uno).getByText("Almuerzo")).toBeTruthy();
    expect(within(uno).getByText("11:00–17:00")).toBeTruthy();
    expect(within(uno).getByText("Vie, Sáb")).toBeTruthy();
    expect(within(uno).getByTestId("turnos-cutoff-ro").textContent).toContain(
      "02:00"
    );
    // The second restaurant has no shifts.
    expect(
      within(screen.getByTestId("turnos-r2")).getByText("Sin turnos")
    ).toBeTruthy();
  });
  it("Editar turnos opens only that restaurant's form, with the cutoff and Guardar / Cancelar", () => {
    mountTur();
    fireEvent.click(
      within(screen.getByTestId("turnos-r1")).getByRole("button", {
        name: "Editar turnos",
      })
    );
    expect(screen.getAllByLabelText("Nombre del turno")).toHaveLength(2);
    expect(screen.getByTestId("turnos-cutoff")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
    // The other restaurant is still read-only.
    expect(
      within(screen.getByTestId("turnos-r2")).getByRole("button", {
        name: "Editar turnos",
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Nombre del turno")).toBeNull();
  });
  it("a viewer sees the tables but no Editar", () => {
    mountTur({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Editar turnos" })).toBeNull();
    expect(screen.getByText("Almuerzo")).toBeTruthy();
  });
});
