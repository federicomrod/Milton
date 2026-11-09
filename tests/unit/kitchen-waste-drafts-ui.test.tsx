// @vitest-environment jsdom
// Cocina: the ingredient picker is always there (preselected with Milton's
// guess), AI drafts are Lavanda, history shows «Sin costo» with the quantity,
// and a draft older than 7 days is «Vencido» but can still be confirmed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

import { KitchenWasteDraftsList } from "@/components/restaurant/kitchen/KitchenWasteDraftsList";
import type { WasteLineRow } from "@/components/restaurant/kitchen/KitchenWasteDrafts";

afterEach(cleanup);

const row = (over: Partial<WasteLineRow>): WasteLineRow => ({
  id: "w1",
  item_name: "Tomate demo",
  ingredient_id: "i1",
  quantity: 3,
  unit: "kg",
  report_date: "2026-10-12",
  status: "draft",
  value: null,
  expired: false,
  ...over,
});
const ingredients = [
  { id: "i1", name: "Tomate demo" },
  { id: "i2", name: "Leche demo" },
];

describe("Cocina waste card", () => {
  it("always shows the ingredient picker, preselected, with a way to clear it", () => {
    render(
      <KitchenWasteDraftsList
        rows={[row({})]}
        ingredients={ingredients}
        currency="USD"
      />
    );
    const picker = screen.getByLabelText(
      "Elige el ingrediente"
    ) as HTMLSelectElement;
    expect(picker.value).toBe("i1");
    expect(
      within(picker).getByRole("option", { name: "Elige el ingrediente" })
    ).toBeTruthy();
  });
  it("the AI tag is Lavanda #DDD6FE", () => {
    const { container } = render(
      <KitchenWasteDraftsList
        rows={[row({})]}
        ingredients={ingredients}
        currency="USD"
      />
    );
    expect(container.innerHTML).toContain("#DDD6FE");
    expect(container.innerHTML).not.toContain("#D8D0F8");
  });
  it("history: «Sin costo» with the quantity; a value only when it has a cost", () => {
    render(
      <KitchenWasteDraftsList
        rows={[
          row({
            id: "a",
            status: "confirmed",
            value: null,
            item_name: "Pan demo",
            quantity: 2,
            unit: "pza",
          }),
          row({
            id: "b",
            status: "confirmed",
            value: 12.5,
            item_name: "Leche demo",
            ingredient_id: "i2",
          }),
        ]}
        ingredients={ingredients}
        currency="USD"
      />
    );
    const lines = screen.getAllByTestId("waste-history-line");
    expect(lines[0].textContent).toContain("Pan demo · 2 pza");
    expect(lines[0].textContent).toContain("Sin costo");
    expect(lines[0].textContent).not.toContain("$0");
    expect(lines[1].textContent).toContain("$13");
  });
  it("a draft past 7 days is «Vencido» and can still be confirmed", () => {
    render(
      <KitchenWasteDraftsList
        rows={[row({ expired: true })]}
        ingredients={ingredients}
        currency="USD"
      />
    );
    const hist = screen.getByTestId("waste-history");
    expect(within(hist).getByText("Vencido")).toBeTruthy();
    expect(
      within(hist).getByRole("button", { name: "Confirmar" })
    ).toBeTruthy();
  });
});
