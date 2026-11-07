// Sofia's decisions on #480: «Confirmar 1 unidad» (reversible, who and when),
// the recipe editor read-only for cooks with no money in the payload, and
// Menú › Ingredientes closed to kitchen roles. Demo data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "manager";
let memory: ReturnType<typeof memoryEditorState>;
const attach = vi.fn(async () => undefined);

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              email: "ana@demo.test",
              user_metadata: { full_name: "Ana Demo" },
            },
          },
        }),
      },
    },
    companyId: "co-1",
    userId: "u1",
  }),
}));
vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => "es" }));
vi.mock("@/lib/auth/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/permissions")>()),
  resolveActor: async () => ({
    userId: "u1",
    companyId: "co-1",
    role,
    isMiltonStaff: false,
  }),
}));
vi.mock("@/lib/restaurant/recipe-costing/editor-store", () => ({
  createSupabaseEditorStore: () => createMemoryEditorStore(memory),
}));
vi.mock("@/lib/restaurant/menu-reading/estimate-store", () => ({
  loadPriceEstimates: async () => ({ ok: true, rows: [] }),
}));
vi.mock("@/lib/restaurant/effective-cost-server", () => ({
  attachEffectiveCosts: () => attach(),
}));

import { GET, POST } from "@/app/api/restaurant/recipes/editor/route";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";
import { isMeasuredOutput, yieldEvidenceOf } from "@/lib/restaurant/prep-yield";
import { coveredByMeasuredPrep } from "@/lib/restaurant/nested-yield";
import { canSeeIngredientes } from "@/lib/restaurant/ingredientes-screen";
import { redactMermaInputs } from "@/lib/restaurant/merma-visibility";

function seed(over: { qty?: number; holder?: boolean } = {}) {
  memory = memoryEditorState({
    ingredients: [{ id: "i-tomate", name: "Tomate demo", default_unit: "oz" }],
    entries: [entry("i-tomate", "oz", 0.04)],
    components: [{ id: "c-salsa", name: "Salsa demo", output_unit: "oz" }],
    preparations: [
      {
        component_id: "c-salsa",
        name: "Salsa demo",
        version: {
          id: "cv1",
          status: "in_review",
          kind: "preparation",
          component_id: "c-salsa",
          component_recipe_id: "cr1",
          output_quantity: over.qty ?? 1,
          output_unit: "unit",
        },
        inputs: [
          {
            id: "pin-1",
            input_type: "ingredient",
            ingredient_id: "i-tomate",
            component_id: null,
            quantity: 16,
            unit: "oz",
          },
        ],
        holder:
          over.holder === false
            ? null
            : {
                id: "h1",
                evidence: {
                  yield: {
                    value: 1,
                    unit: "unit",
                    source: "assumed",
                    confirmed: false,
                  },
                },
              },
      },
    ],
  } as never);
}

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost/api/restaurant/recipes/editor", {
      method: "POST",
      body: JSON.stringify({ component_id: "c-salsa", ...body }),
    })
  );
const get = () =>
  GET(
    new NextRequest(
      "http://localhost/api/restaurant/recipes/editor?component_id=c-salsa"
    )
  );
type Body = {
  error?: string;
  editable: boolean;
  role_read_only?: boolean;
  money_hidden?: boolean;
  locked_reason: string | null;
  total_cost: number | null;
  lines: Array<Record<string, unknown>>;
  preparation: {
    yield: { confirmed: boolean; value: number };
    yield_confirmed_default: boolean;
    yield_history: Array<{ by_name: string | null; action: string }>;
    cost_per_output_unit: number | null;
  };
};

beforeEach(() => {
  role = "manager";
  attach.mockClear();
  seed();
});

