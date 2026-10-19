// Who may act on a kitchen draft, and in which company. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";

type Row = Record<string, unknown>;
const {
  store,
  authAndCompany,
  isUserAdminServer,
  loadMembershipRole,
  addCostEntry,
} = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  authAndCompany: vi.fn(),
  isUserAdminServer: vi.fn(),
  loadMembershipRole: vi.fn(),
  addCostEntry: vi.fn(),
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...a: unknown[]) => authAndCompany(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeDb(store),
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
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/recipe-costing/editor-store", () => ({
  createSupabaseEditorStore: () => ({
    mergedInto: async () => null,
    currency: async () => "USD",
    addCostEntry: (...a: unknown[]) => addCostEntry(...a),
    createIngredient: async (
      companyId: string,
      input: { name: string; defaultUnit: string }
    ) => {
      const row = {
        id: `new-${store.ingredients.length}`,
        company_id: companyId,
        name: input.name,
        default_unit: input.defaultUnit,
      };
      store.ingredients.push(row);
      return { id: row.id, name: input.name, default_unit: input.defaultUnit };
    },
  }),
}));

import { PATCH } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/route";
import { POST as confirm } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route";
import { POST as reject } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/reject/route";
import { POST as savePrice } from "@/app/api/restaurant/kitchen/ingredient-price/route";
import { POST as createIngredient } from "@/app/api/restaurant/kitchen/ingredients/route";
import { POST as saveAlias } from "@/app/api/restaurant/kitchen/ingredient-aliases/route";

const MINE = "company-mine";
const OTHER = "company-other";
const FORBIDDEN = "No tienes permiso para cambiar esto.";

const json = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seed() {
  Object.assign(store, {
    kitchen_recipe_drafts: [
      {
        id: "d-mine",
        company_id: MINE,
        status: "draft",
        portions: 2,
        dish_name: "Plato",
        currency: "USD",
      },
      {
        id: "d-other",
        company_id: OTHER,
        status: "draft",
        portions: 2,
        dish_name: "Ajeno",
        currency: "USD",
      },
      {
        id: "d-wait",
        company_id: MINE,
        status: "awaiting_portions",
        portions: null,
        dish_name: "Sin porciones",
        currency: "USD",
      },
    ],
    kitchen_recipe_draft_lines: [
      {
        id: "l-1",
        draft_id: "d-mine",
        company_id: MINE,
        line_number: 1,
        raw_name: "queso",
        ingredient_id: "i-1",
        total_quantity: "240.000",
        unit: "gramos",
        per_portion_quantity: null,
      },
      {
        id: "l-2",
        draft_id: "d-mine",
        company_id: MINE,
        line_number: 2,
        raw_name: "sal",
        ingredient_id: null,
        total_quantity: null,
        unit: null,
        per_portion_quantity: null,
      },
    ],
    ingredients: [
      { id: "i-1", company_id: MINE, name: "Queso", default_unit: "kg" },
      { id: "i-x", company_id: OTHER, name: "Ajeno", default_unit: "kg" },
    ],
    ingredient_aliases: [],
    ingredient_cost_entries: [],
    menu_items: [],
    recipes: [],
    recipe_versions: [],
    recipe_version_inputs: [],
  });
}

beforeEach(() => {
  seed();
  addCostEntry.mockReset();
  addCostEntry.mockResolvedValue({ ok: true });
  isUserAdminServer.mockResolvedValue(false);
  loadMembershipRole.mockResolvedValue("owner");
  authAndCompany.mockResolvedValue({
    ok: true,
    companyId: MINE,
    userId: "user-1",
    supabase: makeFakeDb(store),
  });
});

