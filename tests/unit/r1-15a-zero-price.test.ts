// R1-15a: a price of $0 typed on purpose (Agua) is saved end to end and costs
// as $0; a missing price, a blank, a negative value and a 0 from a file stay
// Sin precio. Synthetic data only.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateMenuItemCost,
  lineHasOwnPrice,
  lineOwnCost,
  type CostingData,
} from "@/lib/restaurant/costing";
import {
  costInput,
  hydrateLines,
} from "@/lib/restaurant/recipe-costing/editor";
import { parsePriceInput } from "@/lib/restaurant/ingredientes-screen";

// The role is read with the admin client (lib/auth/permissions.ts).
vi.mock("@/lib/supabase/admin", () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { role: "owner" }, error: null }),
  };
  return { createAdminClient: () => chain };
});
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));
const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    userId: "u1",
    companyId: "co-1",
    supabase: {
      from(table: string) {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({
            data: { id: "i-agua", default_unit: "l" },
            error: null,
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.push({ table, ...row });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "e1", ...row },
                  error: null,
                }),
              }),
            };
          },
        };
        return b;
      },
    },
  }),
}));
vi.mock("@/lib/restaurant/currency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/restaurant/currency")>()),
  resolveCompanyCurrency: async () => "USD",
}));

import { POST } from "@/app/api/restaurant/ingredient-costs/route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/restaurant/ingredient-costs", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never
  );
}

const base = {
  ingredient_id: "i-agua",
  cost_date: "2026-10-14",
  quantity: 1,
  unit: "l",
  currency: "USD",
};

describe("Ingredientes › Precio actual: saves 0 end to end", () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it("the field parses a typed 0 and refuses blank and garbage", () => {
    expect(parsePriceInput("0")).toBe(0);
    expect(parsePriceInput("$0.00")).toBe(0);
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("-1")).toBeNull();
  });

  it("the route stores a manual entry with total_cost 0 and normalized cost 0", async () => {
    const res = await post({ ...base, total_cost: 0 });
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      table: "ingredient_cost_entries",
      source_type: "manual",
      total_cost: 0,
      unit_cost: 0,
      normalized_unit_cost: 0,
    });
    const json = (await res.json()) as {
      entry: { normalized_unit_cost: number };
    };
    expect(json.entry.normalized_unit_cost).toBe(0);
  });

  it("a negative price or a missing price is an error, never saved as 0", async () => {
    for (const total_cost of [-1, "abc", undefined]) {
      const res = await post({ ...base, total_cost });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/total_cost/);
    }
    expect(inserted).toHaveLength(0);
  });
});

