import { describe, it, expect } from "vitest";
import {
  ASK_MILTON_SYSTEM_PROMPT,
  detectIntent,
  formatDateRange,
} from "@/lib/restaurant/ask-milton-prompt";
import { BRIEFING_SYSTEM_PROMPT } from "@/lib/restaurant/briefing-prompt";
import { parseRequestedCount } from "@/lib/restaurant/ask-milton-count";
import {
  relativeWindowDays,
  resolveSalesPeriod,
  foldText,
} from "@/lib/restaurant/ask-milton-sales";
import {
  formatDayLabel,
  formatRangeLabel,
} from "@/lib/restaurant/briefing-periods";
import { loginProblem } from "@/lib/auth/email-confirmation";

describe("German prompt instruction", () => {
  it("tells the model to answer in formal German with the glossary", () => {
    for (const p of [
      String(ASK_MILTON_SYSTEM_PROMPT),
      String(BRIEFING_SYSTEM_PROMPT),
    ]) {
      expect(p).toContain('"en", "es" or "de"');
      expect(p).toContain("«Sie»");
      expect(p).toContain("Umsatz (sales)");
      expect(p).toContain("Gericht (dish)");
      expect(p).not.toContain('either "en" or "es"');
    }
  });
});

describe("German intent routing", () => {
  const cases: Array<[string, string]> = [
    ["Welche Gerichte haben die niedrigste Marge?", "dish_food_cost"],
    ["Welches ist mein rentabelstes Gericht?", "most_profitable_dish"],
    ["Was sind meine meistverkauften Gerichte?", "top_selling_items"],
    ["An welchem Tag verkaufe ich am meisten?", "best_sales_day"],
    ["Welche Zutaten sind am teuersten?", "expensive_ingredients"],
    ["Welche Lieferanten haben die Preise erhöht?", "supplier_risk"],
    ["Welche Rechnungen müssen geprüft werden?", "invoices_needing_review"],
    ["Welche Gerichte haben kein Rezept?", "missing_recipes"],
    ["Wo ist die Kostenabdeckung unvollständig?", "cost_coverage"],
    ["Was sollte ich diese Woche tun?", "agent_recommendations"],
    ["Wie war der Umsatz gestern?", "generic"],
  ];
  for (const [q, intent] of cases) {
    it(`${q} -> ${intent}`, () => expect(detectIntent(q)).toBe(intent));
  }

  it("keeps Spanish and English routing unchanged", () => {
    expect(detectIntent("¿Qué platos tienen peor margen?")).toBe(
      "dish_food_cost"
    );
    expect(detectIntent("What is my most profitable dish?")).toBe(
      "most_profitable_dish"
    );
    expect(detectIntent("¿Cuánto vendí ayer?")).toBe("generic");
  });

  it("reads German counts, windows and months", () => {
    expect(parseRequestedCount("Meine drei besten Gerichte")).toBe(3);
    expect(parseRequestedCount("die 5 meistverkauften Gerichte")).toBe(5);
    expect(relativeWindowDays(foldText("letzte Woche"))).toBe(7);
    expect(relativeWindowDays(foldText("in den letzten 14 Tagen"))).toBe(14);
    const r = resolveSalesPeriod("Umsatz im Oktober", ["2026-10-20"]);
    expect(r?.start).toBe("2026-10-01");
    expect(r?.source).toBe("named_period");
  });
});

describe("German formatting", () => {
  it("formats dates and ranges", () => {
    expect(formatDateRange("2026-10-20", "2026-10-26", "de", 2026)).toBe(
      "vom 20. bis 26. Oktober"
    );
    expect(formatDayLabel("2026-10-22", "de")).toBe("Do. 22 Okt.");
    expect(formatRangeLabel("2026-10-16", "2026-10-22", "de")).toBe(
      "16–22 Okt."
    );
  });
  it("auth messages in German", () => {
    expect(
      loginProblem({ code: "invalid_credentials" }, "de").message
    ).toContain("falsch");
  });
});