describe("resolveCompanyIdForUser", () => {
  const db = (rows: Record<string, Row[]>) =>
    makeFakeDb(rows) as unknown as Parameters<
      typeof resolveCompanyIdForUser
    >[0];

  it("one membership → that company", async () => {
    const s = db({
      company_memberships: [
        { user_id: "u", company_id: "c1", created_at: "2026-01-01" },
      ],
      profiles: [{ id: "u", company_id: "c-foreign" }],
    });
    expect(await resolveCompanyIdForUser(s, "u")).toBe("c1");
  });

  it("two memberships, the profile points at one of them → that one", async () => {
    const s = db({
      company_memberships: [
        { user_id: "u", company_id: "c1", created_at: "2026-01-01" },
        { user_id: "u", company_id: "c2", created_at: "2026-02-01" },
      ],
      profiles: [{ id: "u", company_id: "c2" }],
    });
    expect(await resolveCompanyIdForUser(s, "u")).toBe("c2");
  });

  it("two memberships, the profile points elsewhere → the oldest membership, never the foreign company", async () => {
    const s = db({
      company_memberships: [
        { user_id: "u", company_id: "c2", created_at: "2026-02-01" },
        { user_id: "u", company_id: "c1", created_at: "2026-01-01" },
      ],
      profiles: [{ id: "u", company_id: "c-foreign" }],
    });
    expect(await resolveCompanyIdForUser(s, "u")).toBe("c1");
  });

  it("same created_at → the smaller company id, every time", async () => {
    const s = db({
      company_memberships: [
        { user_id: "u", company_id: "c-b", created_at: "2026-01-01" },
        { user_id: "u", company_id: "c-a", created_at: "2026-01-01" },
      ],
      profiles: [],
    });
    expect(await resolveCompanyIdForUser(s, "u")).toBe("c-a");
  });

  it("no membership (Milton staff, legacy) keeps the profile fallback", async () => {
    const s = db({
      company_memberships: [],
      profiles: [{ id: "u", company_id: "c-profile" }],
    });
    expect(await resolveCompanyIdForUser(s, "u")).toBe("c-profile");
  });
});

describe("an owner of two companies acts on the draft's company", () => {
  it("can create an ingredient, save a price and save a name on their draft (no 403)", async () => {
    const create = await createIngredient(
      json({ name: "TOCINO", draft_id: "d-mine" })
    );
    expect(create.status).toBe(200);
    expect((await create.json()).ingredient.name).toBe("Tocino");
    const price = await savePrice(
      json({
        ingredient_id: "i-1",
        unit: "kg",
        unit_cost: 5,
        draft_id: "d-mine",
      })
    );
    expect(price.status).toBe(200);
    expect(addCostEntry).toHaveBeenCalledTimes(1);
    const alias = await saveAlias(
      json({ raw_name: "quesito", ingredient_id: "i-1", draft_id: "d-mine" })
    );
    expect(alias.status).toBe(200);
  });

  it("the role is compared without caring about case or spaces: «Owner» passes", async () => {
    for (const role of ["Owner", " ADMIN ", "Manager"]) {
      loadMembershipRole.mockResolvedValue(role);
      const res = await savePrice(
        json({
          ingredient_id: "i-1",
          unit: "kg",
          unit_cost: 5,
          draft_id: "d-mine",
        })
      );
      expect(res.status, role).toBe(200);
    }
  });

  it("member / viewer / analyst / no role → 403 in Spanish on every draft endpoint", async () => {
    for (const role of ["member", "viewer", "analyst", null]) {
      loadMembershipRole.mockResolvedValue(role);
      const answers = [
        await createIngredient(json({ name: "Sal", draft_id: "d-mine" })),
        await savePrice(
          json({
            ingredient_id: "i-1",
            unit: "kg",
            unit_cost: 5,
            draft_id: "d-mine",
          })
        ),
        await saveAlias(
          json({ raw_name: "q", ingredient_id: "i-1", draft_id: "d-mine" })
        ),
        await PATCH(json({ dish_name: "X" }, "PATCH"), ctx("d-mine")),
        await confirm(json({}), ctx("d-mine")),
        await reject(json({}), ctx("d-mine")),
      ];
      for (const res of answers) {
        expect(res.status, String(role)).toBe(403);
        expect((await res.json()).error).toBe(FORBIDDEN);
      }
    }
    expect(
      store.kitchen_recipe_drafts.find((d) => d.id === "d-mine")?.status
    ).toBe("draft");
  });

  it("admin, manager and Milton staff can also save, confirm-check and reject", async () => {
    for (const role of ["admin", "manager"]) {
      loadMembershipRole.mockResolvedValue(role);
      expect(
        (await PATCH(json({ dish_name: "Nuevo" }, "PATCH"), ctx("d-mine")))
          .status
      ).toBe(200);
    }
    loadMembershipRole.mockResolvedValue(null);
    isUserAdminServer.mockResolvedValue(true);
    expect((await reject(json({}), ctx("d-mine"))).status).toBe(200);
  });
});

