import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RaceChart } from "@/components/restaurant/rentabilidad/RaceChart";
import { computeRentabilidad } from "@/lib/restaurant/rentabilidad";

const sales = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [
    `2026-10-${String(i + 1).padStart(2, "0")}`,
    1500 + (i % 7) * 400,
  ])
);
const month = (planilla: number | null) =>
  computeRentabilidad({
    month: "2026-10-01",
    today: "2026-10-27",
    dailySales: sales,
    food: {
      cogs: 19000,
      periodSales: 62000,
      foodSales: 62000,
      coveredSales: 62000,
      uncovered: [],
    },
    fixed: {
      amounts: { planilla, alquiler: 6500, servicios: 3900, otros: 9800 },
      impuestosPct: 0,
    },
    openWeekdays: null,
    openDays: 31,
  });
const money = (n: number) => `$${Math.round(n)}`;

describe("RaceChart", () => {
  const html = renderToStaticMarkup(
    <RaceChart month={month(21400)} money={money} />
  );
  const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));

  it("labels more than the first and last day", () => {
    expect((svg.match(/<text/g) ?? []).length).toBeGreaterThan(2);
  });

  it("has no text inside the plot beyond the day labels", () => {
    expect(svg).not.toContain("Equilibrio");
    expect(svg).not.toContain("Costos fijos");
  });

  it("is the Cockpit chart: 190 px tall, dashed projection and fixed line", () => {
    expect(svg).toContain("h-[190px]");
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain("#0F172A");
  });

  it("shows the legend under the chart", () => {
    expect(html).toContain("Margen acumulado");
    expect(html).toContain("Proyección");
    expect(html).toContain("Costos fijos del mes $41600");
  });

  it("renders nothing when a fixed cost is missing", () => {
    expect(
      renderToStaticMarkup(<RaceChart month={month(null)} money={money} />)
    ).toBe("");
  });
});
