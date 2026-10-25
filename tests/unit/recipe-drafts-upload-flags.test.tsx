// @vitest-environment jsdom
// Drafts from files: the list API's approved_exists / is_preparation, and the
// review modal's badges, banners and wording. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextRequest } from "next/server";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const store: FakeStore = {};
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: {},
    companyId: "co-1",
    userId: "u-1",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeFakeDb(store),
}));
let approved: { menu_item_id: string | null; name: string }[] = [];
let approvedFails = false;
vi.mock("@/lib/restaurant/recipe-upload/duplicates", () => ({
  loadApprovedDishes: async () => {
    if (approvedFails) throw new Error("boom");
    return approved;
  },
  // same idea as the real one: folded name equality
  findApprovedDuplicate: (
    name: string,
    dishes: { menu_item_id: string | null; name: string }[]
  ) => {
    const fold = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return dishes.find((d) => fold(d.name) === fold(name)) ?? null;
  },
}));

import { GET } from "@/app/api/restaurant/kitchen/recipe-drafts/route";
import { KitchenRecipeDraftsCard } from "@/components/restaurant/kitchen/KitchenRecipeDraftsCard";

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  const base = {
    company_id: "co-1",
    location_id: "loc-1",
    status: "draft",
    portions: 4,
    confidence: "medium",
    currency: "USD",
    per_portion_cost: null,
    menu_item_id: null,
    kitchen_staff: { display_name: "Archivo subido" },
    restaurant_locations: { name: "Centro" },
  };
  store.kitchen_recipe_drafts = [
    {
      ...base,
      id: "d-1",
      dish_name: "arroz con pollo",
      created_at: "2026-10-02",
    },
    {
      ...base,
      id: "d-2",
      dish_name: "Salsa roja · preparación",
      created_at: "2026-10-01",
    },
    { ...base, id: "d-3", dish_name: "Ceviche", created_at: "2026-10-03" },
  ];
  store.kitchen_recipe_draft_lines = [];
}

beforeEach(() => {
  seed();
  approved = [{ menu_item_id: "m-1", name: "Arroz con Pollo" }];
  approvedFails = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GET recipe-drafts", () => {
  const list = async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/restaurant/kitchen/recipe-drafts")
    );
    return (await res.json()).drafts as Record<string, unknown>[];
  };

  it("flags an approved dish with the same folded name, and preparations", async () => {
    const drafts = await list();
    const by = Object.fromEntries(drafts.map((d) => [d.id as string, d]));
    expect(by["d-1"].approved_exists).toBe(true);
    expect(by["d-1"].is_preparation).toBe(false);
    expect(by["d-2"].is_preparation).toBe(true);
    expect(by["d-2"].approved_exists).toBe(false);
    expect(by["d-3"].approved_exists).toBe(false);
    expect(by["d-1"].staff_name).toBe("Archivo subido");
  });

  it("still lists when the approved lookup fails", async () => {
    approvedFails = true;
    const drafts = await list();
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.approved_exists === false)).toBe(true);
  });
});

