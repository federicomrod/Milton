// @vitest-environment jsdom
// «Se usa en»: ⚑ Falta conversión stays out of the total; a plato that reaches
// the ingredient through a preparation shows its share, or — «vía preparación».
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

import { UsesList } from "@/components/restaurant/menu/IngredientesScreen";
import type { IngredientUseEntry } from "@/lib/restaurant/ingredient-uses";
import type { PrepDef } from "@/lib/restaurant/merma-visibility";

afterEach(cleanup);

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
  ingredientId: "tomate",
  ...over,
});
const defs: Record<string, PrepDef> = {
  A: {
    id: "A",
    outputQty: 5,
    outputUnit: "kg",
    measured: false,
    lines: [{ kind: "component", componentId: "B", qty: 1, unit: "kg" }],
  },
  B: {
    id: "B",
    outputQty: 4,
    outputUnit: "kg",
    measured: false,
    lines: [{ kind: "ingredient", ingredientId: "tomate", qty: 2, unit: "kg" }],
  },
};

describe("Se usa en", () => {
  it("«Falta conversión» is flagged and not in the total", () => {
    render(
      <UsesList
        usedIn={[
          entry({}),
          entry({ key: "plato:2", name: "Otro plato demo", unit: "unidad" }),
        ]}
        impact={impact()}
      />
    );
    const cells = screen.getAllByTestId("merma-impact");
    expect(cells[0].textContent).toBe("+$1.00");
    expect(cells[1].textContent).toContain("Falta conversión");
    expect(cells[1].textContent).not.toContain("$0");
    const total = screen.getByTestId("merma-impact-total");
    expect(total.textContent).toContain("+$1.00");
    expect(total.textContent).toContain("1 sin incluir");
  });

  it("through a preparation: the proportional share, 2 levels deep", () => {
    render(
      <UsesList
        usedIn={[
          entry({
            qty: null,
            unit: null,
            via: "a través de la preparación A",
            viaPreps: [{ componentId: "A", qty: 2, unit: "kg" }],
          }),
        ]}
        impact={impact({ prepDefs: defs })}
      />
    );
    expect(screen.getByTestId("merma-impact").textContent).toBe("+$0.10");
  });

  it("when the share cannot be computed: — with the tooltip «vía preparación»", () => {
    render(
      <UsesList
        usedIn={[
          entry({
            qty: null,
            unit: null,
            viaPreps: [{ componentId: "A", qty: 2, unit: "unidad" }],
          }),
        ]}
        impact={impact({ prepDefs: defs })}
      />
    );
    const cell = screen.getByTestId("merma-impact");
    expect(cell.textContent).toBe("—");
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(
      "vía preparación"
    );
  });
});
