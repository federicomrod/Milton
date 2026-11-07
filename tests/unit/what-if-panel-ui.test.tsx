// @vitest-environment jsdom
// «¿Y si…?» compact panel: three sliders and a result box, in the browser only.
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
const profit = () => screen.getByTestId("whatif-profit").textContent;
const setRange = (re: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(re), { target: { value } });

describe("WhatIfPanel", () => {
  it("shows three sliders and the real figures at first", () => {
    mount();
    expect(screen.getByLabelText("Subir precios")).toBeTruthy();
    expect(screen.getByLabelText("Más clientes")).toBeTruthy();
    expect(screen.getByLabelText("Costos fijos")).toBeTruthy();
    expect(profit()).toBe(money(month().profit as number));
    expect(screen.getAllByText("Simulación").length).toBeGreaterThan(0);
  });

  it("moving a slider shows real → simulated; Restablecer returns exactly; nothing is sent", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    const start = profit();
    const reset = screen.getByRole("button", { name: "Restablecer" });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    setRange(/Subir precios/, "3");
    expect(screen.getByText("+3%")).toBeTruthy();
    expect(profit()).toContain("→");
    expect(profit()).not.toBe(start);
    setRange(/Costos fijos/, "900");
    fireEvent.click(reset);
    expect(profit()).toBe(start);
    expect(
      (screen.getByLabelText("Subir precios") as HTMLInputElement).value
    ).toBe("0");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a missing fixed cost: the Costos fijos slider is ⚑ Falta and a change gives —, never $0", () => {
    mount("es", month(null));
    expect(screen.queryByLabelText("Costos fijos")).toBeNull();
    expect(screen.getAllByText("⚑ Falta").length).toBeGreaterThan(0);
    setRange(/Subir precios/, "5");
    expect(profit()).toContain("—");
    expect(document.body.textContent).not.toContain("$0");
  });

  it("speaks German", () => {
    mount("de");
    expect(screen.getByRole("button", { name: "Zurücksetzen" })).toBeTruthy();
    expect(screen.getByLabelText("Preise erhöhen")).toBeTruthy();
    expect(screen.getByLabelText("Mehr Gäste")).toBeTruthy();
  });

  it("390 px: one column, no fixed widths, no tabs, no red/green/orange", () => {
    const { container } = mount();
    const html = container.innerHTML;
    expect(html).not.toMatch(
      /\bw-\[\d+px\]|\bmin-w-\[|overflow-x|whitespace-nowrap/
    );
    expect(html).not.toMatch(/role="tab"|<details|aria-expanded/);
    expect(html).toMatch(/grid-cols-1 gap-5/);
    expect(html).not.toMatch(
      /(?:text|bg|border)-(?:red|green|orange|rose|amber|emerald)|#(?:DC2626|16A34A|F97316|FBCFE8|A7F3D0|C53A3A|1F9D55)/i
    );
  });
});
