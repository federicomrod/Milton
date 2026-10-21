// @vitest-environment jsdom
// Revisar receta, simple and calm: a table, unit dropdowns, one-field price
// popover, sentence-case names, one-line footer. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "fs";
import { computeDraftCost } from "@/lib/restaurant/kitchen-draft-costing";
import {
  findExactIngredient,
  suggestIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { mapKitchenUnit, KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import { sentenceCase } from "@/lib/restaurant/sentence-case";
import {
  CostFooter,
  KitchenRecipeDraftsCard,
} from "@/components/restaurant/kitchen/KitchenRecipeDraftsCard";
import { PricePopover } from "@/components/restaurant/kitchen/PricePopover";

type Json = Record<string, unknown>;
let ingredients: Json[] = [];
let drafts: Json[] = [];
let calls: Array<{ url: string; method: string; body: Json | null }> = [];
let createStatus: "ok" | "similar" = "ok";
let usageDishes = 3;
let confirmFails = false;

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const line = (over: Json) => ({
  id: "l-1",
  raw_name: "",
  ingredient_id: null,
  ingredient_name: null,
  total_quantity: 1,
  unit: "kg",
  per_portion_quantity: null,
  confidence: "low",
  line_cost: null,
  ...over,
});

beforeEach(() => {
  createStatus = "ok";
  usageDishes = 3;
  confirmFails = false;
  calls = [];
  ingredients = [
    {
      id: "i-mozz",
      name: "QUESO MOZZARELLA",
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
        line({ id: "l-1", raw_name: "bacon", total_quantity: 0.4 }),
        line({ id: "l-2", raw_name: "queso fresco", total_quantity: 0.2 }),
        line({
          id: "l-3",
          raw_name: "pan",
          ingredient_id: "i-pan",
          ingredient_name: "Pan",
          total_quantity: 2,
          unit: "pza",
        }),
      ],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/confirm") && confirmFails)
        return respond({ error: "No tienes permiso para cambiar esto." }, 403);
      if (
        url === "/api/restaurant/kitchen/recipe-drafts/d-1" &&
        method === "PATCH"
      ) {
        // behave like the server: store what was sent (numbers as numeric text)
        const sent = (body?.lines ?? []) as Json[];
        const stored = sent.map((l, i) => ({
          ...l,
          id: String(l.id).startsWith("new-") ? `s-${i}` : l.id,
          total_quantity:
            l.total_quantity === null ? null : String(l.total_quantity),
        }));
        drafts[0] = {
          ...drafts[0],
          dish_name: body?.dish_name,
          portions: body?.portions ?? drafts[0].portions,
          menu_item_id: body?.menu_item_id ?? null,
          lines: stored,
        };
        return respond({ ok: true, lines: stored });
      }
      if (url.startsWith("/api/restaurant/kitchen/recipe-drafts")) {
        return method === "GET" ? respond({ drafts }) : respond({ ok: true });
      }
      if (url === "/api/restaurant/kitchen/ingredients" && method === "GET")
        return respond({ ingredients });
      if (url === "/api/restaurant/menu-items")
        return respond({
          menu_items: [{ id: "m-1", name: "Hamburguesa", selling_price: 10 }],
        });
      if (url === "/api/restaurant/kitchen/ingredients" && method === "POST") {
        if (createStatus === "similar") {
          return respond(
            {
              error: 'Ya existe "bacon". ¿Usarlo?',
              existing: { id: "i-bacon", name: "bacon" },
            },
            409
          );
        }
        const name = String(body?.name);
        ingredients = [
          ...ingredients,
          { id: "i-new", name, default_unit: "kg", price: null },
        ];
        return respond({
          ingredient: { id: "i-new", name, default_unit: "kg" },
        });
      }
      if (url === "/api/restaurant/kitchen/ingredient-aliases")
        return respond({ ok: true, saved: true });
      if (url.endsWith("/usage"))
        return respond({ dishes: usageDishes, names: [] });
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
  return await screen.findByRole("dialog", { name: /Revisar receta/ });
}
const aliasCalls = () =>
  calls.filter((c) => c.url === "/api/restaurant/kitchen/ingredient-aliases");
const combo = (dialog: HTMLElement, n: number) =>
  within(dialog).getByLabelText(
    `Ingrediente de la línea ${n}`
  ) as HTMLInputElement;
const unitSelect = (dialog: HTMLElement, n: number) =>
  within(dialog).getByLabelText(`Unidad de la línea ${n}`) as HTMLSelectElement;
const confirmButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", {
    name: "Confirmar",
  }) as HTMLButtonElement;

describe("the layout", () => {
  it("is a wide dialog with the ingredients as a table (Ingrediente | Cantidad | Unidad | Costo), top fields in one row, and no per-line sentence", async () => {
    const dialog = await openModal();
    expect(dialog.className).toContain("sm:max-w-[960px]");
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("max-sm:h-dvh");
    const headers = within(dialog)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.slice(0, 4)).toEqual([
      "Ingrediente",
      "Cantidad",
      "Unidad",
      "Costo",
    ]);
    expect(within(dialog).getAllByRole("row")).toHaveLength(1 + 3);
    for (const label of [
      "Nombre del platillo",
      "Porciones",
      "Platillo del menú",
      "Precio de venta",
    ])
      expect(within(dialog).getByText(label)).toBeTruthy();
    expect(dialog.textContent).not.toContain("Costo de la línea");
    expect(within(dialog).queryByText("Editar precio")).toBeNull();
    const price = within(dialog).getByPlaceholderText(
      "Sin precio"
    ) as HTMLInputElement;
    expect(price.value).toBe("");
  });
});

describe("matching only suggests", () => {
  it("«bacon» with no such ingredient: the cook's word in the box, a «+ Crear» chip, nothing selected", async () => {
    const dialog = await openModal();
    expect(combo(dialog, 1).value).toBe("bacon");
    expect(
      within(dialog).getByRole("button", { name: 'Crear "Bacon"' })
    ).toBeTruthy();
    expect(confirmButton(dialog).disabled).toBe(true);
  });

  it("«queso fresco» with only «Queso mozzarella»: «¿Es Queso mozzarella?», NOT selected; accepting it selects it and teaches nothing yet", async () => {
    const dialog = await openModal();
    expect(combo(dialog, 2).value).toBe("queso fresco");
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

describe("creating an ingredient: one click, sentence case", () => {
  it("the «+ Crear» chip saves «Bacon» (sentence case) with no price, selects it and shows «Sin precio»", async () => {
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: 'Crear "Bacon"' })
    );
    await waitFor(() => expect(combo(dialog, 1).value).toBe("Bacon"));
    const post = calls.find(
      (c) =>
        c.method === "POST" && c.url === "/api/restaurant/kitchen/ingredients"
    )!;
    expect(post.body).toMatchObject({ name: "Bacon", unit: "kg" });
    expect(post.body).not.toHaveProperty("unit_cost");
    expect(within(dialog).getAllByText("Sin precio").length).toBeGreaterThan(0);
  });

  it("when the name already exists it asks «Ya existe …¿Usarlo?» and creates nothing", async () => {
    createStatus = "similar";
    ingredients = [
      ...ingredients,
      { id: "i-bacon", name: "bacon", default_unit: "kg", price: null },
    ];
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: 'Crear "Bacon"' })
    );
    expect(
      await within(dialog).findByText(/Ya existe "Bacon"\. ¿Usarlo\?/)
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usarlo" }));
    await waitFor(() => expect(combo(dialog, 1).value).toBe("Bacon"));
  });

  it("names are SHOWN in sentence case without renaming anything", async () => {
    ingredients = [
      {
        id: "i-pat",
        name: "PATTIES DE HAMBURGUESA",
        default_unit: "pza",
        price: null,
      },
      ...ingredients,
    ];
    const dialog = await openModal();
    fireEvent.focus(combo(dialog, 1));
    fireEvent.change(combo(dialog, 1), { target: { value: "patt" } });
    expect(
      await screen.findByRole("option", { name: "Patties de hamburguesa" })
    ).toBeTruthy();
    expect(sentenceCase("QUESO  MOZAREllA")).toBe("Queso mozarella");
    expect(
      calls.some((c) => c.method === "PATCH" && c.url.includes("/ingredients"))
    ).toBe(false);
  });
});

