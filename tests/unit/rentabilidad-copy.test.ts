import { describe, expect, it } from "vitest";
import {
  chipTexts,
  findingText,
  emptyMonthSentence,
  NO_SUMMARY_TEXT,
  pctText,
  pointsText,
} from "@/lib/restaurant/rentabilidad-copy";
import {
  computeRentabilidad,
  miltonFindings,
} from "@/lib/restaurant/rentabilidad";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const sales = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [
    `2026-10-${String(i + 1).padStart(2, "0")}`,
    i % 7 === 5 ? 3300 : 1700 + (i % 7) * 100,
  ])
);
const month = computeRentabilidad({
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
    amounts: { planilla: 21400, alquiler: 6500, servicios: 3900, otros: 9800 },
    impuestosPct: 0,
  },
  openWeekdays: null,
  openDays: 31,
});

describe("Rentabilidad copy", () => {
  it("percentages use a comma", () => {
    expect(pctText(0.608)).toBe("60,8%");
    expect(pctText(0.31)).toBe("31%");
    expect(pointsText(8.7)).toBe("8,7%");
  });

  it("the empty month has one plain sentence", () => {
    expect(emptyMonthSentence("2026-10-01")).toBe(
      "Todavía no hay ventas de octubre para calcular tu ganancia."
    );
  });

  it("chips and findings come from real numbers", () => {
    const chips = chipTexts(
      { daysEarlier: 3, profitDelta: 1808 },
      "2026-10-01",
      money
    );
    expect(chips.map((c) => c.text)).toEqual([
      "Cubres tus costos 3 días antes que en septiembre",
      "▲ $1,808 más que en septiembre",
    ]);
    expect(chipTexts(null, "2026-10-01", money)).toEqual([]);
    for (const f of miltonFindings(month)) {
      expect(findingText(f, month, money)).not.toMatch(/platillo/i);
    }
  });

  it("finding texts, every kind", () => {
    const t = (kind: string, amounts: Record<string, number>, extra = {}) =>
      findingText(
        { kind, amounts, ...extra } as Parameters<typeof findingText>[0],
        month,
        money
      );
    expect(t("coverage", {})).toBe(
      "Tu ganancia puede ser menor: faltan recetas o precios en algunos platos."
    );
    expect(t("cost_share_change", { now: 30, before: 28 })).toBe(
      "Comida y bebida subió de 28% a 30% de tus ventas frente a septiembre."
    );
    expect(t("cost_share_change", { now: 28, before: 30 })).toContain(
      "bajó de 30% a 28%"
    );
    expect(
      t(
        "days_below",
        { total: 26, below: 7, breakEven: 905, weakestAvg: 640 },
        { weekday: 2 }
      )
    ).toBe(
      "7 de 26 días vendiste menos de $905, tu punto de equilibrio. Los martes son el día más flojo ($640 en promedio)."
    );
    expect(
      t(
        "days_below",
        { total: 26, below: 0, breakEven: 905, weakestAvg: 1240 },
        { weekday: 2 }
      )
    ).toMatch(/^Ningún día vendiste menos de \$905, tu punto de equilibrio\./);
    expect(
      t(
        "days_below",
        { total: 26, below: 3, breakEven: 905 },
        { estimated: true }
      )
    ).toBe(
      "3 de 26 días vendiste menos de $905, tu punto de equilibrio (estimado)."
    );
    expect(t("projection", { profit: 100 })).toBe(
      "Si sigues a este ritmo, cierras el mes con ganancia."
    );
    expect(t("projection", { profit: -5 })).toContain("con pérdida");
    expect(NO_SUMMARY_TEXT).toBe(
      "Todavía no hay suficientes días para un resumen."
    );
  });
});
