import { describe, it, expect } from "vitest";
import { resolveOdooCompanySelection } from "@/lib/restaurant/odoo/company-selection";

const A = { id: 1, name: "A" };
const B = { id: 2, name: "B" };

describe("resolveOdooCompanySelection", () => {
  it("auto-selects when exactly one company is accessible", () => {
    expect(
      resolveOdooCompanySelection({ accessible: [B], existing: null })
    ).toEqual({ ok: true, selected: [2], selectionRequired: false });
  });

  it("never guesses with several accessible and no existing selection", () => {
    expect(
      resolveOdooCompanySelection({ accessible: [A, B], existing: null })
    ).toEqual({ ok: true, selected: null, selectionRequired: true });
  });

  it("keeps an existing selection that is still accessible", () => {
    expect(
      resolveOdooCompanySelection({ accessible: [A, B], existing: [1, 2] })
    ).toEqual({ ok: true, selected: [1, 2], selectionRequired: false });
  });

  it("drops an existing selection that is no longer accessible", () => {
    expect(
      resolveOdooCompanySelection({ accessible: [A, B], existing: [1, 3] })
    ).toEqual({ ok: true, selected: null, selectionRequired: true });
  });

  it("accepts a valid request", () => {
    expect(
      resolveOdooCompanySelection({
        requested: [1, 2],
        accessible: [A, B],
        existing: null,
      })
    ).toEqual({ ok: true, selected: [1, 2], selectionRequired: false });
  });

  it("rejects an inaccessible requested ID with the accessible list", () => {
    const r = resolveOdooCompanySelection({
      requested: [1, 99],
      accessible: [A, B],
      existing: null,
    });
    expect(r).toMatchObject({ ok: false, status: 400, accessible: [A, B] });
  });

  it("rejects an empty or non-array request", () => {
    for (const requested of [[], "1", [1.5], ["1"]]) {
      const r = resolveOdooCompanySelection({
        requested,
        accessible: [A, B],
        existing: [1],
      });
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("errors with 409 when no company is accessible", () => {
    const r = resolveOdooCompanySelection({ accessible: [], existing: null });
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      error: "Odoo user has no accessible companies",
    });
  });
});