describe("units are a dropdown", () => {
  it("whatever was said is mapped: gramos→g, piezas→pza, grams→g, kilos→kg, litro→l, unit→unidad", () => {
    expect(mapKitchenUnit("gramos")).toBe("g");
    expect(mapKitchenUnit("grams")).toBe("g");
    expect(mapKitchenUnit("gr")).toBe("g");
    expect(mapKitchenUnit("piezas")).toBe("pza");
    expect(mapKitchenUnit("pz")).toBe("pza");
    expect(mapKitchenUnit("kilos")).toBe("kg");
    expect(mapKitchenUnit("kilo")).toBe("kg");
    expect(mapKitchenUnit("litro")).toBe("l");
    expect(mapKitchenUnit("unidades")).toBe("unidad");
    expect(mapKitchenUnit("unit")).toBe("unidad");
    expect(mapKitchenUnit("onzas")).toBe("oz");
    expect(mapKitchenUnit("libras")).toBe("lb");
    expect(mapKitchenUnit("ML")).toBe("ml");
    expect(mapKitchenUnit("xyz")).toBeNull();
    expect(mapKitchenUnit("")).toBeNull();
    expect(KITCHEN_UNITS.map((u) => u.value)).toEqual([
      "g",
      "kg",
      "ml",
      "l",
      "pza",
      "unidad",
      "oz",
      "lb",
      "orden",
    ]);
  });

  it("the modal shows the mapped unit; an unknown one leaves the dropdown empty and Confirmar disabled until chosen", async () => {
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "piezas",
      }),
      line({
        id: "l-2",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 300,
        unit: "gramos",
      }),
      line({
        id: "l-3",
        raw_name: "salsa",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 1,
        unit: "cucharadita rara",
      }),
    ];
    const dialog = await openModal();
    expect(unitSelect(dialog, 1).value).toBe("pza");
    expect(unitSelect(dialog, 2).value).toBe("g");
    expect(unitSelect(dialog, 3).value).toBe("");
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.change(unitSelect(dialog, 3), { target: { value: "kg" } });
    await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));
    // the dropdown has exactly the nine units (plus the empty one)
    expect(within(unitSelect(dialog, 1)).getAllByRole("option")).toHaveLength(
      10
    );
  });
});

