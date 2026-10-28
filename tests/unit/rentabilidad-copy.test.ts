import { describe, expect, it } from "vitest";
import {
  chipTexts,
  findingText,
  heroSentence,
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

  it("the hero sentence says it is a projection and never says «platillo»", () => {
    const text = heroSentence(month, money);
    expect(text).toContain("según la proyección");
    expect(text).not.toMatch(/platillo/i);
  });

  it("missing fixed costs: no profit sentence", () => {
    const m = computeRentabilidad({
      month: "2026-10-01",
      today: "2026-10-27",
      dailySales: sales,
      food: {
        cogs: 0,
        periodSales: 0,
        foodSales: 0,
        coveredSales: 0,
        uncovered: [],
      },
      fixed: {
        amounts: { planilla: null, alquiler: 1, servicios: 1, otros: 1 },
        impuestosPct: 0,
      },
      openWeekdays: null,
      openDays: 31,
    });
    expect(heroSentence(m, money)).toContain("faltan tus costos fijos");
  });

  it("an estimate reads «estimada»", () => {
    const est = { ...month, basis: "estimada" as const };
    expect(heroSentence(est, money)).toContain("ganancia estimada");
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
});
