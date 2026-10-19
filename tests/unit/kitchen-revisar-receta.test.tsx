// @vitest-environment jsdom
// Revisar receta: matching never pre-selects a guess, ingredients can be
// created from the screen, cost and margin are live and honest, the inline
// price edit warns about the dishes it reaches. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { computeDraftCost } from "@/lib/restaurant/kitchen-draft-costing";
import {
  findExactIngredient,
  suggestIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { KitchenRecipeDraftsCard } from "@/components/restaurant/kitchen/KitchenRecipeDraftsCard";
import { InlinePriceEditor } from "@/components/restaurant/kitchen/InlinePriceEditor";

type Json = Record<string, unknown>;
let ingredients: Json[] = [];
let drafts: Json[] = [];
let calls: Array<{ url: string; method: string; body: Json | null }> = [];
let createStatus: "ok" | "similar" = "ok";

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  createStatus = "ok";
  calls = [];
  ingredients = [
    {
      id: "i-mozz",
      name: "Queso mozzarella",
      default_unit: "kg",
      price: { unit_cost: 8, unit: "kg" },
    },
    { id: "i-pan", name: "Pan", default_unit: "pza", price: null },
  ];
  drafts = [
    {
      id: "d-1",
      dish_name: "Devil Bacon Cheeseburger",
      portions: 2,
      status: "draft",
      confidence: "low",
      per_portion_cost: 99,
      currency: "USD",
      created_at: "2026-10-18T10:00:00Z",
      staff_name: "Ana",
      location_name: "Centro",
      lines: [
        {
          id: "l-1",
          raw_name: "bacon",
          ingredient_id: null,
          ingredient_name: null,
          total_quantity: 0.4,
          unit: "kg",
          per_portion_quantity: null,
          confidence: "low",
          line_cost: null,
        },
        {
          id: "l-2",
          raw_name: "queso fresco",
          ingredient_id: null,
          ingredient_name: null,
          total_quantity: 0.2,
          unit: "kg",
          per_portion_quantity: null,
          confidence: "low",
          line_cost: null,
        },
        {
          id: "l-3",
          raw_name: "pan",
          ingredient_id: "i-pan",
          ingredient_name: "Pan",
          total_quantity: 2,
          unit: "pza",
          per_portion_quantity: 1,
          confidence: "high",
          line_cost: null,
        },
      ],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
      calls.push({ url, method, body });
      if (url.startsWith("/api/restaurant/kitchen/recipe-drafts"))
        return respond({ drafts });
      if (url === "/api/restaurant/kitchen/ingredients" && method === "GET")
        return respond({ ingredients });
      if (url === "/api/restaurant/menu-items")
        return respond({
          menu_items: [{ id: "m-1", name: "Hamburguesa", selling_price: 10 }],
        });
      if (url === "/api/restaurant/kitchen/ingredients" && method === "POST") {
        const name = String(body?.name);
        if (createStatus === "similar") {
          return respond(
            {
              error: `Ya existe "bacon". ¿Usarlo?`,
              existing: { id: "i-bacon", name: "bacon" },
            },
            409
          );
        }
        const created = {
          id: "i-bacon",
          name,
          default_unit: "kg",
          price: null,
        };
        ingredients = [...ingredients, created];
        return respond({
          ingredient: { id: "i-bacon", name, default_unit: "kg" },
        });
      }
      if (url === "/api/restaurant/kitchen/ingredient-aliases")
        return respond({ ok: true, saved: true });
      if (url.endsWith("/usage")) return respond({ dishes: 3, names: [] });
      if (url === "/api/restaurant/kitchen/ingredient-price") {
        ingredients = ingredients.map((i) =>
          i.id === body?.ingredient_id
            ? { ...i, price: { unit_cost: body?.unit_cost, unit: body?.unit } }
            : i
        );
        return respond({ ok: true });
      }
      return respond({});
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openModal() {
  render(
    <KitchenRecipeDraftsCard
      canManage
      locations={[{ id: "loc", name: "Centro" }]}
      focusDraftId="d-1"
    />
  );
  return await screen.findByRole("dialog");
}
const aliasCalls = () =>
  calls.filter((c) => c.url === "/api/restaurant/kitchen/ingredient-aliases");
const combo = (dialog: HTMLElement, n: number) =>
  within(dialog).getByLabelText(
    `Ingrediente de la línea ${n}`
  ) as HTMLInputElement;

describe("matching only suggests", () => {
  it("«bacon» with no such ingredient: nothing pre-selected, and a «+ Crear» option", async () => {
    const dialog = await openModal();
    expect(combo(dialog, 1).value).toBe("");
    fireEvent.focus(combo(dialog, 1));
    fireEvent.change(combo(dialog, 1), { target: { value: "bacon" } });
    expect(
      await screen.findByRole("option", { name: '+ Crear "bacon"' })
    ).toBeTruthy();
  });

  it("«queso fresco» with only «Queso mozzarella»: a suggestion, NOT selected; accepting it only selects it (nothing is taught yet)", async () => {
    const dialog = await openModal();
    expect(combo(dialog, 2).value).toBe("");
    expect(within(dialog).getByText("Queso mozzarella")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 2).value).toBe("Queso mozzarella")
    );
    expect(aliasCalls()).toHaveLength(0);
  });

  it("the pure rules: exact is picked, a shared word is only suggested", () => {
    const list = [{ id: "i-mozz", name: "Queso mozzarella" }];
    expect(findExactIngredient("queso fresco", list)).toBeNull();
    expect(suggestIngredient("queso fresco", list)?.ingredient.id).toBe(
      "i-mozz"
    );
    expect(findExactIngredient("QUESO MOZZARELLA", list)?.id).toBe("i-mozz");
  });
});

describe("names are taught only after a successful Confirmar", () => {
  beforeEach(() => {
    // queso fresco: the bot matched nothing; pan: the bot matched Pan
    drafts[0].lines = [
      {
        id: "l-2",
        raw_name: "queso fresco",
        ingredient_id: null,
        ingredient_name: null,
        total_quantity: 0.2,
        unit: "kg",
        per_portion_quantity: null,
        confidence: "low",
        line_cost: null,
      },
      {
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
        per_portion_quantity: 1,
        confidence: "high",
        line_cost: null,
      },
    ];
  });

  it("confirming saves ONE alias, for the line the reviewer chose (not for what the bot matched)", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 1).value).toBe("Queso mozzarella")
    );
    expect(aliasCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(aliasCalls()).toHaveLength(1));
    expect(aliasCalls()[0].body).toEqual({
      raw_name: "queso fresco",
      ingredient_id: "i-mozz",
    });
    // the alias comes AFTER the recipe was confirmed
    const order = calls.map((c) => `${c.method} ${c.url}`);
    expect(
      order.indexOf("POST /api/restaurant/kitchen/recipe-drafts/d-1/confirm")
    ).toBeGreaterThan(-1);
    expect(
      order.indexOf("POST /api/restaurant/kitchen/ingredient-aliases")
    ).toBeGreaterThan(
      order.indexOf("POST /api/restaurant/kitchen/recipe-drafts/d-1/confirm")
    );
  });

  it("closing the editor without confirming teaches nothing", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 1).value).toBe("Queso mozzarella")
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(aliasCalls()).toHaveLength(0);
    expect(calls.some((c) => c.url.endsWith("/confirm"))).toBe(false);
  });

  it("a failed confirm teaches nothing", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 1).value).toBe("Queso mozzarella")
    );
    const original = fetch as unknown as {
      getMockImplementation: () => (
        url: string,
        init?: RequestInit
      ) => Promise<unknown>;
      mockImplementation: (
        fn: (url: string, init?: RequestInit) => Promise<unknown>
      ) => void;
    };
    const impl = original.getMockImplementation();
    original.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith("/confirm")
        ? respond({ error: "No pude confirmar la receta." }, 500)
        : impl(url, init)
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(aliasCalls()).toHaveLength(0);
  });

  it("changing what the bot matched also teaches the new pick (after confirm)", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    fireEvent.focus(combo(dialog, 2));
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "Queso mozzarella" })
    );
    await waitFor(() =>
      expect(combo(dialog, 2).value).toBe("Queso mozzarella")
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(aliasCalls()).toHaveLength(2));
    expect(aliasCalls().map((c) => c.body)).toEqual(
      expect.arrayContaining([
        { raw_name: "queso fresco", ingredient_id: "i-mozz" },
        { raw_name: "pan", ingredient_id: "i-mozz" },
      ])
    );
  });
});