describe("another company's draft answers 404 everywhere", () => {
  it("PATCH, confirm, reject, price, create and alias", async () => {
    const answers = [
      await PATCH(json({ dish_name: "X" }, "PATCH"), ctx("d-other")),
      await confirm(
        json({
          dish_name: "X",
          portions: 2,
          lines: [{ ingredient_id: "i-1", total_quantity: 1, unit: "kg" }],
        }),
        ctx("d-other")
      ),
      await reject(json({}), ctx("d-other")),
      await savePrice(
        json({
          ingredient_id: "i-1",
          unit: "kg",
          unit_cost: 5,
          draft_id: "d-other",
        })
      ),
      await createIngredient(json({ name: "Sal", draft_id: "d-other" })),
      await saveAlias(
        json({ raw_name: "q", ingredient_id: "i-1", draft_id: "d-other" })
      ),
    ];
    for (const res of answers) expect(res.status).toBe(404);
    expect(addCostEntry).not.toHaveBeenCalled();
    expect(
      store.kitchen_recipe_drafts.find((d) => d.id === "d-other")?.status
    ).toBe("draft");
    expect(store.ingredients.some((i) => i.name === "Sal")).toBe(false);
  });
});

describe("a refused confirm leaves the stored lines alone", () => {
  it("quantity '240.000' / unit 'gramos' stay as they were after a 400", async () => {
    const res = await confirm(
      json({
        dish_name: "Plato",
        portions: 2,
        lines: [
          {
            id: "l-1",
            ingredient_id: "i-1",
            total_quantity: 240,
            unit: "pizca rara",
          },
        ],
      }),
      ctx("d-mine")
    );
    expect(res.status).toBe(400);
    const lines = store.kitchen_recipe_draft_lines.filter(
      (l) => l.draft_id === "d-mine"
    );
    expect(
      lines.map((l) => [l.id, l.total_quantity, l.unit, l.ingredient_id])
    ).toEqual([
      ["l-1", "240.000", "gramos", "i-1"],
      ["l-2", null, null, null],
    ]);
    expect(
      store.kitchen_recipe_drafts.find((d) => d.id === "d-mine")?.status
    ).toBe("draft");
  });

  it("a draft still waiting for portions is confirmed with the typed portions, and is untouched when the confirm is refused", async () => {
    const refused = await confirm(
      json({
        dish_name: "S",
        portions: 3,
        lines: [{ ingredient_id: null, total_quantity: 1, unit: "kg" }],
      }),
      ctx("d-wait")
    );
    expect(refused.status).toBe(400);
    const row = store.kitchen_recipe_drafts.find((d) => d.id === "d-wait")!;
    expect(row.status).toBe("awaiting_portions");
    expect(row.portions).toBeNull();
  });
});

describe("«Guardar borrador» through PATCH", () => {
  it("accepts lines with no ingredient, no quantity, no unit, the dropdown units and portions null", async () => {
    const res = await PATCH(
      json(
        {
          dish_name: "Plato",
          portions: null,
          menu_item_id: null,
          lines: [
            {
              id: "l-1",
              raw_name: "queso",
              ingredient_id: "i-1",
              total_quantity: 0.24,
              unit: "pza",
            },
            {
              id: "l-2",
              raw_name: "sal",
              ingredient_id: null,
              total_quantity: null,
              unit: null,
            },
            {
              raw_name: "algo raro",
              ingredient_id: null,
              total_quantity: null,
              unit: "pizca",
            },
            {
              raw_name: "pan",
              ingredient_id: null,
              total_quantity: 1,
              unit: "unidad",
            },
          ],
        },
        "PATCH"
      ),
      ctx("d-mine")
    );
    expect(res.status).toBe(200);
    const saved = (await res.json()).lines as Row[];
    expect(
      saved.map((l) => [l.raw_name, l.ingredient_id, l.total_quantity, l.unit])
    ).toEqual([
      ["queso", "i-1", 0.24, "pza"],
      ["sal", null, null, null],
      ["algo raro", null, null, "pizca"],
      ["pan", null, 1, "unidad"],
    ]);
    // portions null = unchanged
    expect(
      store.kitchen_recipe_drafts.find((d) => d.id === "d-mine")?.portions
    ).toBe(2);
  });

  it("a valid portions number moves awaiting_portions → draft; another company's ingredient is still refused", async () => {
    const ok = await PATCH(json({ portions: 4 }, "PATCH"), ctx("d-wait"));
    expect(ok.status).toBe(200);
    expect(
      store.kitchen_recipe_drafts.find((d) => d.id === "d-wait")?.status
    ).toBe("draft");
    const bad = await PATCH(
      json(
        {
          lines: [
            {
              raw_name: "x",
              ingredient_id: "i-x",
              total_quantity: 1,
              unit: "kg",
            },
          ],
        },
        "PATCH"
      ),
      ctx("d-mine")
    );
    expect(bad.status).toBe(400);
  });
});
