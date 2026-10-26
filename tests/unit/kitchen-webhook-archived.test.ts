// A cook who says the old name of a merged-away ingredient gets the SURVIVOR
// on the draft line, never the archived row. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

const { store, after, extract, send } = vi.hoisted(() => ({
  store: {} as Record<string, Record<string, unknown>[]>,
  after: [] as Promise<unknown>[],
  extract: vi.fn(),
  send: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      after.push(Promise.resolve().then(() => fn()));
    },
  };
});
vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: (...a: unknown[]) => send(...(a as [])),
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeDb(store),
}));
vi.mock("@/lib/restaurant/telegram/kitchen-links", () => ({
  listActiveLinks: async () => [
    {
      staffId: "st-1",
      companyId: "co-1",
      companyName: "Demo Resto",
      locationId: "loc-1",
      locationName: "Local",
      telegramUserId: 9,
    },
  ],
  validateLink: async () => null,
}));
vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return {
    ...actual,
    recordKitchenReport: async () => true,
  };
});
vi.mock(
  "@/lib/restaurant/telegram/kitchen-recipe-drafts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/kitchen-recipe-drafts")
      >();
    return {
      ...actual,
      extractAndCreateRecipeDraft: (...a: unknown[]) => extract(...a),
    };
  }
);

import { POST } from "@/app/api/telegram/webhook/route";
import { matchIngredients } from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  extract.mockReset();
  extract.mockResolvedValue({ ok: true, draftId: "d-1" });
  send.mockClear();
  after.length = 0;
  Object.assign(store, {
    // "Bacon" was merged into "Tocino": archived, and its name is an alias
    ingredients: [
      {
        id: "i-bacon",
        company_id: "co-1",
        name: "Bacon",
        default_unit: "kg",
        archived_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "i-tocino",
        company_id: "co-1",
        name: "Tocino",
        default_unit: "kg",
        archived_at: null,
      },
      { id: "i-pan", company_id: "co-1", name: "Pan", default_unit: "pza" },
      { id: "i-other", company_id: "co-2", name: "Bacon", default_unit: "kg" },
    ],
    ingredient_aliases: [
      {
        company_id: "co-1",
        alias_key: aliasKeyFor("bacon"),
        alias_name: "bacon",
        ingredient_id: "i-tocino",
      },
    ],
    ingredient_cost_entries: [],
    kitchen_recipe_drafts: [],
    companies: [],
  });
});

async function sendRecipe() {
  const res = await POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "s3cret" },
      body: JSON.stringify({
        message: {
          message_id: 7,
          text: "receta de hamburguesa, salió para 2 porciones, lleva bacon y pan",
          from: { id: 9 },
          chat: { id: 555, type: "private" },
        },
      }),
    })
  );
  await Promise.all(after.splice(0));
  return res;
}

describe("the draft is built from ACTIVE ingredients only", () => {
  it("the archived Bacon (and another company's) never reach the matcher; the alias points at Tocino", async () => {
    await sendRecipe();
    expect(extract).toHaveBeenCalledTimes(1);
    const [, ingredients, , aliasKeyToId] = extract.mock.calls[0] as [
      unknown,
      Array<{ id: string; name: string }>,
      unknown,
      Map<string, string>,
    ];
    expect(ingredients.map((i) => i.id).sort()).toEqual(["i-pan", "i-tocino"]);
    expect(aliasKeyToId.get(aliasKeyFor("bacon"))).toBe("i-tocino");

    // and what the matcher does with exactly those arguments
    const matched = matchIngredients(
      [
        {
          name: "bacon",
          estimated_quantity: 0.2,
          unit: "kg",
          confidence: "high",
        },
        { name: "Pan", estimated_quantity: 2, unit: "pza", confidence: "high" },
      ],
      ingredients.map((i) => ({ ...i, default_unit: "kg" })),
      new Map(),
      2,
      aliasKeyToId
    );
    expect(matched[0].ingredient_id).toBe("i-tocino");
    expect(matched[0].ingredient_name).toBe("Tocino");
    expect(matched.some((l) => l.ingredient_id === "i-bacon")).toBe(false);
  });

  it("an alias whose ingredient is not in the active list is ignored (no match)", () => {
    const matched = matchIngredients(
      [
        {
          name: "panceta",
          estimated_quantity: 1,
          unit: "kg",
          confidence: "high",
        },
      ],
      [{ id: "i-pan", name: "Pan", default_unit: "pza" }],
      new Map(),
      2,
      new Map([[aliasKeyFor("panceta"), "i-bacon"]])
    );
    expect(matched[0].ingredient_id).toBeNull();
  });
});