describe("«Confirmar 1 unidad»", () => {
  it("measures the prep, removes the flag, stores who and when, and is in the history", async () => {
    const res = await post({ action: "confirm_yield" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.preparation.yield).toMatchObject({
      confirmed: true,
      value: 1,
    });
    expect(body.preparation.yield_confirmed_default).toBe(true);
    expect(body.preparation.yield_history).toEqual([
      expect.objectContaining({ by_name: "Ana Demo", action: "confirm" }),
    ]);
    const stored = memory.preparations[0].holder!.evidence.yield as Record<
      string,
      unknown
    >;
    expect(stored).toMatchObject({
      confirmed: true,
      confirmed_by: "u1",
    });
    expect(typeof stored.confirmed_at).toBe("string");
    // the shared rule now says measured (so the list flag goes)
    expect(
      isMeasuredOutput({
        quantity: 1,
        status: "in_review",
        evidence: yieldEvidenceOf(memory.preparations[0].holder!.evidence),
      })
    ).toBe(true);
  });

  it("stops the buffer on the prep's ingredients (covered by a measured prep)", () => {
    const node = (measured: boolean) =>
      new Map([["c-salsa", { id: "c-salsa", measured, children: [] }]]);
    expect(coveredByMeasuredPrep("c-salsa", node(false))).toBe(false);
    expect(coveredByMeasuredPrep("c-salsa", node(true))).toBe(true);
  });

  it("is reversible and the history keeps both steps", async () => {
    await post({ action: "confirm_yield" });
    const res = await post({ action: "unconfirm_yield" });
    const body = (await res.json()) as Body;
    expect(body.preparation.yield.confirmed).toBe(false);
    expect(body.preparation.yield_confirmed_default).toBe(false);
    expect(body.preparation.yield_history.map((h) => h.action)).toEqual([
      "confirm",
      "revoke",
    ]);
  });

  it("only the default 1 can be confirmed as is; nothing to undo is refused", async () => {
    seed({ qty: 6.5 });
    expect((await post({ action: "confirm_yield" })).status).toBe(400);
    seed();
    expect((await post({ action: "unconfirm_yield" })).status).toBe(400);
  });

  it("with no open draft it says so, never a silent no-op", async () => {
    seed({ holder: false });
    expect((await post({ action: "confirm_yield" })).status).toBe(409);
  });

  it.each(["member", "viewer", "analyst", null])(
    "%s cannot use it: 403 and nothing changes",
    async (r) => {
      role = r;
      const before = JSON.stringify(memory.preparations[0].holder);
      const res = await post({ action: "confirm_yield" });
      expect(res.status).toBe(403);
      expect(JSON.stringify(memory.preparations[0].holder)).toBe(before);
    }
  );
  it.each(["owner", "admin", "manager"])("%s can", async (r) => {
    role = r;
    expect((await post({ action: "confirm_yield" })).status).toBe(200);
  });
});

describe("the recipe editor for a cook", () => {
  it.each(["member", null])(
    "%s: quantities stay, no money anywhere, read-only",
    async (r) => {
      role = r;
      const res = await get();
      expect(res.status).toBe(200);
      const body = (await res.json()) as Body;
      expect(body.editable).toBe(false);
      expect(body.role_read_only).toBe(true);
      expect(body.money_hidden).toBe(true);
      expect(attach).not.toHaveBeenCalled();
      expect(body.total_cost).toBeNull();
      expect(body.preparation.cost_per_output_unit).toBeNull();
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({ qty: 16, unit: "oz" });
      for (const k of [
        "unit_cost",
        "amount",
        "price",
        "legacy_price",
        "excel_unit_cost",
      ])
        expect(body.lines[0][k] ?? null).toBeNull();
      expect("effective" in body.lines[0]).toBe(false);
      expect("milton_price_estimate" in body.lines[0]).toBe(false);
      // no price-looking number anywhere in the payload
      expect(JSON.stringify(body)).not.toMatch(/0\.04|"unit_cost":\s*[0-9]/);
    }
  );
  it.each(["viewer", "analyst"])(
    "%s sees the money but cannot edit",
    async (r) => {
      role = r;
      const body = (await (await get()).json()) as Body;
      expect(body.money_hidden).toBeUndefined();
      expect(body.editable).toBe(false);
      expect(body.role_read_only).toBe(true);
      expect(body.lines[0].amount).not.toBeNull();
    }
  );
  it.each(["owner", "admin", "manager"])(
    "%s keeps editing with the money",
    async (r) => {
      role = r;
      const body = (await (await get()).json()) as Body;
      expect(body.editable).toBe(true);
      expect(body.role_read_only).toBeUndefined();
      expect(body.lines[0].amount).not.toBeNull();
    }
  );
  it("a cook cannot edit through the API either", async () => {
    role = "member";
    const res = await post({ action: "set_yield", quantity: 6, unit: "kg" });
    expect(res.status).toBe(403);
  });
});

describe("Menú › Ingredientes is closed to kitchen roles", () => {
  it("only roles with prices.view see the tab / the page", () => {
    expect(canSeeIngredientes({ "prices.view": false })).toBe(false);
    expect(canSeeIngredientes({ "prices.view": true })).toBe(true);
  });
  it("a cook's payload carries no price, cost or sales field even if it were built", () => {
    const item = {
      id: "i1",
      name: "Tomate demo",
      price: 4,
      previous_price: 3,
      price_unit: "kg",
      price_date: "2026-10-01",
      yieldPct: 20,
      yieldHistory: [{}],
      sold_net_sales: 12000,
    };
    const out = redactMermaInputs(item, false);
    expect(out).toMatchObject({
      price: null,
      previous_price: null,
      price_unit: null,
      price_date: null,
      yieldPct: null,
      yieldHistory: [],
      sold_net_sales: 0,
    });
    expect(JSON.stringify(out)).not.toMatch(/12000|"price":\s*4/);
  });
});