describe("creating an ingredient from the screen", () => {
  it("«+ Crear bacon» creates it with no price and selects it, showing «Sin precio»", async () => {
    const dialog = await openModal();
    fireEvent.focus(combo(dialog, 1));
    fireEvent.change(combo(dialog, 1), { target: { value: "bacon" } });
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: '+ Crear "bacon"' })
    );
    await waitFor(() => expect(combo(dialog, 1).value).toBe("bacon"));
    const post = calls.find(
      (c) =>
        c.method === "POST" && c.url === "/api/restaurant/kitchen/ingredients"
    )!;
    expect(post.body).toMatchObject({ name: "bacon" });
    expect(post.body).not.toHaveProperty("unit_cost");
    expect(within(dialog).getAllByText("Sin precio").length).toBeGreaterThan(0);
  });

  it("when the name already exists it asks «Ya existe bacon. ¿Usarlo?» and creates nothing", async () => {
    createStatus = "similar";
    ingredients = [
      ...ingredients,
      { id: "i-bacon", name: "bacon", default_unit: "kg", price: null },
    ];
    const dialog = await openModal();
    fireEvent.focus(combo(dialog, 1));
    // "tocino" is a remembered alias of bacon: the list has no such name
    fireEvent.change(combo(dialog, 1), { target: { value: "tocino" } });
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: '+ Crear "tocino"' })
    );
    expect(
      await within(dialog).findByText(/Ya existe "bacon"\. ¿Usarlo\?/)
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usarlo" }));
    await waitFor(() => expect(combo(dialog, 1).value).toBe("bacon"));
  });
});

