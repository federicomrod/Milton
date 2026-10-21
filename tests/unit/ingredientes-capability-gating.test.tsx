// @vitest-environment jsdom
// Ingredientes follows the server's answer (capabilities prop): without
// ingredients.manage there is no «Agregar ingrediente» and the reason shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const item: IngredienteItem = {
  id: "i1",
  name: "Aceite",
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

function show(flags: Record<string, boolean>) {
  render(
    <IngredientesScreen
      items={[item]}
      suppliers={[]}
      currency="USD"
      initialSelectedId="i1"
      initialFilter="todos"
      itemGroups={{ available: true, groups: [], members: [] }}
      capabilities={flags}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ conversions: [] }),
    }))
  );
});
afterEach(cleanup);

describe("Ingredientes gating", () => {
  it("hides «Agregar» and shows the reason without ingredients.manage", () => {
    show({ "ingredients.manage": false, "prices.edit": true });
    expect(screen.queryByText("+ Agregar ingrediente")).toBeNull();
    expect(
      screen.getAllByText("Tu rol no puede cambiar los ingredientes.").length
    ).toBeGreaterThan(0);
    expect(
      (screen.getByLabelText("Categoría") as HTMLInputElement).disabled
    ).toBe(true);
  });

  it("offers «Agregar» with ingredients.manage", () => {
    show({ "ingredients.manage": true, "prices.edit": true });
    expect(screen.getByText("+ Agregar ingrediente")).toBeTruthy();
    expect(
      screen.queryByText("Tu rol no puede cambiar los ingredientes.")
    ).toBeNull();
  });
});
