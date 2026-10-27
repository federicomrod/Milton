import { describe, expect, it } from "vitest";
import {
  ASK_SENT_KEY,
  BRIEFING_EXPANDED_KEY,
  compactBriefingLine,
  isSpecificBriefingItem,
  markAskSent,
  readBriefingExpanded,
  writeBriefingExpanded,
} from "@/lib/restaurant/briefing-compact";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("compactBriefingLine", () => {
  const periods = {
    // 2026-10-26 is a Monday.
    yesterday_date: "2026-10-26",
    yesterday: { sales: 1745.4, delta_pct: 22.3 },
    last_7_days: { sales: 20133, delta_pct: 33.4 },
  };

  it("uses only the computed periods", () => {
    expect(compactBriefingLine(periods, "USD", "es")).toBe(
      "Ayer $1,745 (+22% vs. lun. pasado) · 7 días $20,133 (+33%)"
    );
    expect(compactBriefingLine(periods, "USD", "en")).toBe(
      "Yesterday $1,745 (+22% vs. last Mon) · 7 days $20,133 (+33%)"
    );
  });

  it("drops a comparison it does not have, and returns null with no sales", () => {
    expect(
      compactBriefingLine(
        {
          ...periods,
          yesterday: { sales: null, delta_pct: null },
          last_7_days: { sales: 900, delta_pct: null },
        },
        "USD",
        "es"
      )
    ).toBe("7 días $900");
    expect(
      compactBriefingLine(
        {
          ...periods,
          yesterday: { sales: null, delta_pct: null },
          last_7_days: { sales: null, delta_pct: null },
        },
        "USD",
        "es"
      )
    ).toBeNull();
    expect(compactBriefingLine(null, "USD", "es")).toBeNull();
  });

  it("shows a drop with a minus sign", () => {
    expect(
      compactBriefingLine(
        { ...periods, yesterday: { sales: 800, delta_pct: -12.6 } },
        "USD",
        "es"
      )
    ).toMatch(/^Ayer \$800 \(−13% vs\. lun\. pasado\)/);
  });
});

describe("isSpecificBriefingItem", () => {
  it("drops generic advice and keeps items with a number or a name", () => {
    expect(
      isSpecificBriefingItem("Aumentar la eficiencia en la gestión de costos")
    ).toBe(false);
    expect(isSpecificBriefingItem("Revisar el precio de Pupusa de queso")).toBe(
      true
    );
    expect(isSpecificBriefingItem("3 platos sin receta")).toBe(true);
    expect(isSpecificBriefingItem("El costo subió 12%")).toBe(true);
    expect(isSpecificBriefingItem("")).toBe(false);
  });
});

describe("briefing collapse state", () => {
  it("is collapsed by default and remembers the toggle", () => {
    const s = memStore();
    expect(readBriefingExpanded(s)).toBe(false);
    writeBriefingExpanded(s, true);
    expect(readBriefingExpanded(s)).toBe(true);
    expect(readBriefingExpanded(null)).toBe(false);
  });

  it("stays collapsed after a message was sent this session", () => {
    const s = memStore();
    writeBriefingExpanded(s, true);
    markAskSent(s);
    expect(s.getItem(ASK_SENT_KEY)).toBe("1");
    expect(s.getItem(BRIEFING_EXPANDED_KEY)).toBe("0");
    expect(readBriefingExpanded(s)).toBe(false);
    // «Ver más» still opens it; the next question collapses it again.
    writeBriefingExpanded(s, true);
    expect(readBriefingExpanded(s)).toBe(true);
    markAskSent(s);
    expect(readBriefingExpanded(s)).toBe(false);
  });
});