describe("the cost footer is live and honest", () => {
  it("one unpriced line → «Costo parcial · faltan precios de …», no total", async () => {
    const dialog = await openModal();
    const footer = within(dialog).getByTestId("cost-footer");
    expect(footer.textContent).toContain("Costo parcial · faltan precios de");
    expect(footer.textContent).not.toContain("Costo estimado");
    expect(footer.textContent).toContain("Sin precio de venta");
  });

  it("every line priced → «Costo estimado: $X por porción»; with a selling price above 0 → «Margen estimado»", async () => {
    // bacon and queso get ingredients, and everything has a price
    ingredients = [
      {
        id: "i-mozz",
        name: "Queso mozzarella",
        default_unit: "kg",
        price: { unit_cost: 8, unit: "kg" },
      },
      {
        id: "i-pan",
        name: "Pan",
        default_unit: "pza",
        price: { unit_cost: 0.5, unit: "pza" },
      },
    ];
    drafts[0].lines = [
      {
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso mozzarella",
        total_quantity: 0.5,
        unit: "kg",
        per_portion_quantity: 0.25,
        confidence: "high",
        line_cost: null,
      },
      {
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
        per_portion_quantity: 1,
        confidence: "high",
        line_cost: null,
      },
    ];
    const dialog = await openModal();
    // 0.5 kg × 8 = 4.00, 2 pza × 0.5 = 1.00 → 5.00 for 2 portions = 2.50 each
    await waitFor(() =>
      expect(within(dialog).getByTestId("cost-footer").textContent).toContain(
        "Costo estimado: $2.50 por porción"
      )
    );
    expect(within(dialog).getByTestId("cost-footer").textContent).toContain(
      "Sin precio de venta"
    );
    // the cost follows the quantity
    fireEvent.change(within(dialog).getAllByPlaceholderText("Cant.")[0], {
      target: { value: "1" },
    });
    await waitFor(() =>
      expect(within(dialog).getByTestId("cost-footer").textContent).toContain(
        "Costo estimado: $4.50 por porción"
      )
    );
  });

  it("the arithmetic: margin only with a complete cost and a selling price above 0", () => {
    const prices = new Map([
      ["a", { unit_cost: 4, unit: "kg" }],
      ["b", null],
    ]);
    const lines = [
      {
        key: "1",
        ingredient_id: "a",
        name: "A",
        total_quantity: 1,
        unit: "kg",
      },
      {
        key: "2",
        ingredient_id: "b",
        name: "B",
        total_quantity: 1,
        unit: "kg",
      },
    ];
    const partial = computeDraftCost(lines, prices, 2, 10);
    expect(partial.complete).toBe(false);
    expect(partial.total).toBeNull();
    expect(partial.margin_pct).toBeNull();
    expect(partial.missing).toEqual(["B"]);
    const full = computeDraftCost(lines.slice(0, 1), prices, 2, 10);
    expect(full.per_portion).toBe(2);
    expect(full.margin_pct).toBe(80);
    expect(
      computeDraftCost(lines.slice(0, 1), prices, 2, 0).margin_pct
    ).toBeNull();
    expect(
      computeDraftCost(lines.slice(0, 1), prices, 2, null).margin_pct
    ).toBeNull();
    // a unit that cannot be read in the price's unit is not costed
    const bad = computeDraftCost(
      [
        {
          key: "1",
          ingredient_id: "a",
          name: "A",
          total_quantity: 1,
          unit: "pza",
        },
      ],
      prices,
      1,
      null
    );
    expect(bad.complete).toBe(false);
    expect(bad.missing).toEqual(["A"]);
  });
});

