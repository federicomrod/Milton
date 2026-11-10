import { describe, expect, it } from "vitest";
import { GESTION } from "./strings";
import {
  foodCard,
  profitCard,
  salesCard,
  staffCard,
  yesterdayChip,
} from "./home-core";
import { foodCostView } from "./costs-core";
import type { DataReasons, HomeData } from "./types";

type Cards = NonNullable<HomeData["cards"]>;
const g = GESTION.es;

const reasons = (over: Partial<DataReasons> = {}): DataReasons => ({
  hasSales: true,
  foodCost: {
    status: "ok",
    pct: 31.5,
    coveredPct: 0.8,
    uncoveredPct: 0.2,
    uncoveredDishes: 3,
    uncoveredByReason: { sinReceta: 3, borrador: 0, sinPrecio: 0 },
  },
  fixed: { loaded: true, complete: true, missing: [] },
  staff: { loaded: true, pct: 0.27 },
  ...over,
});
const cards = (over: Partial<Cards> = {}): Cards => ({
  sales: {
    value: 12000,
    delta: 8.4,
    compareLabel: "x",
    range: { from: "2026-10-12", to: "2026-11-10" },
  },
  month: "2026-11-01",
  profit: {
    month: "2026-11-01",
    isLatest: false,
    value: 1500,
    pct: 0.12,
    basis: "real",
  },
  foodCostPct: 31.5,
  reasons: reasons(),
  ...over,
});
const none = (c: ReturnType<typeof foodCard>) => {
  expect(c.value).toBeNull();
  expect(c.reason).toBeTruthy();
};

describe("yesterday chip", () => {
  it("is short: delta + the weekday it is compared with, in every language", () => {
    for (const lang of ["es", "en", "de"] as const) {
      const c = yesterdayChip({
        delta: 9,
        date: "2026-11-09",
        lang,
        g: GESTION[lang],
      })!;
      expect(c.tone).toBe("up");
      expect(c.text).toContain("+9 %");
      expect(c.text.length).toBeLessThanOrEqual(22);
      expect(c.text).not.toContain("…");
    }
    expect(
      yesterdayChip({ delta: 9, date: "2026-11-09", lang: "es", g })!.text
    ).toMatch(/^\+9 % vs\. lun/);
  });
  it("is nothing without a comparison", () => {
    expect(
      yesterdayChip({ delta: null, date: "2026-11-09", lang: "es", g })
    ).toBeNull();
  });
});

describe("Inicio cards", () => {
  const a = { currency: "USD", lang: "es" as const, g };
  it("data present: every card has a figure", () => {
    const c = cards();
    expect(salesCard({ cards: c, ...a }).value).toBe("$12,000");
    expect(salesCard({ cards: c, ...a }).chip!.text).toContain("+8 %");
    const p = profitCard({ cards: c, ...a });
    expect(p.value).toBe("$1,500");
    expect(p.note).toBeNull();
    expect(foodCard({ cards: c, lang: "es", g }).value).toBe("32 %");
    expect(staffCard({ cards: c, lang: "es", g }).value).toBe("27 %");
  });

  it("food cost is exactly what Costos shows (same function, same note)", () => {
    const c = cards();
    const v = foodCostView({
      pct: c.foodCostPct,
      reasons: c.reasons!,
      month: c.month!,
      g,
      lang: "es",
    });
    const f = foodCard({ cards: c, lang: "es", g });
    expect(f.note).toBe(v.note);
    expect(f.note).toContain("80 %");
  });

  it("no sales: every card says why and what to do, never — or 0", () => {
    const c = cards({
      sales: null,
      profit: null,
      foodCostPct: null,
      reasons: reasons({
        hasSales: false,
        foodCost: {
          ...reasons().foodCost,
          status: "no_sales",
          pct: null,
          coveredPct: null,
          uncoveredPct: null,
        },
        staff: { loaded: true, pct: null },
      }),
    });
    for (const v of [
      salesCard({ cards: c, ...a }),
      profitCard({ cards: c, ...a }),
      foodCard({ cards: c, lang: "es", g }),
      staffCard({ cards: c, lang: "es", g }),
    ]) {
      none(v);
      expect(`${v.reason}${v.next}`).not.toMatch(/—|\b0 %/);
    }
    expect(foodCard({ cards: c, lang: "es", g }).reason).toContain("noviembre");
  });

  it("dishes without cost: food cost says which input is missing", () => {
    const c = cards({
      foodCostPct: null,
      reasons: reasons({
        foodCost: {
          ...reasons().foodCost,
          status: "no_costed_dishes",
          pct: null,
          coveredPct: 0,
        },
      }),
    });
    const f = foodCard({ cards: c, lang: "es", g });
    none(f);
    expect(f.reason).toBe(g.costs.noCostedDishes);
    expect(f.next).toContain("Menú");
  });

  it("no planilla: «Aún no hay planilla para noviembre. Súbela en la web.»", () => {
    const c = cards({
      reasons: reasons({ staff: { loaded: false, pct: null } }),
    });
    const s = staffCard({ cards: c, lang: "es", g });
    none(s);
    expect(`${s.reason} ${s.next}`).toBe(
      "Aún no hay planilla para noviembre. Súbela en la web."
    );
  });

  it("profit missing: names what is missing for the month, with the next step", () => {
    const c = cards({
      profit: null,
      reasons: reasons({
        fixed: { loaded: false, complete: false, missing: ["planilla"] },
      }),
    });
    const p = profitCard({ cards: c, ...a });
    none(p);
    expect(p.reason).toContain("Aún no hay costos fijos para noviembre");
  });

  it("latest-month fallback: the profit is labelled with its month", () => {
    const c = cards({
      profit: {
        month: "2026-10-01",
        isLatest: true,
        value: 900,
        pct: 0.1,
        basis: "real",
      },
    });
    const p = profitCard({ cards: c, ...a });
    expect(p.value).toBe("$900");
    expect(p.note).toBe("Último mes con datos: octubre de 2026");
  });

  it("an older server (no staff field) still gives a reason, not —", () => {
    const r = reasons();
    delete (r as { staff?: unknown }).staff;
    const s = staffCard({ cards: cards({ reasons: r }), lang: "es", g });
    none(s);
  });

  it("copy exists in en and de too and keeps the placeholders", () => {
    for (const lang of ["en", "de"] as const) {
      const c = cards({
        reasons: reasons({ staff: { loaded: false, pct: null } }),
      });
      const s = staffCard({ cards: c, lang, g: GESTION[lang] });
      expect(s.reason).not.toMatch(/\{|undefined/);
    }
  });
});
