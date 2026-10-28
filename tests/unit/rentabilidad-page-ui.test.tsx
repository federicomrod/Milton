import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RentabilidadPage } from "@/components/restaurant/rentabilidad/RentabilidadPage";
import {
  comparisonChips,
  computeRentabilidad,
  foodCostFromDishes,
  miltonFindings,
  type SoldDish,
} from "@/lib/restaurant/rentabilidad";
import type { RentabilidadPageData } from "@/lib/restaurant/rentabilidad-server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const dailySales = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [
    `2026-10-${String(i + 1).padStart(2, "0")}`,
    2000 + (i % 7) * 300,
  ])
);
const dish = (
  id: number,
  sales: number,
  over: Partial<SoldDish> = {}
): SoldDish => ({
  odooProductId: id,
  name: `PLATO ${id}`,
  netSales: sales,
  units: sales / 100,
  unitCost: 30,
  inCogs: true,
  covered: true,
  excluded: false,
  status: "aprobado",
  ...over,
});

function data(
  dishes: SoldDish[],
  amounts = {
    planilla: 21400,
    alquiler: 6500,
    servicios: 3900,
    otros: 9800,
  } as Record<"planilla" | "alquiler" | "servicios" | "otros", number | null>,
  estimate = false
): RentabilidadPageData {
  const month = computeRentabilidad({
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales,
    food: { ...foodCostFromDishes(dishes), periodSales: 62000 },
    fixed: { amounts, impuestosPct: 0 },
    fixedHasEstimate: estimate,
    openWeekdays: null,
    openDays: 31,
  });
  return {
    currency: "USD",
    today: "2026-10-27",
    month,
    previous: null,
    chips: comparisonChips(month, null),
    findings: miltonFindings(month),
  };
}

const render = (d: RentabilidadPageData) =>
  renderToStaticMarkup(
    <RentabilidadPage
      data={d}
      locationId="loc-1"
      locationName="Sucursal Centro"
      months={["2026-08-01", "2026-09-01", "2026-10-01"]}
      currentMonth="2026-10-01"
    />
  );

describe("RentabilidadPage", () => {
  it("full coverage: no flag, the muted chip, real labels", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).toContain("Ganancia real hasta ayer");
    expect(html).toContain("Proyección al cierre");
    expect(html).toContain("platos con receta: 100% de tus ventas");
    expect(html).not.toContain("Falta el costo de ingredientes");
    expect(html).not.toContain("Estimado por Milton");
    expect(html).not.toMatch(/platillo/i);
  });

  it("partial coverage: the red flag comes before the profit numbers, with real buttons", () => {
    const html = render(
      data([
        dish(1, 20000),
        dish(2, 30000, {
          unitCost: null,
          inCogs: false,
          covered: false,
          status: "sin_receta",
        }),
        dish(3, 12000, {
          unitCost: null,
          inCogs: false,
          covered: false,
          status: "borrador",
        }),
      ])
    );
    const flag = html.indexOf("Falta el costo de ingredientes del");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(html.indexOf("Ganancia real hasta ayer"));
    expect(html).toContain("aprueba estas recetas");
    expect(html).toContain("Crear receta"); // plato 2 has no recipe
    expect(html).toContain("Aprobar"); // plato 3 has a draft
    expect(html.indexOf("Plato 2")).toBeLessThan(html.indexOf("Plato 3")); // by share of sales
    expect(html).toContain("Tus platos con receta dejan");
    expect(html).toContain("#FDE68A");
  });

  it("Ganancia / Pérdida chips use mint and rosa with Ink text", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).toContain("bg-[#A7F3D0] text-[#0F172A]");
    expect(html).toContain("Ganancia</span>");
    const loss = render(
      data([dish(1, 62000)], {
        planilla: 90000,
        alquiler: 6500,
        servicios: 3900,
        otros: 9800,
      })
    );
    expect(loss).toContain("Pérdida</span>");
    expect(loss).toContain("bg-[#FBCFE8] text-[#0F172A]");
  });

  it("an estimate: «Ganancia estimada» with the lavender chip", () => {
    const html = render(data([dish(1, 62000)], undefined, true));
    expect(html).toContain("Ganancia estimada hasta ayer");
    expect(html).toContain("Estimado por Milton");
    expect(html).toContain("#D8D0F8");
    expect(html).not.toMatch(new RegExp("#b4" + "2318|#1280" + "4A", "i"));
  });

  it("missing fixed costs: ⚑ Falta, the button, no profit number", () => {
    const html = render(
      data([dish(1, 62000)], {
        planilla: 21400,
        alquiler: null,
        servicios: 3900,
        otros: 9800,
      })
    );
    expect(html).toContain("⚑ Falta Alquiler");
    expect(html).toContain("Sube tus costos fijos");
    // Costos fijos is the default tab of Costos, so the link carries no ?tab=
    expect(html).toContain(
      "/dashboard/restaurant/costs?location=loc-1&amp;month=2026-10-01"
    );
    expect(html).not.toContain("Ganancia real hasta ayer");
    expect(html).not.toContain("Proyección al cierre");
  });

  it("the Estado de resultados lists Merma as «Disponible pronto»", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).toContain("Estado de resultados");
    expect(html).toContain("Disponible pronto");
    expect(html).toContain("Ver →");
  });
});

describe("RentabilidadPage chart header", () => {
  it("states the break-even day in the section header, not in the plot", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).toContain("¿Ya cubriste tus costos fijos?");
    expect(html).toMatch(/Equilibrio: [a-záéíóú]+ \d+/);
  });
});
