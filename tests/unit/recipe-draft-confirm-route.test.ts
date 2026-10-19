// Confirming a Telegram recipe draft: a NEW in_review version, never an
// overwrite, never approval; a new dish gets no price; company-scoped.
// Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeDb, type FakeStore, type Row } from "./helpers/fake-db";

const store: FakeStore = {};
const authAndCompany = vi.fn();
const isUserAdminServer = vi.fn();
const loadMembershipRole = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...a: unknown[]) => authAndCompany(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...makeFakeDb(store),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: (...a: unknown[]) => isUserAdminServer(...a),
}));
vi.mock("@/lib/restaurant/telegram/kitchen-join", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-join")
    >();
  return {
    ...actual,
    loadMembershipRole: (...a: unknown[]) => loadMembershipRole(...a),
  };
});

import { POST } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route";
import { menuItemPriceToStore } from "@/lib/restaurant/telegram/kitchen-draft-confirm";

const COMPANY = "company-1";
const OTHER = "company-2";
const DRAFT = "draft-1";
const MENU = "menu-1";
const RECIPE = "recipe-1";
const BACON = "ing-bacon";
const PAN = "ing-pan";

function body(over: Record<string, unknown> = {}) {
  return {
    dish_name: "Hamburguesa Diablo",
    portions: 2,
    menu_item_id: MENU,
    lines: [
      { id: "line-1", ingredient_id: BACON, total_quantity: 0.4, unit: "kg" },
      { id: "line-2", ingredient_id: PAN, total_quantity: 2, unit: "pza" },
    ],
    ...over,
  };
}

