import { describe, expect, it } from "vitest";
import {
  fixedCostView,
  foodCostView,
  missingForMonth,
  qualityRows,
} from "./costs-core";
import { GESTION } from "./strings";
import type { DataReasons } from "./types";

const g = GESTION.es;
const MONTH = "2026-11-01";

const reasons = (over: Partial<DataReasons> = {}): DataReasons => ({
  hasSales: true,
  foodCost: {
    status: "ok",
    pct: 30,
    coveredPct: 0.8,
    uncoveredPct: 0.2,
    uncoveredDishes: 3,
    uncoveredByReason: { sinReceta: 2, borrador: 1, sinPrecio: 0 },
  },
  fixed: { loaded: true, complete: true, missing: [] },
  ...over,
});

describe("foodCostView", () => {
  it("a figure keeps its value and says how much of the sales it covers", () => {
    const v = foodCostView({
      pct: 30,
      reasons: reasons(),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.value).toBe(30);
    expect(v.reason).toBeNull();
    expect(v.note).toMatch(/80 %/);
  });
  it("no note when every dish sale is costed", () => {
    const r = reasons();
    r.foodCost.coveredPct = 1;
    expect(
      foodCostView({ pct: 30, reasons: r, month: MONTH, g, lang: "es" }).note
    ).toBeNull();
  });
  it("no sales yet: says so for the month, never a dash", () => {
    const v = foodCostView({
      pct: null,
      reasons: reasons({
        hasSales: false,
        foodCost: { ...reasons().foodCost, status: "no_sales", pct: null },
      }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.value).toBeNull();
    expect(v.reason).toBe("Aún no hay ventas en noviembre.");
    expect(v.next).toBeTruthy();
    expect(`${v.reason}${v.next}`).not.toContain("—");
  });
  it("sales but no costed dish: names what is missing (recipes, drafts, prices) and the next step", () => {
    const v = foodCostView({
      pct: null,
      reasons: reasons({
        foodCost: {
          ...reasons().foodCost,
          status: "no_costed_dishes",
          pct: null,
          uncoveredByReason: { sinReceta: 4, borrador: 1, sinPrecio: 2 },
        },
      }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.reason).toContain("4 sin receta");
    expect(v.reason).toContain("1 con receta en borrador");
    expect(v.reason).toContain("2 con ingredientes sin precio");
    expect(v.next).toContain("Menú › Platos");
  });
  it("an older server (no reasons): a plain sentence, still no dash", () => {
    const v = foodCostView({
      pct: null,
      reasons: undefined,
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.reason).toBe(g.costs.kpisNoData);
  });
});

describe("fixedCostView", () => {
  it("none loaded: «Aún no hay costos fijos para noviembre. Súbelos en la web.»", () => {
    const v = fixedCostView({
      total: null,
      reasons: reasons({
        fixed: {
          loaded: false,
          complete: false,
          missing: ["planilla", "alquiler"],
        },
      }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.reason).toBe("Aún no hay costos fijos para noviembre.");
    expect(v.next).toBe("Súbelos en la web.");
  });
  it("partly loaded: lists the missing categories in owner words", () => {
    const v = fixedCostView({
      total: null,
      reasons: reasons({
        fixed: {
          loaded: true,
          complete: false,
          missing: ["alquiler", "impuestos"],
        },
      }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(v.reason).toBe(
      "Faltan costos fijos de noviembre: alquiler, impuestos."
    );
    expect(v.next).toBe("Complétalos en la web.");
  });
  it("loaded: the total", () => {
    expect(
      fixedCostView({
        total: 5000,
        reasons: reasons(),
        month: MONTH,
        g,
        lang: "es",
      }).value
    ).toBe(5000);
  });
});

describe("qualityRows", () => {
  it("dishes without cost (count + share), covered share, fixed costs and pending invoices", () => {
    const q = qualityRows({
      reasons: reasons(),
      pendingInvoices: 2,
      month: MONTH,
      g,
      lang: "es",
    })!;
    expect(q.rows.map((r) => r.key)).toEqual([
      "uncosted",
      "covered",
      "fixed",
      "invoices",
    ]);
    expect(q.rows[0].value).toBe("3 · 20 % de las ventas de platos");
    expect(q.rows[0].tone).toBe("warn");
    expect(q.rows[1]).toMatchObject({ value: "80 %", ratio: 0.8 });
    expect(q.rows[2]).toMatchObject({ value: "Cargados", tone: "ok" });
    expect(q.rows[3].value).toBe("2 por revisar");
    expect(q.note).toBeNull();
  });
  it("no sales: the dish rows are left out (not invented) and the card says when they appear", () => {
    const q = qualityRows({
      reasons: reasons({
        hasSales: false,
        fixed: { loaded: false, complete: false, missing: [] },
      }),
      pendingInvoices: 0,
      month: MONTH,
      g,
      lang: "es",
    })!;
    expect(q.rows.map((r) => r.key)).toEqual(["fixed", "invoices"]);
    expect(q.rows[0].value).toBe("Sin cargar");
    expect(q.rows[1].value).toBe("Ninguna");
    expect(q.note).toBe(g.costs.qualityNoSales);
  });
  it("everything costed reads as such", () => {
    const r = reasons();
    r.foodCost = {
      ...r.foodCost,
      coveredPct: 1,
      uncoveredPct: 0,
      uncoveredDishes: 0,
    };
    const q = qualityRows({
      reasons: r,
      pendingInvoices: null,
      month: MONTH,
      g,
      lang: "es",
    })!;
    expect(q.rows[0]).toMatchObject({
      value: g.costs.qualityAllCosted,
      tone: "ok",
    });
    expect(q.rows.some((x) => x.key === "invoices")).toBe(false);
  });
  it("an older server: only what is known (pending invoices), or nothing", () => {
    expect(
      qualityRows({
        reasons: undefined,
        pendingInvoices: 1,
        month: MONTH,
        g,
        lang: "es",
      })!.rows
    ).toHaveLength(1);
    expect(
      qualityRows({
        reasons: undefined,
        pendingInvoices: null,
        month: MONTH,
        g,
        lang: "es",
      })
    ).toBeNull();
  });
});

describe("missingForMonth", () => {
  it("no sales: one sentence about the month", () => {
    const out = missingForMonth({
      reasons: reasons({ hasSales: false }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Aún no hay ventas en noviembre.");
  });
  it("sales + no fixed costs: only the fixed-costs sentence, with its next step", () => {
    const out = missingForMonth({
      reasons: reasons({
        fixed: { loaded: false, complete: false, missing: [] },
      }),
      month: MONTH,
      g,
      lang: "es",
    });
    expect(out).toEqual([
      "Aún no hay costos fijos para noviembre. Súbelos en la web.",
    ]);
  });
  it("nothing missing, or no reasons: no lines", () => {
    expect(
      missingForMonth({ reasons: reasons(), month: MONTH, g, lang: "es" })
    ).toEqual([]);
    expect(
      missingForMonth({ reasons: undefined, month: MONTH, g, lang: "es" })
    ).toEqual([]);
  });
});