describe("a recipe line's own price", () => {
  const line = (unit_cost: number | null, cost_source: string | null) => ({
    input_type: "ingredient" as const,
    ingredient_id: "i-agua",
    component_id: null,
    quantity: 3,
    unit: "l",
    unit_cost,
    cost_source,
  });

  it("a typed $0 counts; a 0 from a file or invoice and a missing price do not", () => {
    expect(lineHasOwnPrice(line(0, "manual"))).toBe(true);
    expect(lineHasOwnPrice(line(0, "DE LA PARRILLA!B8"))).toBe(false);
    expect(lineHasOwnPrice(line(0, "invoice_line"))).toBe(false);
    expect(lineHasOwnPrice(line(0, null))).toBe(false);
    expect(lineHasOwnPrice(line(null, "manual"))).toBe(false);
    expect(lineHasOwnPrice(line(-1, "manual"))).toBe(false);
    // Only a line with no price record of its own (a preparation) costs from
    // its own price; an INGREDIENT line reads the ingredient's cost entry.
    const prep = (cost: number, source: string) => ({
      ...line(cost, source),
      input_type: "component" as const,
      ingredient_id: null,
      component_id: "c-1",
    });
    expect(lineOwnCost(prep(0, "manual"))).toBe(0);
    expect(lineOwnCost(prep(0.4, "DE LA PARRILLA!B8"))).toBeCloseTo(1.2);
    expect(lineOwnCost(line(0, "manual"))).toBeNull();
    expect(lineOwnCost(line(0.4, "DE LA PARRILLA!B8"))).toBeNull();
  });

  const noPrice = {
    ingredientsById: new Map([
      ["i-agua", { id: "i-agua", name: "Agua", default_unit: "l" }],
    ]),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(),
  } as unknown as CostingData;

  it("costInput: an ingredient line's own copy ($0 included) is not a price; with no entry it stays Sin precio", () => {
    expect(costInput(noPrice, line(0, "manual"))).toMatchObject({
      amount: null,
      reason: "no_price",
    });
    expect(costInput(noPrice, line(0, null))).toMatchObject({
      amount: null,
      reason: "no_price",
    });
    expect(costInput(noPrice, line(null, null)).amount).toBeNull();
  });

  it("the editor line has no own cost; a copy with no ingredient price is pending and offered (legacy)", () => {
    const lines = hydrateLines({
      data: noPrice,
      evidenceLines: [],
      inputs: [{ id: "in-1", ...line(0, "manual") }],
      names: {
        ingredients: new Map([["i-agua", "Agua"]]),
        components: new Map(),
        priceOf: () => null,
        suggest: () => null,
      },
    });
    expect(lines[0]).toMatchObject({
      amount: null,
      pending: true,
      own_cost: false,
      legacy_price: { unit_cost: 0, unit: "l" },
    });
    const missing = hydrateLines({
      data: noPrice,
      evidenceLines: [],
      inputs: [{ id: "in-2", ...line(null, null) }],
      names: {
        ingredients: new Map([["i-agua", "Agua"]]),
        components: new Map(),
        priceOf: () => null,
        suggest: () => null,
      },
    });
    expect(missing[0]).toMatchObject({
      amount: null,
      pending: true,
      own_cost: false,
    });
  });

  it("a dish whose ingredient has no entry is not costed from a line copy, $0 or not", () => {
    const withDish = (cost: number | null, source: string | null) =>
      ({
        ...noPrice,
        menuItemsById: new Map([
          [
            "m1",
            { id: "m1", name: "Plato", selling_price: 10, currency: "USD" },
          ],
        ]),
        menuRecipesByMenuItemId: new Map([
          ["m1", { id: "r1", menu_item_id: "m1", status: "active" }],
        ]),
        menuRecipeInputsByRecipeId: new Map([["r1", [line(cost, source)]]]),
      }) as unknown as CostingData;
    const ok = calculateMenuItemCost("m1", withDish(0, "manual"));
    expect(ok.status).not.toBe("complete");
    expect(ok.cost).toBeNull();
    const missing = calculateMenuItemCost(
      "m1",
      withDish(0, "DE LA PARRILLA!B8")
    );
    expect(missing.cost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Preparaciones: total row under "Aporte"
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { recipeLinesTotal } from "@/lib/restaurant/recipe-costing/editor";

describe("Preparaciones total row", () => {
  it("is the sum of the lines when every line has a cost", () => {
    expect(
      recipeLinesTotal([{ amount: 1.25 }, { amount: 0 }, { amount: 0.75 }])
    ).toEqual({ total: 2, missing: 0, complete: true });
  });

  it("a missing price makes it incomplete: no total, never $0", () => {
    const r = recipeLinesTotal([{ amount: 1.25 }, { amount: null }]);
    expect(r).toEqual({ total: null, missing: 1, complete: false });
    // Only missing lines: still no total.
    expect(recipeLinesTotal([{ amount: null }]).total).toBeNull();
  });

  it("no lines is not a $0 total", () => {
    expect(recipeLinesTotal([])).toEqual({
      total: null,
      missing: 0,
      complete: false,
    });
  });

  it("the row is rendered for preparations only, under Aporte, with Sin precio when incomplete", () => {
    const src = readFileSync(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx",
      "utf8"
    );
    const dict = readFileSync("lib/i18n/es/menu-editor.ts", "utf8");
    expect(dict).toContain("Total de la preparación");
    expect(src).toContain("componentId && state.lines.length > 0");
    expect(src + dict).toContain("Sin precio");
    expect(src + dict).toContain("incompleto");
  });
});
