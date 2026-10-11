import { describe, it, expect } from "vitest";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { buildCockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";
import {
  aiWordingIsGrounded,
  applyAiWordingOrFallback,
  selectCockpitInsights,
  wordedFromFacts,
} from "@/lib/restaurant/cockpit-insights";

function row(
  partial: Partial<CockpitFactRow> & Pick<CockpitFactRow, "sale_date">
): CockpitFactRow {
  return {
    raw_item_name: "Pupusa",
    quantity: 1,
    gross_revenue: 10,
    discount_amount: 0,
    check_id: "o1",
    currency: "USD",
    sales_channel: "in_store",
    ...partial,
  };
}

function snapshot() {
  const rows: CockpitFactRow[] = [
    row({
      sale_date: "2026-07-18",
      check_id: "w1",
      gross_revenue: 40,
      sales_channel: "in_store",
    }),
    row({
      sale_date: "2026-07-20",
      check_id: "w2",
      gross_revenue: 40,
      sales_channel: "delivery",
    }),
    row({
      sale_date: "2026-07-25",
      check_id: "d1",
      gross_revenue: 20,
      sales_channel: "in_store",
    }),
    row({
      sale_date: "2026-07-26",
      check_id: "d2",
      gross_revenue: 20,
      sales_channel: "in_store",
    }),
    row({
      sale_date: "2026-07-27",
      check_id: "d3",
      gross_revenue: 20,
      sales_channel: "in_store",
    }),
    row({
      sale_date: "2026-07-28",
      check_id: "d4",
      gross_revenue: 80,
      sales_channel: "delivery",
    }),
    row({
      sale_date: "2026-07-29",
      check_id: "d5",
      gross_revenue: 20,
      sales_channel: "in_store",
    }),
  ];
  return buildCockpitPeriodSnapshot(
    rows,
    resolveCockpitPeriod("last_7", "2026-07-31")!,
    { currency: "USD", lang: "es" }
  );
}

describe("insight selection is deterministic", () => {
  it("picks the same max-3 insights for the same snapshot", () => {
    const snap = snapshot();
    const a = selectCockpitInsights(snap, "es");
    const b = selectCockpitInsights(snap, "es");
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.some((i) => i.kind === "data_health_costs")).toBe(true);
  });

  it("never invents a generic commentary insight", () => {
    const kinds = selectCockpitInsights(snapshot(), "es").map((i) => i.kind);
    expect(kinds.every((k) => k !== undefined)).toBe(true);
    expect(kinds).not.toContain("generic");
  });
});

describe("AI number-validation fallback", () => {
  it("keeps fallback when the model invents a number", () => {
    const facts = selectCockpitInsights(snapshot(), "es");
    const fallback = wordedFromFacts(facts);
    const { insights, usedFallback } = applyAiWordingOrFallback(facts, [
      {
        id: facts[0].id,
        title: facts[0].title,
        body: "Las ventas fueron 999999 y eso no está en los hechos.",
      },
    ]);
    expect(usedFallback).toBe(true);
    expect(insights[0].body).toBe(fallback[0].body);
  });

  it("accepts wording that only reuses fact numbers", () => {
    const facts = selectCockpitInsights(snapshot(), "es");
    const grounded = facts[0];
    const numbers = Object.values(grounded.facts).filter(
      (v) => typeof v === "number"
    );
    const n = numbers[0] ?? 0;
    expect(
      aiWordingIsGrounded(`Cobertura ${n} de las ventas.`, grounded.facts)
    ).toBe(true);
    expect(
      aiWordingIsGrounded("Inventé el 99 por ciento.", grounded.facts)
    ).toBe(false);

    const { usedFallback, insights } = applyAiWordingOrFallback(facts, [
      {
        id: grounded.id,
        title: grounded.title,
        body: `Cobertura ${n} de las ventas.`,
      },
    ]);
    expect(usedFallback).toBe(facts.length > 1);
    expect(insights[0].body).toBe(`Cobertura ${n} de las ventas.`);
  });
});
