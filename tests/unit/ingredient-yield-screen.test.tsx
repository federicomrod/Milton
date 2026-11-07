// @vitest-environment jsdom
// Menú › Ingredientes: each ingredient has a «Merma» field. No value reads
// «Sin merma definida» (never 0); managers get «Definir» / «Cambiar»; everyone
// else reads it only; the history shows under it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/ingredientes",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  IngredientesScreen,
  type IngredienteItem,
} from "@/components/restaurant/menu/IngredientesScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: IngredienteItem = {
  id: "i1",
  name: "Aceite demo",
  category: null,
  default_unit: "l",
  price: 4,
  price_unit: "l",
  price_date: "2026-07-01",
  price_entry_id: "e1",
  recipeCount: 1,
  lineCount: 1,
  previous_price: null,
  source: "lista",
  supplier_id: null,
  supplier_name: null,
  inUse: true,
  archived: false,
  sold_net_sales: 10,
  usedIn: [],
};

function show(item: IngredienteItem, canManage: boolean) {
  // The detail asks for unit conversions on mount: nothing to answer here.
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  render(
    <IngredientesScreen
      items={[item]}
      suppliers={[]}
      currency="USD"
      initialSelectedId="i1"
      initialFilter="todos"
      itemGroups={{ available: true, groups: [], members: [] }}
      capabilities={{
        "ingredients.manage": canManage,
        "prices.edit": canManage,
      }}
    />
  );
  return screen.getByTestId("ingredient-yield");
}

describe("Ingredientes › Merma", () => {
  it("no value: «Sin merma definida», not 0, and a manager can «Definir»", () => {
    const box = show({ ...base, yieldPct: null }, true);
    expect(box.textContent).toContain("Sin merma definida");
    expect(box.textContent).not.toMatch(/\b0 ?%/);
    expect(screen.getByRole("button", { name: "Definir" })).toBeTruthy();
  });
  it("a value with history: «35 %», «Cambiar», and the history lines", () => {
    const box = show(
      {
        ...base,
        yieldPct: 35,
        yieldHistory: [
          {
            id: "y1",
            createdAt: "2026-11-10T10:00:00Z",
            effectiveFrom: "2026-09-15",
            who: "Ana Demo",
            isSupport: false,
            oldPct: null,
            newPct: 35,
            kind: "retroactive",
          },
        ],
      },
      true
    );
    expect(box.textContent).toContain("35 %");
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeTruthy();
    expect(box.textContent).toContain("Historial");
    expect(box.textContent).toContain("— → 35 %");
    expect(box.textContent).toContain("retroactivo");
  });
  it("read-only for a non-manager", () => {
    const box = show({ ...base, yieldPct: 35 }, false);
    expect(box.textContent).toContain("35 %");
    expect(screen.queryByRole("button", { name: "Cambiar" })).toBeNull();
    expect(box.textContent).toContain("Solo el propietario");
  });
});
