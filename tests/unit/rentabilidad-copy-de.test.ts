import { describe, expect, it } from "vitest";
import {
  dayLabelEs,
  emptyMonthSentence,
  monthNameEs,
  pctText,
} from "@/lib/restaurant/rentabilidad-copy";
import { getDictionary } from "@/lib/i18n";
import { formatMoney } from "@/lib/restaurant/costs-format";

describe("Rentabilidad in German and English", () => {
  it("uses the language for months, days and percentages", () => {
    expect(monthNameEs("2026-10-01", "de")).toBe("Oktober");
    expect(dayLabelEs("2026-10-26", "de")).toBe("Montag, 26.");
    expect(pctText(0.608, 1, "de")).toBe("60,8%");
    expect(pctText(0.608, 1, "en")).toBe("60.8%");
    expect(emptyMonthSentence("2026-10-01", "en")).toContain("October");
  });

  it("names the break-even point and the missing price", () => {
    expect(getDictionary("de").rentabilidad.page.breakEvenPerDay).toContain(
      "Break-even-Punkt"
    );
    expect(getDictionary("en").rentabilidad.coverage.reasonNoPrice).toBe(
      "No price"
    );
    expect(getDictionary("de").rentabilidad.coverage.reasonNoPrice).toBe(
      "Kein Preis"
    );
  });

  it("formats German money as 1.234 €", () => {
    expect(formatMoney(1234, "EUR", "de").replace(/\s/g, " ")).toBe("1.234 €");
  });
});