async function confirm(b: unknown, id = DRAFT) {
  const req = new NextRequest(
    `http://localhost/api/restaurant/kitchen/recipe-drafts/${id}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    }
  );
  return POST(req, { params: Promise.resolve({ id }) });
}

const approvedLines: Row[] = [
  {
    id: "vi-1",
    recipe_version_id: "ver-1",
    ingredient_id: PAN,
    quantity: 1,
    unit: "pza",
  },
];

beforeEach(() => {
  rpc.mockReset();
  authAndCompany.mockResolvedValue({
    ok: true,
    companyId: COMPANY,
    userId: "user-1",
    supabase: {},
  });
  isUserAdminServer.mockResolvedValue(false);
  loadMembershipRole.mockResolvedValue("owner");
  Object.assign(store, {
    kitchen_recipe_drafts: [
      {
        id: DRAFT,
        company_id: COMPANY,
        status: "draft",
        portions: 2,
        currency: "USD",
      },
    ],
    kitchen_recipe_draft_lines: [
      {
        id: "line-1",
        draft_id: DRAFT,
        company_id: COMPANY,
        ingredient_id: BACON,
      },
      {
        id: "line-2",
        draft_id: DRAFT,
        company_id: COMPANY,
        ingredient_id: PAN,
      },
    ],
    menu_items: [
      {
        id: MENU,
        company_id: COMPANY,
        name: "Hamburguesa",
        selling_price: 9.5,
      },
    ],
    // the dish already has a MANUAL recipe with an APPROVED version
    recipes: [
      {
        id: RECIPE,
        company_id: COMPANY,
        menu_item_id: MENU,
        name: "Hamburguesa",
        status: "active",
        source_type: "manual",
      },
    ],
    recipe_versions: [
      {
        id: "ver-1",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: 1,
        status: "approved",
        effective_date: null,
        source_type: "manual",
      },
    ],
    recipe_version_inputs: approvedLines.map((r) => ({ ...r })),
    menu_recipe_inputs: [
      {
        id: "legacy-1",
        recipe_id: RECIPE,
        company_id: COMPANY,
        ingredient_id: PAN,
        quantity: 1,
        unit: "pza",
      },
    ],
    ingredients: [
      { id: BACON, company_id: COMPANY, name: "Bacon", default_unit: "kg" },
      { id: PAN, company_id: COMPANY, name: "Pan", default_unit: "pza" },
    ],
    ingredient_cost_entries: [
      {
        company_id: COMPANY,
        ingredient_id: BACON,
        normalized_unit_cost: 12,
        normalized_unit: "kg",
        cost_date: "2026-10-01",
      },
      {
        company_id: COMPANY,
        ingredient_id: PAN,
        normalized_unit_cost: 0.5,
        normalized_unit: "pza",
        cost_date: "2026-10-01",
      },
    ],
  });
});

describe("confirm on an existing dish with an approved recipe", () => {
  it("adds a NEW in_review version and changes nothing that exists", async () => {
    const res = await confirm(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("in_review");

    const versions = store.recipe_versions.filter(
      (v) => v.recipe_id === RECIPE
    );
    expect(versions.map((v) => [v.version_number, v.status])).toEqual([
      [1, "approved"],
      [2, "in_review"],
    ]);
    expect(versions[0]).toMatchObject({
      id: "ver-1",
      status: "approved",
      source_type: "manual",
    });
    // the approved version's lines are exactly as they were
    expect(
      store.recipe_version_inputs.filter((r) => r.recipe_version_id === "ver-1")
    ).toEqual(approvedLines);
    // the new version carries the draft lines, per portion
    const mine = store.recipe_version_inputs.filter(
      (r) => r.recipe_version_id === versions[1].id
    );
    expect(mine.map((r) => [r.ingredient_id, r.quantity, r.unit])).toEqual([
      [BACON, 0.2, "kg"],
      [PAN, 1, "pza"],
    ]);
    // legacy lines, recipe header and menu item are untouched
    expect(store.menu_recipe_inputs).toHaveLength(1);
    expect(store.recipes[0]).toMatchObject({
      name: "Hamburguesa",
      status: "active",
      source_type: "manual",
    });
    expect(store.menu_items).toHaveLength(1);
    expect(store.menu_items[0].selling_price).toBe(9.5);
    // the removed SQL function is no longer used
    expect(rpc).not.toHaveBeenCalled();
    expect(store.kitchen_recipe_drafts[0]).toMatchObject({
      status: "confirmed",
      confirmed_recipe_id: RECIPE,
      menu_item_id: MENU,
    });
  });

  it("a second Telegram draft for the same dish gets yet another in_review version", async () => {
    await confirm(body());
    store.kitchen_recipe_drafts.push({
      id: "draft-2",
      company_id: COMPANY,
      status: "draft",
      portions: 2,
      currency: "USD",
    });
    const res = await confirm(
      body({
        lines: [
          { ingredient_id: BACON, total_quantity: 0.4, unit: "kg" },
          { ingredient_id: PAN, total_quantity: 2, unit: "pza" },
        ],
      }),
      "draft-2"
    );
    expect(res.status).toBe(200);
    expect(
      store.recipe_versions.map((v) => [v.version_number, v.status])
    ).toEqual([
      [1, "approved"],
      [2, "in_review"],
      [3, "in_review"],
    ]);
  });

  it("is idempotent: confirming twice does not add a second version", async () => {
    await confirm(body());
    const again = await confirm(body());
    expect(again.status).toBe(200);
    expect(store.recipe_versions).toHaveLength(2);
  });
});

describe("confirm a NEW dish", () => {
  it("creates the dish with no price (never a real $0), no POS link, and an in_review recipe", async () => {
    const res = await confirm(body({ menu_item_id: undefined }));
    expect(res.status).toBe(200);
    const created = store.menu_items.find(
      (m) => m.name === "Hamburguesa Diablo"
    )!;
    expect(created).toBeTruthy();
    // menu_items.selling_price is NOT NULL: «no price» is stored as the
    // column's own «not set» (0) and every screen shows «Sin precio».
    expect(Number(created.selling_price)).toBe(0);
    expect(menuItemPriceToStore(null)).toBe(0);
    expect(menuItemPriceToStore(0)).toBe(0);
    expect(menuItemPriceToStore(-3)).toBe(0);
    expect(store.pos_product_links ?? []).toHaveLength(0);
    const recipe = store.recipes.find((r) => r.menu_item_id === created.id)!;
    expect(recipe.status).toBe("draft");
    const versions = store.recipe_versions.filter(
      (v) => v.recipe_id === recipe.id
    );
    expect(versions.map((v) => v.status)).toEqual(["in_review"]);
  });

  it("stores a price only when the manager typed one", async () => {
    await confirm(body({ menu_item_id: undefined, selling_price: 12.345 }));
    const created = store.menu_items.find(
      (m) => m.name === "Hamburguesa Diablo"
    )!;
    expect(Number(created.selling_price)).toBeCloseTo(12.35, 2);
  });
});

describe("safety and company scope", () => {
  it("another company's draft answers 404 and writes nothing", async () => {
    store.kitchen_recipe_drafts[0].company_id = OTHER;
    const res = await confirm(body());
    expect(res.status).toBe(404);
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
  });
  it("another company's menu item is refused", async () => {
    store.menu_items = [{ id: MENU, company_id: OTHER }];
    const res = await confirm(body());
    expect(res.status).toBe(400);
    expect(store.recipe_versions).toHaveLength(1);
  });
  it("a member (not a manager) gets 403", async () => {
    loadMembershipRole.mockResolvedValue("member");
    expect((await confirm(body())).status).toBe(403);
    expect(store.recipe_versions).toHaveLength(1);
  });
  it("an ingredient of another company is refused", async () => {
    store.ingredients = [
      { id: BACON, company_id: OTHER, name: "Bacon" },
      store.ingredients[1],
    ];
    expect((await confirm(body())).status).toBe(400);
  });
});

describe("errors are Spanish, with tú, and name the ingredient", () => {
  it("missing price → «Falta el precio de Bacon.»", async () => {
    store.ingredient_cost_entries = store.ingredient_cost_entries.filter(
      (c) => c.ingredient_id !== BACON
    );
    const res = await confirm(body());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Falta el precio de Bacon.");
  });
  it("a unit that cannot be converted names the ingredient and its price unit", async () => {
    const res = await confirm(
      body({
        lines: [
          {
            id: "line-1",
            ingredient_id: BACON,
            total_quantity: 2,
            unit: "pza",
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'No puedo convertir "pza" a la unidad del precio de Bacon (kg).'
    );
  });
  it("a missing quantity names the ingredient, never an id", async () => {
    const res = await confirm(
      body({
        lines: [
          { id: "line-1", ingredient_id: BACON, total_quantity: 0, unit: "kg" },
        ],
      })
    );
    const { error } = await res.json();
    expect(error).toBe("Falta la cantidad de Bacon.");
    expect(error).not.toContain(BACON);
  });
  it("no lines / no portions / no name", async () => {
    expect((await (await confirm(body({ lines: [] }))).json()).error).toBe(
      "Agrega al menos un ingrediente."
    );
    expect((await (await confirm(body({ portions: 0 }))).json()).error).toMatch(
      /porciones/
    );
    expect((await (await confirm(body({ dish_name: " " }))).json()).error).toBe(
      "Escribe el nombre del platillo."
    );
  });
  it("accepts newly added lines (new- id or no id)", async () => {
    const res = await confirm(
      body({
        lines: [
          {
            id: "new-1",
            ingredient_id: BACON,
            total_quantity: 0.4,
            unit: "kg",
          },
          { ingredient_id: PAN, total_quantity: 2, unit: "pza" },
        ],
      })
    );
    expect(res.status).toBe(200);
  });
});
