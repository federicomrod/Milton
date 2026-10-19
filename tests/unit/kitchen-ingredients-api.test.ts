// Revisar receta: creating ingredients, remembering names, inline prices.
// Every endpoint is company-scoped and owner/staff only. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

const {
  store,
  authAndCompany,
  isUserAdminServer,
  loadMembershipRole,
  addCostEntry,
  economics,
} = vi.hoisted(() => ({
  store: {} as Record<string, Record<string, unknown>[]>,
  authAndCompany: vi.fn(),
  isUserAdminServer: vi.fn(),
  loadMembershipRole: vi.fn(),
  addCostEntry: vi.fn(),
  economics: vi.fn(),
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...a: unknown[]) => authAndCompany(...a),
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
// The ONE pricing path: its store. addCostEntry is what gets called.
vi.mock("@/lib/restaurant/recipe-costing/editor-store", async () => {
  const fake = makeFakeDb(store);
  return {
    createSupabaseEditorStore: () => ({
      mergedInto: async () => null,
      currency: async () => "USD",
      addCostEntry: (...a: unknown[]) => addCostEntry(...a),
      createIngredient: async (
        companyId: string,
        input: { name: string; defaultUnit: string }
      ) => {
        const table = fake.from("ingredients") as unknown as {
          insert: (row: unknown) => {
            select: (cols: string) => {
              single: () => Promise<{ data: Record<string, unknown> }>;
            };
          };
        };
        const { data } = await table
          .insert({
            company_id: companyId,
            name: input.name,
            default_unit: input.defaultUnit,
          })
          .select("id")
          .single();
        return {
          id: String(data.id),
          name: input.name,
          default_unit: input.defaultUnit,
        };
      },
    }),
  };
});
vi.mock("@/lib/restaurant/costing/dish-economics-server", () => ({
  loadDishEconomics: (...a: unknown[]) => economics(...a),
}));

import {
  GET as listIngredients,
  POST as createIngredient,
} from "@/app/api/restaurant/kitchen/ingredients/route";
import { POST as saveAlias } from "@/app/api/restaurant/kitchen/ingredient-aliases/route";
import { POST as savePrice } from "@/app/api/restaurant/kitchen/ingredient-price/route";
import { GET as usage } from "@/app/api/restaurant/kitchen/ingredients/[id]/usage/route";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import { matchIngredients } from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import { computeDraftCost } from "@/lib/restaurant/kitchen-draft-costing";
import { latestCostEntry } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

const COMPANY = "co-1";
const OTHER = "co-2";

function json(body: unknown) {
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  addCostEntry.mockReset();
  addCostEntry.mockResolvedValue({ ok: true });
  economics.mockReset();
  economics.mockResolvedValue({ ok: false, error: "none" });
  authAndCompany.mockResolvedValue({
    ok: true,
    companyId: COMPANY,
    userId: "u-1",
    supabase: makeFakeDb(store),
  });
  isUserAdminServer.mockResolvedValue(false);
  loadMembershipRole.mockResolvedValue("owner");
  Object.assign(store, {
    ingredients: [
      {
        id: "i-mozz",
        company_id: COMPANY,
        name: "Queso mozzarella",
        default_unit: "kg",
      },
      { id: "i-pan", company_id: COMPANY, name: "Pan", default_unit: "pza" },
      { id: "i-other", company_id: OTHER, name: "Tocino", default_unit: "kg" },
    ],
    ingredient_aliases: [],
    ingredient_cost_entries: [],
  });
});

describe("«+ Crear bacon»", () => {
  it("creates it WITHOUT a price; then «Bacon» / «BACÓN» answer «Ya existe»", async () => {
    const res = await createIngredient(json({ name: "bacon", unit: "kg" }));
    expect(res.status).toBe(200);
    const created = (await res.json()).ingredient;
    expect(created.name).toBe("bacon");
    expect(addCostEntry).not.toHaveBeenCalled();
    expect(store.ingredient_cost_entries).toHaveLength(0);

    for (const variant of ["Bacon", "BACÓN", "  bacon  "]) {
      const again = await createIngredient(json({ name: variant }));
      expect(again.status, variant).toBe(409);
      const body = await again.json();
      expect(body.error).toBe('Ya existe "bacon". ¿Usarlo?');
      expect(body.existing).toEqual({ id: created.id, name: "bacon" });
    }
    expect(
      store.ingredients.filter((i) => i.company_id === COMPANY)
    ).toHaveLength(3);
  });

  it("a remembered alias also blocks the duplicate («tocino» → Bacon)", async () => {
    const made = await createIngredient(json({ name: "Bacon" }));
    const id = (await made.json()).ingredient.id;
    store.ingredient_aliases.push({
      company_id: COMPANY,
      alias_key: aliasKeyFor("tocino"),
      alias_name: "tocino",
      ingredient_id: id,
    });
    const res = await createIngredient(json({ name: "Tocino" }));
    expect(res.status).toBe(409);
    expect((await res.json()).existing.id).toBe(id);
  });

  it("another company's ingredient does not block this company", async () => {
    const res = await createIngredient(json({ name: "Tocino" }));
    expect(res.status).toBe(200);
  });

  it("refuses an empty name and a member without permission", async () => {
    expect((await createIngredient(json({ name: " " }))).status).toBe(400);
    loadMembershipRole.mockResolvedValue("member");
    expect((await createIngredient(json({ name: "Sal" }))).status).toBe(403);
  });
});

describe("remembering a name", () => {
  it("saves the alias for this company; the next draft with that name matches EXACTLY", async () => {
    const res = await saveAlias(
      json({ raw_name: "queso fresco", ingredient_id: "i-mozz" })
    );
    expect(res.status).toBe(200);
    expect(store.ingredient_aliases).toHaveLength(1);
    expect(store.ingredient_aliases[0]).toMatchObject({
      company_id: COMPANY,
      alias_key: "QUESO FRESCO",
      ingredient_id: "i-mozz",
    });

    const ingredients = [
      { id: "i-mozz", name: "Queso mozzarella", default_unit: "kg" },
      { id: "i-pan", name: "Pan", default_unit: "pza" },
    ];
    const aliasMap = new Map(
      store.ingredient_aliases.map((r) => [
        String(r.alias_key),
        String(r.ingredient_id),
      ])
    );
    const line = {
      name: "Queso Fresco",
      estimated_quantity: 1,
      unit: "kg",
      confidence: "high" as const,
    };
    // before: nothing; after: matched by the remembered name
    const costs = new Map([
      [
        "i-mozz",
        [
          {
            id: "c",
            company_id: COMPANY,
            ingredient_id: "i-mozz",
            supplier_id: null,
            source_type: "manual",
            source_id: null,
            cost_date: "2026-10-01",
            quantity: 1,
            unit: "kg",
            total_cost: 7,
            unit_cost: 7,
            normalized_unit_cost: 7,
            normalized_unit: "kg",
            currency: "USD",
            created_at: "2026-10-01T00:00:00Z",
          } as never,
        ],
      ],
    ]);
    expect(
      matchIngredients([line], ingredients, costs, 2)[0].ingredient_id
    ).toBeNull();
    const after = matchIngredients([line], ingredients, costs, 2, aliasMap)[0];
    expect(after.ingredient_id).toBe("i-mozz");
    expect(after.confidence).toBe("high");
  });

  it("rejects another company's ingredient and writes nothing", async () => {
    const res = await saveAlias(
      json({ raw_name: "tocino", ingredient_id: "i-other" })
    );
    expect(res.status).toBe(400);
    expect(store.ingredient_aliases).toHaveLength(0);
  });

  it("its own name needs no alias", async () => {
    const res = await saveAlias(
      json({ raw_name: "PAN", ingredient_id: "i-pan" })
    );
    expect((await res.json()).saved).toBe(false);
    expect(store.ingredient_aliases).toHaveLength(0);
  });

  it("members cannot teach names", async () => {
    loadMembershipRole.mockResolvedValue("viewer");
    expect(
      (await saveAlias(json({ raw_name: "x y", ingredient_id: "i-pan" })))
        .status
    ).toBe(403);
  });
});

describe("inline price: the ONE pricing path", () => {
  it("calls addCostEntry exactly once, with the ingredient, unit and price", async () => {
    const res = await savePrice(
      json({ ingredient_id: "i-mozz", unit: "kg", unit_cost: 7.5 })
    );
    expect(res.status).toBe(200);
    expect(addCostEntry).toHaveBeenCalledTimes(1);
    expect(addCostEntry.mock.calls[0][0]).toBe(COMPANY);
    expect(addCostEntry.mock.calls[0][1]).toMatchObject({
      ingredientId: "i-mozz",
      unit: "kg",
      unitCost: 7.5,
      dateSource: "manual",
    });
  });

  it("rejects another company's ingredient: nothing is priced", async () => {
    const res = await savePrice(
      json({ ingredient_id: "i-other", unit: "kg", unit_cost: 3 })
    );
    expect(res.status).toBe(400);
    expect(addCostEntry).not.toHaveBeenCalled();
  });

  it("refuses a missing / negative price and a member", async () => {
    expect(
      (await savePrice(json({ ingredient_id: "i-pan", unit: "pza" }))).status
    ).toBe(400);
    expect(
      (
        await savePrice(
          json({ ingredient_id: "i-pan", unit: "pza", unit_cost: -1 })
        )
      ).status
    ).toBe(400);
    loadMembershipRole.mockResolvedValue("member");
    expect(
      (
        await savePrice(
          json({ ingredient_id: "i-pan", unit: "pza", unit_cost: 1 })
        )
      ).status
    ).toBe(403);
    expect(addCostEntry).not.toHaveBeenCalled();
  });

  it("other dishes that use the ingredient see the new price (one price entry, read through the shared latest rule)", () => {
    const entry = (price: number, created: string): IngredientCostEntry =>
      ({
        id: created,
        company_id: COMPANY,
        ingredient_id: "i-mozz",
        supplier_id: null,
        source_type: "manual",
        source_id: null,
        cost_date: "2026-10-01",
        effective_date: "2026-10-01",
        quantity: 1,
        unit: "kg",
        total_cost: price,
        unit_cost: price,
        normalized_unit_cost: price,
        normalized_unit: "kg",
        currency: "USD",
        created_at: created,
      }) as unknown as IngredientCostEntry;
    const entries = [entry(5, "2026-10-01T10:00:00Z")];
    const priceNow = () => {
      const latest = latestCostEntry(entries)!;
      return new Map([
        [
          "i-mozz",
          {
            unit_cost: latest.normalized_unit_cost,
            unit: latest.normalized_unit,
          },
        ],
      ]);
    };
    const dishA = [
      {
        key: "a",
        ingredient_id: "i-mozz",
        name: "Queso",
        total_quantity: 1,
        unit: "kg",
      },
    ];
    const dishB = [
      {
        key: "b",
        ingredient_id: "i-mozz",
        name: "Queso",
        total_quantity: 500,
        unit: "g",
      },
    ];
    expect(computeDraftCost(dishA, priceNow(), 1, null).total).toBe(5);
    expect(computeDraftCost(dishB, priceNow(), 1, null).total).toBe(2.5);
    // the price edit adds ONE dated entry (what addCostEntry writes)
    entries.push(entry(8, "2026-10-02T10:00:00Z"));
    expect(computeDraftCost(dishA, priceNow(), 1, null).total).toBe(8);
    expect(computeDraftCost(dishB, priceNow(), 1, null).total).toBe(4);
  });
});

describe("how many dishes a price change reaches", () => {
  it("counts the dishes that use the ingredient", async () => {
    economics.mockResolvedValue({
      ok: true,
      result: {
        dishes: [
          { name: "Hamburguesa", lines: [{ ingredient_id: "i-mozz" }] },
          {
            name: "Pizza",
            lines: [{ ingredient_id: "i-mozz" }, { ingredient_id: "i-pan" }],
          },
          { name: "Ensalada", lines: [{ ingredient_id: "i-pan" }] },
        ],
      },
    });
    const res = await usage(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "i-mozz" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dishes: 2,
      names: ["Hamburguesa", "Pizza"],
    });
  });
  it("another company's ingredient answers 404", async () => {
    const res = await usage(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "i-other" }),
    });
    expect(res.status).toBe(404);
    expect(economics).not.toHaveBeenCalled();
  });
});

describe("the ingredient list", () => {
  it("is this company's, with the current price per unit, and hides archived ones", async () => {
    store.ingredients.find((i) => i.id === "i-pan")!.archived_at = "2026-09-01";
    store.ingredient_cost_entries.push({
      id: "c-1",
      company_id: COMPANY,
      ingredient_id: "i-mozz",
      source_type: "manual",
      cost_date: "2026-10-01",
      effective_date: "2026-10-01",
      normalized_unit_cost: 7,
      normalized_unit: "kg",
      unit_cost: 7,
      currency: "USD",
      created_at: "2026-10-01T00:00:00Z",
    });
    const res = await listIngredients();
    expect(res.status).toBe(200);
    const { ingredients } = await res.json();
    expect(ingredients.map((i: { id: string }) => i.id)).toEqual(["i-mozz"]);
    expect(ingredients[0].price).toEqual({ unit_cost: 7, unit: "kg" });
  });
});