describe("the price popover", () => {
  beforeEach(() => {
    drafts[0].lines = [
      line({
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
      }),
    ];
  });

  it("«Sin precio» opens ONE field and one blue «Guardar», with the dishes in small gray text; no Cancelar", async () => {
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Precio de Pan" })
    );
    const popover = await within(dialog).findByTestId("price-popover");
    expect(within(popover).getByText("Precio por")).toBeTruthy();
    expect(within(popover).getAllByRole("spinbutton")).toHaveLength(1);
    const save = within(popover).getByRole("button", {
      name: "Guardar",
    }) as HTMLButtonElement;
    expect(save.className).toContain("bg-[#1B40C8]");
    expect(save.disabled).toBe(true); // nothing typed
    expect(within(popover).queryByText("Cancelar")).toBeNull();
    expect(
      await within(popover).findByText(
        "Se actualiza en los 3 platos que usan este ingrediente."
      )
    ).toBeTruthy();
  });

  it("with 0 dishes the sentence is not shown", async () => {
    usageDishes = 0;
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Precio de Pan" })
    );
    await within(dialog).findByTestId("price-popover");
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/usage"))).toBe(true)
    );
    expect(within(dialog).queryByText(/Se actualiza en/)).toBeNull();
  });

  it("saving calls the price endpoint ONCE, closes the popover and the line shows its cost", async () => {
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Precio de Pan" })
    );
    const popover = await within(dialog).findByTestId("price-popover");
    fireEvent.change(within(popover).getByLabelText("Precio de Pan"), {
      target: { value: "0.5" },
    });
    fireEvent.click(within(popover).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(within(dialog).queryByTestId("price-popover")).toBeNull()
    );
    const saves = calls.filter(
      (c) => c.url === "/api/restaurant/kitchen/ingredient-price"
    );
    expect(saves).toHaveLength(1);
    expect(saves[0].body).toEqual({
      ingredient_id: "i-pan",
      unit: "pza",
      unit_cost: 0.5,
      draft_id: "d-1",
    });
    // 2 pza × $0.50 = $1.00
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Precio de Pan" })
          .textContent
      ).toBe("$1.00")
    );
  });

  it("clicking outside closes it, without saving", async () => {
    const dialog = await openModal();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Precio de Pan" })
    );
    await within(dialog).findByTestId("price-popover");
    fireEvent.mouseDown(
      within(dialog).getByText("Revisa los ingredientes y confirma.")
    );
    await waitFor(() =>
      expect(within(dialog).queryByTestId("price-popover")).toBeNull()
    );
    expect(
      calls.some((c) => c.url === "/api/restaurant/kitchen/ingredient-price")
    ).toBe(false);
  });

  it("an existing price is prefilled", async () => {
    render(
      <PricePopover
        ingredient={{
          id: "i-mozz",
          name: "Queso mozzarella",
          default_unit: "kg",
        }}
        initialPrice={8}
        initialUnit="kg"
        triggerLabel="Precio de Queso mozzarella"
        onSaved={() => {}}
      >
        $4.00
      </PricePopover>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Precio de Queso mozzarella" })
    );
    expect(
      (await screen.findByRole("spinbutton")) as HTMLInputElement
    ).toHaveProperty("value", "8");
    expect(
      (
        screen.getByLabelText(
          "Unidad del precio de Queso mozzarella"
        ) as HTMLSelectElement
      ).value
    ).toBe("kg");
  });
});

