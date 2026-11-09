import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

import { I18nProvider } from "@/lib/i18n/client";
import { RentabilidadGroupPage } from "@/components/restaurant/rentabilidad/RentabilidadGroupPage";
import {
  computeRentabilidad,
  foodCostFromDishes,
  type SoldDish,
} from "@/lib/restaurant/rentabilidad";
import { buildGroupView } from "@/lib/restaurant/rentabilidad-group";
import type { PreferredLanguage } from "@/lib/restaurant/language";

type Amounts = Record<
  "planilla" | "alquiler" | "servicios" | "otros",
  number | null
>;
const FULL: Amounts = {
  planilla: 4000,
  alquiler: 1500,
  servicios: 800,
  otros: 600,
};
const dish = (
  id: number,
  sales: number,
  over: Partial<SoldDish> = {}
): SoldDish => ({
  odooProductId: id,
  name: `PLATO ${id}`,
  netSales: sales,
  units: 10,
  unitCost: 3,
  inCogs: true,
  covered: true,
  excluded: false,
  status: "aprobado",
  ...over,
});
const month = (
  amounts: Amounts,
  estimate = false,
  dishes = [dish(1, 20000)]
) => {
  const dailySales = Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      `2026-10-${String(i + 1).padStart(2, "0")}`,
      1000,
    ])
  );
  return computeRentabilidad({
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales,
    food: { ...foodCostFromDishes(dishes), periodSales: 26000 },
    fixed: { amounts, impuestosPct: 13 },
    fixedHasEstimate: estimate,
    openWeekdays: null,
    openDays: 31,
  });
};
const entry = (
  id: string,
  name: string,
  m: ReturnType<typeof month>,
  currency = "USD"
) => ({
  locationId: id,
  name,
  currency,
  month: m,
});

function render(
  lines: ReturnType<typeof entry>[],
  lang: PreferredLanguage = "es"
) {
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <RentabilidadGroupPage
        data={{
          today: "2026-10-27",
          month: "2026-10-01",
          isCurrentMonth: true,
          view: buildGroupView(lines),
        }}
        months={["2026-08-01", "2026-09-01", "2026-10-01"]}
        currentMonth="2026-10-01"
      />
    </I18nProvider>
  );
}

describe("Rentabilidad · Todos los restaurantes", () => {
  const base = [
    entry("a", "Sucursal Demo Uno", month(FULL)),
    entry("b", "Sucursal Demo Dos", month(FULL)),
  ];
  it("one card per restaurant plus the Todos total", () => {
    const html = render(base);
    expect(html.match(/data-testid="group-line"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="group-total"');
    expect(html).toContain("Sucursal Demo Uno");
    expect(html).toContain("incluye su parte de los costos del grupo");
  });
  it("missing fixed costs: ⚑ Falta (line and Todos), never $0", () => {
    const html = render([
      base[0],
      entry("b", "Sucursal Demo Dos", month({ ...FULL, otros: null })),
    ]);
    expect(html).toContain("⚑ Falta");
    expect(html).toContain("Falta algún costo fijo en Sucursal Demo Dos");
    expect(html).not.toContain("$0<");
  });
  it("partial coverage keeps the profit and shows the flag with the percent", () => {
    const html = render([
      entry(
        "a",
        "Sucursal Demo Uno",
        month(FULL, false, [
          dish(1, 10000),
          dish(2, 10000, {
            unitCost: null,
            inCogs: false,
            covered: false,
            status: "sin_receta",
          }),
        ])
      ),
    ]);
    expect(html).toContain("⚑ Falta el costo de ingredientes del 50%");
    expect(html).toContain("Ganancia");
  });
  it("an estimate is flagged per line and Todos says «Ganancia estimada»", () => {
    const html = render([
      base[0],
      entry("b", "Sucursal Demo Dos", month(FULL, true)),
    ]);
    expect(html).toContain("Estimado por Milton");
    expect(html).toContain("Ganancia estimada");
    expect(render(base)).not.toContain("Ganancia estimada");
  });
  it("different currencies: no total and the reason", () => {
    const html = render([
      base[0],
      entry("b", "Sucursal Demo Dos", month(FULL), "MXN"),
    ]);
    expect(html).not.toContain('data-testid="group-total"');
    expect(html).toContain("No hay total");
    expect(html).toContain("monedas distintas");
    expect(html.match(/data-testid="group-line"/g)).toHaveLength(2);
  });
  it("speaks en and de", () => {
    expect(render(base, "en")).toContain("Break-even day");
    const de = render(base, "de");
    expect(de).toContain("Break-even-Tag");
    expect(de).toContain("Alle");
  });
  it("390 px: one column, no tabs/tables/fixed widths, no red/green/orange", () => {
    const html = render(base);
    expect(html).not.toMatch(
      /role="tab"|<table|<details|aria-expanded|\bw-\[\d+px\]|\bmin-w-\[|overflow-x|whitespace-nowrap/
    );
    expect(html).toMatch(/<ul[^>]*grid-cols-1/);
    expect(html).not.toMatch(
      /(?:text|bg|border)-(?:red|green|orange|rose|amber|emerald)|#(?:DC2626|16A34A|F97316|FBCFE8|A7F3D0|FDE68A)/i
    );
  });
});
