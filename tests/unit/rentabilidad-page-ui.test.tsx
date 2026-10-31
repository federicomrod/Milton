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

  it("partial coverage: a plain table after the profit card, with real buttons", () => {
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
    // Mockup order: the hero card (profit) first, then the recipes table.
    expect(flag).toBeGreaterThan(html.indexOf("Ganancia real hasta ayer"));
    expect(html).toContain("Plato sin receta aprobada");
    expect(html).toContain("aprueba estas recetas");
    expect(html).toContain("Crear receta"); // plato 2 has no recipe
    expect(html).toContain("Aprobar"); // plato 3 has a draft
    expect(html.indexOf("Plato 2")).toBeLessThan(html.indexOf("Plato 3")); // by share of sales
    expect(html).toContain("Tus platos con receta dejan");
    // No full yellow box: amarillo only for the small ⚑ Falta tag.
    expect(html).not.toContain("bg-[#FDE68A]/40");
    expect(html).not.toContain("rounded-lg bg-[#FDE68A]");
  });

  it("a loss is a plain Ink chip on gris: no mint, rosa, green or red", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).not.toMatch(/#A7F3D0|#FBCFE8|#1F9D55|#C53A3A/i);
    const loss = render(
      data([dish(1, 62000)], {
        planilla: 90000,
        alquiler: 6500,
        servicios: 3900,
        otros: 9800,
      })
    );
    expect(loss).toContain("Pérdida</span>");
    expect(loss).toContain("bg-[#F1F3F7] text-[#0F172A]");
    expect(loss).not.toMatch(/#A7F3D0|#FBCFE8/i);
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
    expect(html).toContain("Te falta 1 dato para ver tu ganancia real.");
    expect(html).toContain("Sin Alquiler");
    expect(html).toContain("⚑ Falta");
    expect(html).toContain(">Escribir<");
    expect(html).toContain(">Subir archivo<");
    // One «Sube tus costos fijos» button, no yellow box.
    expect(html.match(/Sube tus costos fijos/g)).toHaveLength(1);
    expect(html).toContain("Mientras tanto: margen bruto de octubre");
    expect(html).not.toContain("bg-[#FDE68A]/40");
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

describe("RentabilidadPage hero card", () => {
  it("opens with a sentence headline, then the profit numbers and the chart", () => {
    const html = render(data([dish(1, 62000)]));
    expect(html).toMatch(
      /data-testid="hero-headline"[^>]*>(Ayer, [a-záéíóú]+ \d+, cubriste octubre\.|El [a-záéíóú]+ \d+ cubriste octubre\.|Vas a cubrir octubre el [a-záéíóú]+ \d+\.|Todavía no cubres octubre\.)/
    );
    const order = [
      "hero-headline",
      "Ganancia real hasta ayer",
      "Proyección al cierre",
      "Estado de resultados",
    ].map((k) => html.indexOf(k));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("page order: hero, 4 tiles, ¿A dónde va cada $100?, Milton, ¿Y si…?, Estado de resultados", () => {
    const html = render(data([dish(1, 62000)]));
    const at = (k: string) => html.indexOf(k);
    const order = [
      'data-testid="hero-card"',
      "Punto de equilibrio por día",
      "¿A dónde va cada",
      "Resumen de Milton",
      'data-testid="whatif-panel"',
      'role="tablist"',
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("Lean pass", () => {
  const html = render(data([dish(1, 62000)]));

  it("the headline is gone", () => {
    for (const gone of ["Vas a cerrar", "según la proyección", "Cerraste"])
      expect(html).not.toContain(gone);
  });

  it("the removed captions are gone", () => {
    for (const gone of [
      "Margen acumulado menos los costos fijos",
      "· proyección",
      "Los costos fijos son los del mes completo",
      "La proyección sigue el promedio",
      "Todos tus días venden por encima",
    ])
      expect(html).not.toContain(gone);
  });

  it("Resumen de Milton has data-driven lines", () => {
    const box = html.slice(html.indexOf('data-testid="milton-summary"'));
    expect(html).toContain("Resumen de Milton");
    expect(box).toContain("tu punto de equilibrio");
    expect(box).toContain("Si sigues a este ritmo");
    expect(html).not.toMatch(/platillo/i);
  });

  it("a food-share change versus last month adds its line", () => {
    const d = data([dish(1, 62000)]);
    const prev = computeRentabilidad({
      month: "2026-09-01",
      today: "2026-10-27",
      dailySales: { "2026-09-01": 10000 },
      food: {
        cogs: 1000,
        periodSales: 10000,
        foodSales: 10000,
        coveredSales: 10000,
        uncovered: [],
      },
      fixed: {
        amounts: { planilla: 1, alquiler: 1, servicios: 1, otros: 1 },
        impuestosPct: 0,
      },
      openWeekdays: null,
      openDays: 30,
    });
    const out = render({ ...d, findings: miltonFindings(d.month, prev) });
    expect(out).toContain("Comida y bebida subió de 10% a");
  });

  it("no line applies: exactly the short fallback", () => {
    const d = data([dish(1, 62000)]);
    const out = render({
      ...d,
      findings: [],
    });
    expect(out).toContain("Todavía no hay suficientes días para un resumen.");
  });

  it("missing fixed costs use the short strings", () => {
    const out = render(
      data([dish(1, 62000)], {
        planilla: 21400,
        alquiler: null,
        servicios: 3900,
        otros: 9800,
      })
    );
    expect(out).toContain("Te falta 1 dato para ver tu ganancia real.");
    expect(out).not.toContain("Falta cargar tus costos fijos");
  });
});