describe("the footer is one honest line", () => {
  const priced = new Map([
    ["a", { unit_cost: 4, unit: "kg" }],
    ["b", null],
  ]);
  const lines = [
    { key: "1", ingredient_id: "a", name: "A", total_quantity: 1, unit: "kg" },
    { key: "2", ingredient_id: "b", name: "B", total_quantity: 1, unit: "kg" },
    { key: "3", ingredient_id: null, name: "C", total_quantity: 1, unit: "kg" },
  ];
  const text = (el: HTMLElement) =>
    el.textContent?.replace(/\s+/g, " ").replace(/ i$/, "").trim();

  it("complete: «Costo por porción: $2.00 · Margen: 80%»", () => {
    const cost = computeDraftCost(lines.slice(0, 1), priced, 2, 10);
    const { getByTestId } = render(
      <CostFooter cost={cost} currency="USD" hasLines sellingPrice={10} />
    );
    expect(text(getByTestId("cost-footer"))).toBe(
      "Costo por porción: $2.00 · Margen: 80%"
    );
  });

  it("partial: only the COUNT, «Costo parcial · faltan 2 precios», no names, no total", () => {
    const cost = computeDraftCost(lines, priced, 2, 10);
    const { getByTestId } = render(
      <CostFooter cost={cost} currency="USD" hasLines sellingPrice={10} />
    );
    expect(text(getByTestId("cost-footer"))).toBe(
      "Costo parcial · faltan 2 precios"
    );
    expect(getByTestId("cost-footer").textContent).not.toMatch(/B|C,/);
    const one = computeDraftCost(lines.slice(0, 2), priced, 2, 10);
    cleanup();
    const again = render(
      <CostFooter cost={one} currency="USD" hasLines sellingPrice={10} />
    );
    expect(text(again.getByTestId("cost-footer"))).toBe(
      "Costo parcial · falta 1 precio"
    );
  });

  it("no selling price: «Agrega un precio de venta para ver el margen»", () => {
    const cost = computeDraftCost(lines.slice(0, 1), priced, 2, null);
    const { getByTestId } = render(
      <CostFooter cost={cost} currency="USD" hasLines sellingPrice={null} />
    );
    expect(text(getByTestId("cost-footer"))).toBe(
      "Costo por porción: $2.00 · Agrega un precio de venta para ver el margen"
    );
  });

  it("has the (i) estimate tooltip and no extra sentence", () => {
    const cost = computeDraftCost(lines.slice(0, 1), priced, 2, 10);
    const { getByTestId, getByLabelText } = render(
      <CostFooter cost={cost} currency="USD" hasLines sellingPrice={10} />
    );
    expect(
      getByLabelText(
        "Es un estimado; no cuenta en costos hasta que se apruebe."
      ).getAttribute("title")
    ).toBe("Es un estimado; no cuenta en costos hasta que se apruebe.");
    expect(getByTestId("cost-footer").textContent).not.toContain(
      "Es solo un estimado"
    );
  });

  it("inside the modal it is live: it follows the quantity", async () => {
    ingredients = [
      {
        id: "i-mozz",
        name: "Queso mozzarella",
        default_unit: "kg",
        price: { unit_cost: 8, unit: "kg" },
      },
    ];
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 0.5,
        unit: "kg",
      }),
    ];
    const dialog = await openModal();
    await waitFor(() =>
      expect(within(dialog).getByTestId("cost-footer").textContent).toContain(
        "Costo por porción: $2.00"
      )
    );
    fireEvent.change(within(dialog).getByLabelText("Cantidad de la línea 1"), {
      target: { value: "1" },
    });
    await waitFor(() =>
      expect(within(dialog).getByTestId("cost-footer").textContent).toContain(
        "Costo por porción: $4.00"
      )
    );
  });
});

