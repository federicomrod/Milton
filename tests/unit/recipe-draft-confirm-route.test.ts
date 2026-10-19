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
let failRule:
  | ((table: string, mode: string, payload: unknown) => boolean)
  | null = null;

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
    ...makeFakeDb(store, {
      fail: (table, mode, payload) => failRule?.(table, mode, payload) ?? false,
    }),
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
  failRule = null;
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
  it("a line WITHOUT a price is saved normally (it stays «Sin precio»), in any recognized unit", async () => {
    store.ingredient_cost_entries = store.ingredient_cost_entries.filter(
      (c) => c.ingredient_id !== BACON
    );
    const res = await confirm(
      body({
        lines: [
          {
            id: "line-1",
            ingredient_id: BACON,
            total_quantity: 3,
            unit: "pza",
          },
          { id: "line-2", ingredient_id: PAN, total_quantity: 2, unit: "pza" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const version = store.recipe_versions.find(
      (v) => v.status === "in_review"
    )!;
    const lines = store.recipe_version_inputs.filter(
      (r) => r.recipe_version_id === version.id
    );
    expect(lines.map((r) => r.ingredient_id)).toEqual([BACON, PAN]);
    // no price entry was invented for it
    expect(
      store.ingredient_cost_entries.some((c) => c.ingredient_id === BACON)
    ).toBe(false);
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

describe("a dish whose recipe is only in the old lines (no versions)", () => {
  beforeEach(() => {
    // confirmed by the old SQL function: legacy lines, no recipe_versions
    store.recipe_versions = [];
    store.recipe_version_inputs = [];
  });

  it("is refused with 409 and nothing is created, claimed or changed", async () => {
    const before = JSON.stringify(store.menu_recipe_inputs);
    const res = await confirm(body());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Este platillo ya tiene una receta guardada. Para no cambiar sus costos, confirma esta receta como platillo nuevo o edita la receta desde Menú."
    );
    expect(store.recipe_versions).toHaveLength(0);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
    expect(JSON.stringify(store.menu_recipe_inputs)).toBe(before);
    expect(store.recipes[0]).toMatchObject({
      status: "active",
      source_type: "manual",
    });
  });

  it("an existing dish with a recipe header but NO legacy lines still gets a version", async () => {
    store.menu_recipe_inputs = [];
    expect((await confirm(body())).status).toBe(200);
    expect(store.recipe_versions).toHaveLength(1);
  });

  it("the same recipe as a NEW dish works", async () => {
    const res = await confirm(body({ menu_item_id: undefined }));
    expect(res.status).toBe(200);
    expect(store.menu_recipe_inputs).toHaveLength(1);
  });

  it("another company's legacy lines do not block this company", async () => {
    store.menu_recipe_inputs = [
      {
        id: "legacy-x",
        recipe_id: RECIPE,
        company_id: OTHER,
        ingredient_id: PAN,
      },
    ];
    expect((await confirm(body())).status).toBe(200);
  });
});

describe("a failed write leaves nothing behind", () => {
  it("an awaiting_portions draft (portions null), confirmed with 4, whose version insert throws, comes back awaiting_portions with portions null", async () => {
    store.kitchen_recipe_drafts[0].status = "awaiting_portions";
    store.kitchen_recipe_drafts[0].portions = null;
    failRule = (table, mode) =>
      table === "recipe_versions" && mode === "insert";
    const res = await confirm(body({ portions: 4 }));
    expect(res.status).toBe(500);
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
    expect(store.kitchen_recipe_drafts[0].portions).toBeNull();
    expect(store.kitchen_recipe_drafts[0].confirmed_by ?? null).toBeNull();
    expect(store.kitchen_recipe_drafts[0].confirmed_at ?? null).toBeNull();
  });

  it("a draft with portions 2 confirmed with 6, whose version insert throws, keeps portions 2 and status draft", async () => {
    failRule = (table, mode) =>
      table === "recipe_versions" && mode === "insert";
    const res = await confirm(body({ portions: 6 }));
    expect(res.status).toBe(500);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
    expect(store.kitchen_recipe_drafts[0].portions).toBe(2);
  });

  it("inputs insert fails → the new version is removed, the draft goes back to draft, the approved version is untouched", async () => {
    failRule = (table, mode) =>
      table === "recipe_version_inputs" && mode === "insert";
    const res = await confirm(body());
    expect(res.status).toBe(500);
    expect(store.recipe_versions.map((v) => [v.id, v.status])).toEqual([
      ["ver-1", "approved"],
    ]);
    expect(store.recipe_version_inputs).toEqual(approvedLines);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
    expect(store.kitchen_recipe_drafts[0].confirmed_by ?? null).toBeNull();
  });

  it("the final draft update fails → the created version (and its lines) are removed", async () => {
    failRule = (table, mode, payload) =>
      table === "kitchen_recipe_drafts" &&
      mode === "update" &&
      Boolean((payload as Record<string, unknown>)?.confirmed_recipe_id);
    const res = await confirm(body());
    expect(res.status).toBe(500);
    expect(store.recipe_versions.map((v) => v.id)).toEqual(["ver-1"]);
    expect(store.recipe_version_inputs).toEqual(approvedLines);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
    // and it can be confirmed again afterwards
    failRule = null;
    expect((await confirm(body())).status).toBe(200);
    expect(store.recipe_versions).toHaveLength(2);
  });

  it("a new dish created by a failed call is removed too", async () => {
    failRule = (table, mode) =>
      table === "recipe_version_inputs" && mode === "insert";
    const res = await confirm(body({ menu_item_id: undefined }));
    expect(res.status).toBe(500);
    expect(store.menu_items.map((m) => m.id)).toEqual([MENU]);
    expect(store.recipes.map((r) => r.id)).toEqual([RECIPE]);
  });
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("a double click while the first request is still writing", () => {
  it("status confirmed but no recipe yet → 409 «se está confirmando», not ok with empty ids", async () => {
    store.kitchen_recipe_drafts[0] = {
      id: DRAFT,
      company_id: COMPANY,
      status: "confirmed",
      portions: 2,
      confirmed_recipe_id: null,
      confirmed_at: ago(30_000),
      menu_item_id: null,
    };
    const res = await confirm(body());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Esta receta se está confirmando. Espera un momento."
    );
    expect(store.recipe_versions).toHaveLength(1);
  });
});

describe("two drafts of the same dish confirmed at the same time", () => {
  it("our insert loses on the unique key: the OTHER call's version and lines stay, our draft goes back to draft, 500", async () => {
    let raced = false;
    failRule = (table, mode, payload) => {
      if (table !== "recipe_versions" || mode !== "insert") return false;
      // the other call got this version number first and already wrote its lines
      const number = (payload as Record<string, unknown>).version_number;
      store.recipe_versions.push({
        id: "ver-other",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: number,
        status: "in_review",
        source_type: "kitchen_draft",
        created_at: ago(1_000),
      });
      store.recipe_version_inputs.push({
        id: "vi-other",
        recipe_version_id: "ver-other",
        company_id: COMPANY,
        ingredient_id: BACON,
        quantity: 0.3,
        unit: "kg",
      });
      raced = true;
      return true; // unique-key error for us
    };
    const res = await confirm(body());
    expect(raced).toBe(true);
    expect(res.status).toBe(500);
    expect(store.recipe_versions.map((v) => v.id)).toEqual([
      "ver-1",
      "ver-other",
    ]);
    expect(
      store.recipe_version_inputs.filter(
        (r) => r.recipe_version_id === "ver-other"
      )
    ).toHaveLength(1);
    expect(
      store.recipe_version_inputs.filter((r) => r.recipe_version_id === "ver-1")
    ).toEqual(approvedLines);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
  });

  it("a version of ours found by lookup with NO lines (insert died after the row) is still removed", async () => {
    failRule = (table, mode) => {
      if (table === "recipe_version_inputs" && mode === "insert") return true;
      return false;
    };
    const res = await confirm(body());
    expect(res.status).toBe(500);
    expect(store.recipe_versions.map((v) => v.id)).toEqual(["ver-1"]);
  });
});

describe("a claim left by a call that died", () => {
  const stale = (ms: number) => {
    store.kitchen_recipe_drafts[0] = {
      id: DRAFT,
      company_id: COMPANY,
      status: "confirmed",
      portions: 2,
      currency: "USD",
      confirmed_recipe_id: null,
      confirmed_at: ago(ms),
      menu_item_id: null,
    };
  };

  it("older than 2 minutes: it is taken over and creates exactly one version", async () => {
    stale(3 * 60_000);
    const res = await confirm(body());
    expect(res.status).toBe(200);
    const mine = store.recipe_versions.filter((v) => v.status === "in_review");
    expect(mine).toHaveLength(1);
    expect(store.recipe_versions.map((v) => v.version_number)).toEqual([1, 2]);
    expect(store.kitchen_recipe_drafts[0]).toMatchObject({
      status: "confirmed",
      confirmed_recipe_id: RECIPE,
    });
    // confirming again does not add a second version
    expect((await confirm(body())).status).toBe(200);
    expect(store.recipe_versions).toHaveLength(2);
  });

  it("younger than 2 minutes (30 s): still «se está confirmando», nothing written", async () => {
    stale(30_000);
    const res = await confirm(body());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Esta receta se está confirmando. Espera un momento."
    );
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.kitchen_recipe_drafts[0].confirmed_at).toBeTruthy();
  });

  it("taking over removes the dead call's EMPTY kitchen_draft version, and only that", async () => {
    stale(3 * 60_000);
    store.recipe_versions.push(
      // the dead call: version row written, no lines, old
      {
        id: "ver-dead",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: 2,
        status: "in_review",
        source_type: "kitchen_draft",
        created_at: ago(10 * 60_000),
      },
      // another draft's version WITH lines
      {
        id: "ver-live",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: 3,
        status: "in_review",
        source_type: "kitchen_draft",
        created_at: ago(10 * 60_000),
      },
      // a recent empty one (a live call may still be writing its lines)
      {
        id: "ver-new",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: 4,
        status: "in_review",
        source_type: "kitchen_draft",
        created_at: ago(5_000),
      },
      // an empty version that is not ours (imported draft)
      {
        id: "ver-imp",
        company_id: COMPANY,
        recipe_id: RECIPE,
        menu_item_id: MENU,
        version_number: 5,
        status: "in_review",
        source_type: "import",
        created_at: ago(10 * 60_000),
      }
    );
    store.recipe_version_inputs.push({
      id: "vi-live",
      recipe_version_id: "ver-live",
      company_id: COMPANY,
      ingredient_id: PAN,
      quantity: 1,
      unit: "pza",
    });
    const res = await confirm(body());
    expect(res.status).toBe(200);
    const ids = store.recipe_versions.map((v) => v.id);
    expect(ids).not.toContain("ver-dead");
    expect(ids).toEqual(
      expect.arrayContaining(["ver-1", "ver-live", "ver-new", "ver-imp"])
    );
    expect(
      store.recipe_version_inputs.filter(
        (r) => r.recipe_version_id === "ver-live"
      )
    ).toHaveLength(1);
    expect(
      store.recipe_version_inputs.filter((r) => r.recipe_version_id === "ver-1")
    ).toEqual(approvedLines);
  });

  it("another company's draft with a stale claim is still a 404", async () => {
    stale(3 * 60_000);
    store.kitchen_recipe_drafts[0].company_id = OTHER;
    expect((await confirm(body())).status).toBe(404);
  });
});

describe("an archived (merged-away) ingredient is never saved on a recipe", () => {
  beforeEach(() => {
    store.ingredients.find((i) => i.id === BACON)!.archived_at =
      "2026-09-01T00:00:00Z";
  });

  it("merged into another one → 400 «Bacon se unió con Tocino. Elige Tocino en esa línea.», nothing written, draft stays draft", async () => {
    store.ingredient_merges = [
      {
        company_id: COMPANY,
        loser_ids: [BACON],
        survivor_name: "Tocino",
        undone_at: null,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    const res = await confirm(body());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Bacon se unió con Tocino. Elige Tocino en esa línea."
    );
    expect(store.recipe_versions.map((v) => v.id)).toEqual(["ver-1"]);
    expect(store.recipe_version_inputs).toEqual(approvedLines);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
  });

  it("archived but not merged → «Bacon está archivado. Elige otro ingrediente.»", async () => {
    store.ingredient_merges = [];
    const res = await confirm(body());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Bacon está archivado. Elige otro ingrediente."
    );
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
  });

  it("a merge that was undone does not count as a merge", async () => {
    store.ingredient_merges = [
      {
        company_id: COMPANY,
        loser_ids: [BACON],
        survivor_name: "Tocino",
        undone_at: "2026-09-02",
        created_at: "2026-09-01",
      },
    ];
    expect((await (await confirm(body())).json()).error).toBe(
      "Bacon está archivado. Elige otro ingrediente."
    );
  });
});

describe("confirm fails closed when the prices cannot be read", () => {
  it("a failed read of the cost entries → 500, nothing written, the draft stays draft", async () => {
    failRule = (table, mode) =>
      table === "ingredient_cost_entries" && mode === "select";
    const res = await confirm(body());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      "No pude leer los precios. Inténtalo de nuevo."
    );
    expect(store.recipe_versions.map((v) => v.id)).toEqual(["ver-1"]);
    expect(store.recipe_version_inputs).toEqual(approvedLines);
    expect(store.menu_items).toHaveLength(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("draft");
    // and it works once the prices can be read again
    failRule = null;
    expect((await confirm(body())).status).toBe(200);
  });
});
