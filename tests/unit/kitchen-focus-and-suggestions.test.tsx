// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findExactIngredient,
  suggestIngredient,
  suggestPreparation,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { KitchenRecipeDraftsCard } from "@/components/restaurant/kitchen/KitchenRecipeDraftsCard";

type Json = Record<string, unknown>;
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
const mkLine = (over: Json) => ({
  id: "l-1",
  raw_name: "",
  ingredient_id: null,
  ingredient_name: null,
  total_quantity: 1,
  unit: "kg",
  per_portion_cost: null,
  per_portion_quantity: null,
  confidence: "low",
  line_cost: null,
  ...over,
});
const mkDraft = (id: string, name: string, lines: Json[] = []) => ({
  id,
  dish_name: name,
  portions: 2,
  status: "draft",
  confidence: "low",
  per_portion_cost: null,
  currency: "USD",
  created_at: "2026-10-18T10:00:00Z",
  staff_name: "Ana",
  location_name: "Centro",
  lines,
});

let drafts: Json[] = [];
let ingredients: Json[] = [];
let components: Json[] = [];

beforeEach(() => {
  ingredients = [{ id: "i-soya", name: "Salsa de soya", price: null }];
  components = [];
  drafts = [mkDraft("old", "Sopa de frijoles"), mkDraft("other", "Otro plato")];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/restaurant/kitchen/recipe-drafts"))
        return ok({ drafts });
      if (url === "/api/restaurant/kitchen/ingredients")
        return ok({ ingredients });
      if (url === "/api/restaurant/prepared-components")
        return ok({ components });
      if (url === "/api/restaurant/menu-items") return ok({ menu_items: [] });
      return ok({});
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const locs = [{ id: "loc", name: "Centro" }];

describe("the deep link opens its draft at most once", () => {
  it("opens on the first load, not again after close + reload, and tells the parent", async () => {
    const consumed = vi.fn();
    const ui = (reloadSignal: number, focus: string | null) => (
      <KitchenRecipeDraftsCard
        canManage
        locations={locs}
        focusDraftId={focus}
        onFocusConsumed={consumed}
        reloadSignal={reloadSignal}
      />
    );
    const { rerender } = render(ui(0, "old"));
    await screen.findByRole("dialog", { name: /Revisar receta/ });
    expect(consumed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // an upload finished: the list reloads while the parent still holds the id
    drafts = [...drafts, mkDraft("new1", "Sopa de res")];
    rerender(ui(1, "old"));
    await screen.findByText("Sopa de res");
    expect(screen.queryByRole("dialog")).toBeNull();

    // a NEW id opens that one once
    rerender(ui(1, null));
    rerender(ui(1, "other"));
    const dialog = await screen.findByRole("dialog", {
      name: /Revisar receta/,
    });
    expect(within(dialog).getByDisplayValue("Otro plato")).toBeTruthy();
    expect(consumed).toHaveBeenCalledTimes(2);
  });

  it("an upload opens no modal and marks only the new drafts as «Nuevo» until the next reload", async () => {
    const { rerender } = render(
      <KitchenRecipeDraftsCard canManage locations={locs} reloadSignal={0} />
    );
    await screen.findByText("Sopa de frijoles");
    expect(screen.queryByText("Nuevo")).toBeNull();

    drafts = [
      ...drafts,
      mkDraft("n1", "Sopa de res"),
      mkDraft("n2", "Pasteles de carne"),
    ];
    rerender(
      <KitchenRecipeDraftsCard canManage locations={locs} reloadSignal={1} />
    );
    await screen.findByText("Pasteles de carne");
    await waitFor(() => expect(screen.getAllByText("Nuevo")).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    const old = screen.getByText("Sopa de frijoles").closest("[data-new]");
    expect(old).toBeNull();
  });
});

describe("suggestions need a meaningful name match", () => {
  const cat = [
    { id: "a", name: "Salsa de soya" },
    { id: "b", name: "Tomate" },
    { id: "c", name: "Queso mozzarella rallado" },
    { id: "d", name: "Cebolla" },
    { id: "e", name: "Pechuga de pollo" },
  ];
  it("a shared generic word alone is not enough", () => {
    expect(suggestIngredient("salsa roja", cat)).toBeNull();
    expect(suggestIngredient("queso fresco", cat)).toBeNull();
    expect(findExactIngredient("salsa roja", cat)).toBeNull();
  });
  it("identifying words still suggest", () => {
    expect(suggestIngredient("tomate cherry", cat)?.ingredient.id).toBe("b");
    expect(suggestIngredient("queso mozzarella", cat)?.ingredient.id).toBe("c");
    expect(suggestIngredient("cebolla morada", cat)?.ingredient.id).toBe("d");
    expect(suggestIngredient("pollo", cat)?.ingredient.id).toBe("e");
    expect(suggestIngredient("jitomate", cat)?.ingredient.id).toBe("b");
  });
  it("two different qualifiers do not match", () => {
    expect(
      suggestIngredient("chile rojo", [{ id: "x", name: "Chile verde" }])
    ).toBeNull();
  });
  it("preparations: qualifiers in parentheses are ignored", () => {
    const preps = [
      { name: "Salsa roja (para pupusas y pasteles)" },
      { name: "Chimol" },
    ];
    expect(suggestPreparation("salsa roja", preps)?.name).toContain("roja");
    expect(suggestPreparation("chimol", preps)?.name).toBe("Chimol");
    expect(suggestPreparation("salsa de soya", preps)).toBeNull();
  });
});

describe("the modal", () => {
  const open = async (lineName: string) => {
    drafts = [
      mkDraft("d1", "Pasteles de carne", [mkLine({ raw_name: lineName })]),
    ];
    render(
      <KitchenRecipeDraftsCard canManage locations={locs} focusDraftId="d1" />
    );
    return await screen.findByRole("dialog", { name: /Revisar receta/ });
  };

  it("«salsa roja» is not suggested as Salsa de soya", async () => {
    const dialog = await open("salsa roja");
    expect(within(dialog).queryByText(/¿Es/)).toBeNull();
    expect(within(dialog).queryByText("Salsa de soya")).toBeNull();
  });

  it("a preparation draft from the same upload shows an information hint without a button", async () => {
    drafts = [
      mkDraft("p1", "Salsa roja (para pupusas y pasteles) · preparación"),
    ];
    const dialog = await (async () => {
      drafts.push(
        mkDraft("d1", "Pasteles de carne", [mkLine({ raw_name: "salsa roja" })])
      );
      render(
        <KitchenRecipeDraftsCard canManage locations={locs} focusDraftId="d1" />
      );
      return await screen.findByRole("dialog", { name: /Revisar receta/ });
    })();
    const hint = await within(dialog).findByTestId("preparation-hint");
    expect(hint.textContent).toContain("Parece la preparación «Salsa roja»");
    expect(hint.textContent).toContain("Menú › Preparaciones");
    expect(
      within(dialog).queryByRole("button", { name: "Sí, usarlo" })
    ).toBeNull();
  });

  it("an existing prepared component also triggers the hint («chimol»)", async () => {
    components = [{ id: "c1", name: "Chimol" }];
    const dialog = await open("chimol");
    const hint = await within(dialog).findByTestId("preparation-hint");
    expect(hint.textContent).toContain("«Chimol»");
  });
});