describe("names are taught only after a successful Confirmar", () => {
  beforeEach(() => {
    drafts[0].lines = [
      line({ id: "l-2", raw_name: "queso fresco", total_quantity: 0.2 }),
      line({
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
      }),
    ];
  });

  it("confirming saves ONE alias, for the line the reviewer chose", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 1).value).toBe("Queso mozzarella")
    );
    expect(aliasCalls()).toHaveLength(0);
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(aliasCalls()).toHaveLength(1));
    expect(aliasCalls()[0].body).toEqual({
      raw_name: "queso fresco",
      ingredient_id: "i-mozz",
      draft_id: "d-1",
    });
    const order = calls.map((c) => `${c.method} ${c.url}`);
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
    expect(card.textContent).toContain("Bacon");
  });

  it("«Poner precios» opens the same one-field popover for ingredients without a price", async () => {
    drafts[0].lines = [
      line({
        id: "l-3",
        raw_name: "pan",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 2,
        unit: "pza",
      }),
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
      await screen.findByRole("button", { name: "Poner precio a Pan" })
    );
    expect(await screen.findByTestId("price-popover")).toBeTruthy();
  });
});

describe("an ingredient that is no longer active", () => {
  it("shows no selection and Confirmar stays disabled until a live one is chosen", async () => {
    drafts[0].lines = [
      line({
        id: "l-9",
        raw_name: "bacon",
        ingredient_id: "i-dead",
        ingredient_name: "Bacon",
        total_quantity: 0.4,
        unit: "kg",
      }),
    ];
    const dialog = await openModal();
    await waitFor(() => expect(combo(dialog, 1).value).toBe("bacon"));
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.focus(combo(dialog, 1));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Pan" }));
    await waitFor(() => expect(combo(dialog, 1).value).toBe("Pan"));
    expect(confirmButton(dialog).disabled).toBe(false);
  });
});