describe("the Cocina card computes the cost live (not the frozen snapshot)", () => {
  it("shows «Costo parcial …» and «Faltan precios: N», not the stored $99", async () => {
    render(
      <KitchenRecipeDraftsCard
        canManage
        locations={[{ id: "loc", name: "Centro" }]}
      />
    );
    const item = await screen.findByText("Devil Bacon Cheeseburger");
    const card = item.closest("div.rounded-lg") as HTMLElement;
    await waitFor(() =>
      expect(card.textContent).toContain("Costo parcial · faltan precios de")
    );
    expect(card.textContent).not.toContain("99");
    expect(card.textContent).toContain("Faltan precios: 1");
  });

  it("«Poner precios» opens the same inline price edit for the ingredients without a price", async () => {
    drafts[0].lines = [
      {
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
        per_portion_quantity: 1,
        confidence: "high",
        line_cost: null,
      },
    ];
    render(
      <KitchenRecipeDraftsCard
        canManage
        locations={[{ id: "loc", name: "Centro" }]}
      />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Poner precios" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Editar precio" })
    );
    expect(await screen.findByText(/Esto cambia el precio de/)).toBeTruthy();
  });
});

describe("the inline price edit", () => {
  it("warns about the N dishes and saves through the one endpoint", async () => {
    const onSaved = vi.fn();
    render(
      <InlinePriceEditor
        ingredient={{ id: "i-pan", name: "Pan", default_unit: "pza" }}
        onSaved={onSaved}
        onCancel={() => {}}
      />
    );
    expect(await screen.findByText(/Esto cambia el precio de/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("inline-price-editor").textContent).toContain(
        "en todos los platos (3 platos)."
      )
    );
    const save = screen.getByRole("button", {
      name: "Guardar precio",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // no price typed yet
    fireEvent.change(screen.getByLabelText("Precio de Pan"), {
      target: { value: "0.6" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const post = calls.filter(
      (c) => c.url === "/api/restaurant/kitchen/ingredient-price"
    );
    expect(post).toHaveLength(1);
    expect(post[0].body).toEqual({
      ingredient_id: "i-pan",
      unit: "pza",
      unit_cost: 0.6,
    });
  });
});

describe("an ingredient that is no longer active", () => {
  const deadLine = {
    id: "l-9",
    raw_name: "bacon",
    ingredient_id: "i-dead",
    ingredient_name: "Bacon",
    total_quantity: 0.4,
    unit: "kg",
    per_portion_quantity: 0.2,
    confidence: "high",
    line_cost: null,
  };

  it("a line on an archived / merged-away ingredient shows NO selection and Confirmar stays disabled until a new one is chosen", async () => {
    drafts[0].lines = [deadLine];
    const dialog = await openModal();
    await waitFor(() => expect(combo(dialog, 1).value).toBe(""));
    expect(combo(dialog, 1).placeholder).toBe("bacon");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirmar",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    // choosing a live ingredient enables it
    fireEvent.focus(combo(dialog, 1));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Pan" }));
    await waitFor(() => expect(combo(dialog, 1).value).toBe("Pan"));
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Confirmar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false); // a live ingredient is chosen: portions, quantity and unit are all there
  });

  it("the unsure messages use the neutral gray, not the amber that reads as orange", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      "components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx",
      "utf8"
    );
    expect(src).not.toContain("a35a00");
    const dialog = await openModal();
    const footer = within(dialog).getByTestId("cost-footer");
    expect(footer.innerHTML).not.toMatch(/a35a00/i);
  });
});

describe("rules of the screen", () => {
  it("no orange anywhere in the new pieces", async () => {
    const { readFileSync } = await import("fs");
    for (const f of [
      "components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx",
      "components/restaurant/kitchen/IngredientCombobox.tsx",
      "components/restaurant/kitchen/InlinePriceEditor.tsx",
    ])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/f28c28|e07b1|orange-/i);
  });
});
