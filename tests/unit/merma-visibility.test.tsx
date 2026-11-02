// @vitest-environment jsdom
// Menú › Ingredientes: «Costo real (con merma)» and «Impacto merma». Both go
// through effectiveLineCost, the recipe editor's function. Demo data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/ingredientes",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  IngredientesScreen,
  UsesList,
  type IngredienteItem,
} from "@/components/restaurant/menu/IngredientesScreen";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import { panelRealCost, impactOfUse } from "@/lib/restaurant/merma-visibility";
import type { IngredientUseEntry } from "@/lib/restaurant/ingredient-uses";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("panel value", () => {
  it("own yield: price ÷ (1 − merma)", () => {
    const r = panelRealCost({ price: 10, ownLossPct: 20, bufferPct: 5 });
    expect(r).toEqual({ kind: "real", value: 12.5, source: "own", pct: 20 });
  });
  it("no own yield: the kitchen buffer, labelled as such", () => {
    const r = panelRealCost({ price: 10, ownLossPct: null, bufferPct: 5 });
    expect(r).toEqual({ kind: "real", value: 10.5, source: "buffer", pct: 5 });
  });
  it("missing or non-positive price: none, never $0", () => {
    for (const price of [null, 0, -3])
      expect(panelRealCost({ price, ownLossPct: 20, bufferPct: 5 })).toEqual({
        kind: "none",
      });
  });
  it("matches the editor's function", () => {
    for (const own of [null, 0, 12.5, 35]) {
      const e = effectiveLineCost({
        amount: 8,
        kind: "ingredient",
        ownYieldLossPct: own,
        insideMeasuredPrep: false,
        bufferPct: 5,
      });
      const p = panelRealCost({ price: 8, ownLossPct: own, bufferPct: 5 });
      expect(p.kind === "real" && p.value).toBe(e.effective);
    }
  });
});

describe("impact column", () => {
  const line = (over = {}) => ({
    qty: 2,
    unit: "kg",
    insideMeasuredPrep: false,
    ...over,
  });
  const base = { price: 10, priceUnit: "kg", ownLossPct: null, bufferPct: 5 };

  it("a raw plato line: effective − raw", () => {
    expect(impactOfUse({ ...base, line: line() })).toEqual({
      kind: "extra",
      amount: 20 * 1.05 - 20,
    });
  });
  it("converts the line unit to the price unit", () => {
    const r = impactOfUse({ ...base, line: line({ qty: 500, unit: "g" }) });
    expect(r.kind === "extra" && r.amount).toBeCloseTo(0.25, 9);
  });
  it("under a measured prep: —, no second factor", () => {
    expect(
      impactOfUse({ ...base, line: line({ insideMeasuredPrep: true }) })
    ).toEqual({
      kind: "none",
    });
  });
  it("own yield still applies once inside a measured prep", () => {
    const r = impactOfUse({
      ...base,
      ownLossPct: 20,
      line: line({ insideMeasuredPrep: true }),
    });
    expect(r).toEqual({ kind: "extra", amount: 20 / 0.8 - 20 });
  });
  it("no price: ⚑ Falta, never 0", () => {
    for (const price of [null, 0])
      expect(impactOfUse({ ...base, price, line: line() })).toEqual({
        kind: "missing",
      });
  });
  it("reached only through a preparation (no quantity): —", () => {
    expect(
      impactOfUse({ ...base, line: line({ qty: null, unit: null }) })
    ).toEqual({
      kind: "none",
    });
  });
  it("matches the editor's function", () => {
    const e = effectiveLineCost({
      amount: 20,
      kind: "ingredient",
      ownYieldLossPct: null,
      insideMeasuredPrep: false,
      bufferPct: 5,
    });
    const r = impactOfUse({ ...base, line: line() });
    expect(r.kind === "extra" && r.amount).toBe(e.effective! - 20);
  });
});

const entry = (over: Partial<IngredientUseEntry>): IngredientUseEntry => ({
  key: "plato:1",
  kind: "plato",
  name: "Plato demo",
  status: "aprobada",
  statusLabel: "Aprobada",
  qty: 2,
  unit: "kg",
  via: null,
  href: "/x",
  ...over,
});
const impact = (over = {}) => ({
  price: 10,
  priceUnit: "kg",
  ownLossPct: null,
  bufferPct: 5,
  currency: "USD",
  ...over,
});

describe("«Se usa en» table", () => {
  it("shows +$1.00, — under a measured prep, and ⚑ Falta with no price", () => {
    const usedIn = [
      entry({}),
      entry({
        key: "preparacion:2",
        kind: "preparacion",
        name: "Salsa demo",
        prepMeasured: true,
      }),
    ];
    const { rerender } = render(<UsesList usedIn={usedIn} impact={impact()} />);
    const cells = screen.getAllByTestId("merma-impact");
    expect(cells[0].textContent).toBe("+$1.00");
    expect(cells[1].textContent).toBe("—");
    rerender(<UsesList usedIn={usedIn} impact={impact({ price: null })} />);
    for (const c of screen.getAllByTestId("merma-impact")) {
      expect(c.textContent).toContain("Falta");
      expect(c.textContent).not.toContain("$0");
    }
  });
  it("no column without impact (cooks)", () => {
    render(<UsesList usedIn={[entry({})]} />);
    expect(screen.queryByTestId("merma-impact")).toBeNull();
  });
});

const item: IngredienteItem = {
  id: "i1",
  name: "Aceite demo",
  category: null,
  default_unit: "kg",
  price: 10,
  price_unit: "kg",
  price_date: "2026-07-01",
  recipeCount: 1,
  lineCount: 1,
  previous_price: null,
  source: "lista",
  supplier_id: null,
  supplier_name: null,
  inUse: true,
  archived: false,
  sold_net_sales: 0,
  usedIn: [],
};
function show(over: Partial<IngredienteItem>, caps: Record<string, boolean>) {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  render(
    <IngredientesScreen
      items={[{ ...item, ...over }]}
      suppliers={[]}
      currency="USD"
      initialSelectedId="i1"
      initialFilter="todos"
      itemGroups={{ available: true, groups: [], members: [] }}
      capabilities={caps}
      bufferPct={5}
    />
  );
}
const MANAGER = { "ingredients.manage": true, "prices.edit": true };

describe("panel", () => {
  it("own merma: Costo real with the own label", () => {
    show({ yieldPct: 20 }, MANAGER);
    const box = within(screen.getByTestId("real-cost"));
    expect(box.getByText("$12.50")).toBeTruthy();
    expect(box.getByText(/Merma propia/)).toBeTruthy();
  });
  it("no own merma: buffer fallback, labelled (general)", () => {
    show({}, MANAGER);
    const box = within(screen.getByTestId("real-cost"));
    expect(box.getByText("$10.50")).toBeTruthy();
    expect(box.getByText(/Merma de cocina 5 % \(general\)/)).toBeTruthy();
  });
  it("no price: «Sin precio», never $0", () => {
    show({ price: null }, MANAGER);
    const box = screen.getByTestId("real-cost");
    expect(box.textContent).toContain("Sin precio");
    expect(box.textContent).not.toContain("$0");
  });
  it("hidden for roles without price access", () => {
    show(
      { yieldPct: 20 },
      { "ingredients.manage": false, "prices.edit": false }
    );
    expect(screen.queryByTestId("real-cost")).toBeNull();
  });
});