describe("rules of the screen", () => {
  it("no orange and no amber in the pieces", () => {
    for (const f of [
      "components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx",
      "components/restaurant/kitchen/IngredientCombobox.tsx",
      "components/restaurant/kitchen/PricePopover.tsx",
    ])
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /f28c28|e07b1|orange-|a35a00/i
      );
  });
});

describe("numbers that arrive as text, and missing pieces", () => {
  it("«240.000» with «gramos» shows 240 and g; Porciones «2» shows 2", async () => {
    drafts[0].portions = "2";
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: "240.000",
        unit: "gramos",
      }),
    ];
    const dialog = await openModal();
    expect(
      (
        within(dialog).getByLabelText(
          "Cantidad de la línea 1"
        ) as HTMLInputElement
      ).value
    ).toBe("240");
    expect(unitSelect(dialog, 1).value).toBe("g");
    expect(
      (within(dialog).getByLabelText("Porciones") as HTMLInputElement).value
    ).toBe("2");
    // 240 g of a $8/kg ingredient = $1.92
    expect(
      within(dialog).getByRole("button", { name: "Precio de Queso mozzarella" })
        .textContent
    ).toBe("$1.92");
  });

  it("a priced ingredient with no quantity says «Falta cantidad», not a dash; no unit says «Falta unidad»", async () => {
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: null,
        unit: "kg",
      }),
      line({
        id: "l-2",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 1,
        unit: null,
      }),
    ];
    const dialog = await openModal();
    const cells = within(dialog).getAllByRole("button", {
      name: "Precio de Queso mozzarella",
    });
    expect(cells.map((c) => c.textContent)).toEqual([
      "Falta cantidad",
      "Falta unidad",
    ]);
    expect(within(dialog).queryByText("—")).toBeNull();
  });

  it("no portions on a draft waiting for them: a gray hint, and Confirmar stays disabled until filled", async () => {
    drafts[0].portions = null;
    drafts[0].status = "awaiting_portions";
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 1,
        unit: "kg",
      }),
    ];
    const dialog = await openModal();
    expect(
      within(dialog).getByText(
        "El cocinero no dijo para cuántas porciones. Escríbelo aquí."
      )
    ).toBeTruthy();
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Porciones"), {
      target: { value: "4" },
    });
    await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));
  });
});

describe("Confirmar does not rewrite the draft first", () => {
  it("it sends only the confirm call (no PATCH); a refused confirm leaves the draft alone and says why", async () => {
    confirmFails = true;
    drafts[0].lines = [
      line({
        id: "l-1",
        raw_name: "queso",
        ingredient_id: "i-mozz",
        ingredient_name: "Queso",
        total_quantity: 300,
        unit: "gramos",
      }),
      line({
        id: "l-2",
        raw_name: "sal",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 1,
        unit: "pizca",
      }),
    ];
    const dialog = await openModal();
    fireEvent.change(unitSelect(dialog, 2), { target: { value: "unidad" } });
    fireEvent.click(confirmButton(dialog));
    expect(
      await within(dialog).findByText("No tienes permiso para cambiar esto.")
    ).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    const confirms = calls.filter((c) => c.url.endsWith("/confirm"));
    expect(confirms).toHaveLength(1);
    expect(confirms[0].body?.lines).toEqual([
      { id: "l-1", ingredient_id: "i-mozz", total_quantity: 300, unit: "g" },
      { id: "l-2", ingredient_id: "i-pan", total_quantity: 1, unit: "unidad" },
    ]);
    // the stored draft is exactly as it was
    expect((drafts[0].lines as Json[])[0].unit).toBe("gramos");
    expect((drafts[0].lines as Json[])[1].unit).toBe("pizca");
  });

  it("a unit the dropdown cannot map shows the cook's word as «pizca?» and still needs a choice", async () => {
    drafts[0].lines = [
      line({
        id: "l-2",
        raw_name: "sal",
        ingredient_id: "i-pan",
        ingredient_name: "Pan",
        total_quantity: 1,
        unit: "pizca",
      }),
    ];
    const dialog = await openModal();
    expect(
      within(unitSelect(dialog, 1)).getByRole("option", { name: "pizca?" })
    ).toBeTruthy();
    expect(unitSelect(dialog, 1).value).toBe("");
    expect(confirmButton(dialog).disabled).toBe(true);
  });
});