describe("the review modal", () => {
  const draft = (over: Record<string, unknown>) => ({
    id: "d-1",
    dish_name: "Ceviche",
    portions: 4,
    status: "draft",
    confidence: "medium",
    per_portion_cost: null,
    currency: "USD",
    created_at: "2026-10-18T10:00:00Z",
    staff_name: "Archivo subido",
    location_name: "Centro",
    lines: [
      {
        id: "l-1",
        raw_name: "pescado",
        ingredient_id: "i-1",
        ingredient_name: "Pescado",
        total_quantity: null,
        unit: "kg",
        per_portion_quantity: null,
        confidence: "low",
        line_cost: null,
      },
    ],
    ...over,
  });
  let drafts: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];
  const confirmed: Record<string, unknown>[] = [];

  beforeEach(() => {
    saved.length = 0;
    confirmed.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = (b: unknown) => ({
          ok: true,
          status: 200,
          json: async () => b,
        });
        if (method === "POST" && url.endsWith("/confirm")) {
          confirmed.push(JSON.parse(String(init?.body)));
          // like the server: a confirmed draft is no longer listed
          drafts = [];
          return body({ ok: true, kind: "preparacion" });
        }
        if (method === "PATCH") {
          saved.push(JSON.parse(String(init?.body)));
          return body({ ok: true, lines: [] });
        }
        if (url.startsWith("/api/restaurant/kitchen/recipe-drafts"))
          return body({ drafts });
        if (url === "/api/restaurant/kitchen/ingredients")
          return body({
            ingredients: [
              { id: "i-1", name: "Pescado", default_unit: "kg", price: null },
            ],
          });
        if (url === "/api/restaurant/menu-items")
          return body({ menu_items: [] });
        return body({});
      })
    );
  });

  const open = async (d: Record<string, unknown>) => {
    drafts = [d];
    render(
      <KitchenRecipeDraftsCard
        canManage
        locations={[{ id: "loc", name: "Centro" }]}
        focusDraftId={String(d.id)}
      />
    );
    return await screen.findByRole("dialog", { name: /Revisar receta/ });
  };

  it("approved dish: badge in the list, banner in the modal, Confirmar not blocked by it", async () => {
    const dialog = await open(
      draft({
        approved_exists: true,
        lines: [
          {
            id: "l-1",
            raw_name: "pescado",
            ingredient_id: "i-1",
            ingredient_name: "Pescado",
            total_quantity: 2,
            unit: "kg",
            per_portion_quantity: null,
            confidence: "low",
            line_cost: null,
          },
        ],
      })
    );
    expect(
      screen.getAllByText("Ya existe una receta aprobada").length
    ).toBeGreaterThan(0);
    expect(
      within(dialog).getByText(
        "Ya hay una receta aprobada con este nombre. Confirmar NO la cambia: crea una versión nueva para revisar."
      )
    ).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Confirmar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  const prepDraft = () =>
    draft({
      dish_name: "Salsa roja · preparación",
      is_preparation: true,
      portions: null,
      lines: [
        {
          id: "l-1",
          raw_name: "tomate",
          ingredient_id: "i-1",
          ingredient_name: "Pescado",
          total_quantity: 2,
          unit: "kg",
          per_portion_quantity: null,
          confidence: "low",
          line_cost: null,
        },
      ],
    });
  const confirmButton = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", {
      name: "Confirmar",
    }) as HTMLButtonElement;

  it("preparation: badge, new banner, Rinde/Unidad, no marker, Confirmar waits for the yield, Guardar borrador keeps the marker", async () => {
    const dialog = await open(prepDraft());
    expect(screen.getAllByText("Preparación").length).toBeGreaterThan(0);
    expect(
      within(dialog).getByText(
        "Esta es una preparación (sub-receta). Se creará en Menú › Preparaciones como borrador para revisar."
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("· preparación");
    expect(
      (within(dialog).getByLabelText("Nombre del plato") as HTMLInputElement)
        .value
    ).toBe("Salsa roja");
    expect(within(dialog).getByLabelText("Rinde")).toBeTruthy();
    expect(within(dialog).getByLabelText("Unidad de rendimiento")).toBeTruthy();
    // portions / menu dish / price do not apply to a preparation
    expect(within(dialog).queryByLabelText("Porciones")).toBeNull();
    expect(within(dialog).queryByText("Plato del menú")).toBeNull();
    expect(confirmButton(dialog).disabled).toBe(true);
    const save = within(dialog).getByRole("button", {
      name: "Guardar borrador",
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    save.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].dish_name).toBe("Salsa roja · preparación");
  });

  it("preparation: Confirmar needs a yield > 0 and a unit, posts kind:'preparacion', then closes with a gray note", async () => {
    const dialog = await open(prepDraft());
    const qty = within(dialog).getByLabelText("Rinde") as HTMLInputElement;
    const unit = within(dialog).getByLabelText(
      "Unidad de rendimiento"
    ) as HTMLSelectElement;
    fireEvent.change(qty, { target: { value: "0" } });
    fireEvent.change(unit, { target: { value: "l" } });
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.change(qty, { target: { value: "1.5" } });
    fireEvent.change(unit, { target: { value: "" } });
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.change(unit, { target: { value: "l" } });
    expect(confirmButton(dialog).disabled).toBe(false);
    fireEvent.click(confirmButton(dialog));
    await vi.waitFor(() => expect(confirmed).toHaveLength(1));
    expect(confirmed[0]).toMatchObject({
      kind: "preparacion",
      dish_name: "Salsa roja · preparación",
      yield_quantity: 1.5,
      yield_unit: "l",
    });
    expect(confirmed[0]).not.toHaveProperty("portions");
    const note = await screen.findByText(
      "Preparación creada en Menú › Preparaciones para revisar."
    );
    expect(note.className).toContain("text-[#6b7280]");
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Revisar receta/ })
      ).toBeNull()
    );
  });

  it("a line without quantity says «falta cantidad» and Confirmar stays disabled", async () => {
    const dialog = await open(draft({}));
    expect(within(dialog).getByText("falta cantidad")).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Confirmar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("says plato, never platillo", async () => {
    const dialog = await open(draft({}));
    expect(within(dialog).getByLabelText("Nombre del plato")).toBeTruthy();
    expect(within(dialog).getByText("Plato del menú")).toBeTruthy();
    expect(dialog.textContent!.toLowerCase()).not.toContain("platillo");
    expect(document.body.textContent!.toLowerCase()).not.toContain("platillo");
  });
});
