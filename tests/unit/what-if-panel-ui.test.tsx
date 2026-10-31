// @vitest-environment jsdom
// «¿Y si…?» panel: typing recomputes in the browser, Restablecer returns to the
// real figures, nothing is sent anywhere, and the layout is one column at 390 px.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/client";
import { WhatIfPanel } from "@/components/restaurant/rentabilidad/WhatIfPanel";
import {
  computeRentabilidad,
  foodCostFromDishes,
} from "@/lib/restaurant/rentabilidad";
import type { PreferredLanguage } from "@/lib/restaurant/language";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dailySales = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [
    `2026-10-${String(i + 1).padStart(2, "0")}`,
    2000 + (i % 7) * 300,
  ])
);
const dish = {
  odooProductId: 1,
  name: "PLATO 1",
  netSales: 40000,
  units: 400,
  unitCost: 31,
  inCogs: true,
  covered: true,
  excluded: false,
  status: "aprobado",
};
const month = (otros: number | null = 9800) =>
  computeRentabilidad({
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales,
    food: { ...foodCostFromDishes([dish]), periodSales: 62000 },
    fixed: {
      amounts: { planilla: 21400, alquiler: 6500, servicios: 3900, otros },
      impuestosPct: 13,
    },
    openWeekdays: null,
    openDays: 31,
  });
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function mount(lang: PreferredLanguage = "es", m = month()) {
  return render(
    <I18nProvider lang={lang}>
      <WhatIfPanel month={m} money={money} />
    </I18nProvider>
  );
}
const sims = () =>
  screen.getAllByTestId("whatif-sim-value").map((e) => e.textContent);

describe("WhatIfPanel", () => {
  it("starts on the real figures, labelled as a simulation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    const m = month();
    expect(sims()[0]).toBe(money(m.breakEvenPerDay!));
    expect(screen.getAllByText("Simulación").length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("recomputes on typing and Restablecer returns exactly", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    const start = sims();
    const reset = screen.getByRole("button", { name: "Restablecer" });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Ventas del mes/), {
      target: { value: "90000" },
    });
    expect(sims()).not.toEqual(start);
    fireEvent.change(screen.getByLabelText(/Impuestos/), {
      target: { value: "0" },
    });
    fireEvent.click(reset);
    expect(sims()).toEqual(start);
    expect(
      (screen.getByLabelText(/Ventas del mes/) as HTMLInputElement).value
    ).toBe(String(Math.round(month().monthTotals.sales * 100) / 100));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a missing fixed cost stays «⚑ Falta» and the result is a dash, never $0", () => {
    mount("es", month(null));
    expect(sims()).toEqual(["—", "—"]);
    expect(screen.getAllByText(/⚑ Falta/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("$0");
    fireEvent.change(screen.getByLabelText(/Otros/i), {
      target: { value: "9800" },
    });
    expect(sims()[1]).not.toBe("—");
  });

  it("clearing Ventas shows ⚑ Falta on the field and the results, never $0", () => {
    mount();
    fireEvent.change(screen.getByLabelText(/Ventas del mes/), {
      target: { value: "" },
    });
    expect(sims()).toEqual(["—", "—"]);
    expect(screen.getAllByText(/⚑ Falta/).length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).not.toContain("$0");
    fireEvent.change(screen.getByLabelText(/Ventas del mes/), {
      target: { value: "70000" },
    });
    expect(sims()[1]).not.toBe("—");
  });

  it("rejects text that is not a number instead of guessing", () => {
    mount();
    const start = sims();
    fireEvent.change(screen.getByLabelText(/Ventas del mes/), {
      target: { value: "12abc" },
    });
    expect(screen.getByText("Número no válido")).toBeTruthy();
    expect(sims()).toEqual(start);
  });

  it("reads German numbers (1.234,5) and speaks German", () => {
    mount("de");
    expect(screen.getByRole("button", { name: "Zurücksetzen" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Umsatz des Monats/), {
      target: { value: "70.000,5" },
    });
    expect(screen.queryByText("Keine gültige Zahl")).toBeNull();
  });

  it("one column at 390 px: no fixed widths, no horizontal scroll, no tabs, no red/green/orange", () => {
    const { container } = mount();
    const html = container.innerHTML;
    expect(html).not.toMatch(
      /\bw-\[\d+px\]|\bmin-w-\[|overflow-x|whitespace-nowrap/
    );
    expect(html).not.toMatch(/role="tab"|<details|aria-expanded/);
    // Mobile first: every grid starts as one column.
    for (const el of container.querySelectorAll('[class*="grid "]')) {
      expect(el.className).toMatch(/\bgrid-cols-1\b/);
    }
    expect(html).not.toMatch(
      /(?:text|bg|border)-(?:red|green|orange|rose|amber|emerald)|#(?:DC2626|16A34A|F97316|FBCFE8|A7F3D0|FDE68A)/i
    );
  });
});