describe("Guardar borrador", () => {
  const rough = () => {
    drafts[0].portions = null;
    drafts[0].status = "awaiting_portions";
    drafts[0].lines = [
      line({ id: "l-1", raw_name: "bacon", total_quantity: null, unit: null }),
      line({
        id: "l-2",
        raw_name: "salsa rara",
        total_quantity: 3,
        unit: "pizca",
      }),
    ];
  };

  it("saves a draft with an unmatched line, no quantity, no unit and no portions (types only), keeps the cook's unit word, and reopening shows the same", async () => {
    rough();
    const dialog = await openModal();
    const save = within(dialog).getByRole("button", {
      name: "Guardar borrador",
    });
    expect(save.className).toContain("border-[#1B40C8]");
    fireEvent.click(save);
    expect(await within(dialog).findByText("Borrador guardado.")).toBeTruthy();
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body?.portions).toBeNull();
    expect(patches[0].body?.lines).toEqual([
      {
        id: "l-1",
        raw_name: "bacon",
        ingredient_id: null,
        total_quantity: null,
        unit: null,
      },
      {
        id: "l-2",
        raw_name: "salsa rara",
        ingredient_id: null,
        total_quantity: 3,
        unit: "pizca",
      },
    ]);
    // reopen: same values
    cleanup();
    const again = await openModal();
    expect(combo(again, 1).value).toBe("bacon");
    expect(
      (
        within(again).getByLabelText(
          "Cantidad de la línea 1"
        ) as HTMLInputElement
      ).value
    ).toBe("");
    expect(unitSelect(again, 1).value).toBe("");
    expect(combo(again, 2).value).toBe("salsa rara");
    expect(
      (
        within(again).getByLabelText(
          "Cantidad de la línea 2"
        ) as HTMLInputElement
      ).value
    ).toBe("3");
    expect(
      within(unitSelect(again, 2)).getByRole("option", { name: "pizca?" })
    ).toBeTruthy();
    expect(
      (within(again).getByLabelText("Porciones") as HTMLInputElement).value
    ).toBe("");
  });

  it("saves the chosen menu dish and the picked ingredients", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, usarlo" }));
    await waitFor(() =>
      expect(combo(dialog, 2).value).toBe("Queso mozzarella")
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Guardar borrador" })
    );
    await within(dialog).findByText("Borrador guardado.");
    const body = calls.find((c) => c.method === "PATCH")!.body!;
    expect((body.lines as Json[])[1].ingredient_id).toBe("i-mozz");
    expect(body.portions).toBe(2);
  });

  it("closing with unsaved changes asks «¿Guardar cambios?»; «Salir sin guardar» leaves without saving", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Cantidad de la línea 1"), {
      target: { value: "9" },
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    const ask = await screen.findByRole("alertdialog", {
      name: "¿Guardar cambios?",
    });
    expect(
      within(ask).getByRole("button", { name: "Salir sin guardar" })
    ).toBeTruthy();
    fireEvent.click(
      within(ask).getByRole("button", { name: "Salir sin guardar" })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Revisar receta/ })
      ).toBeNull()
    );
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("«Guardar» in that question saves and then closes", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Cantidad de la línea 1"), {
      target: { value: "9" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    const ask = await screen.findByRole("alertdialog", {
      name: "¿Guardar cambios?",
    });
    fireEvent.click(within(ask).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Revisar receta/ })
      ).toBeNull()
    );
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("closing with nothing changed does not ask", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Revisar receta/ })
      ).toBeNull()
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
