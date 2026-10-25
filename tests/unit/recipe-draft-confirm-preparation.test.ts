// «Confirmar como preparación»: a draft marked as preparación becomes an
// in_review version of a preparation (Menú › Preparaciones), never touching
// an approved version, platos, prices or other companies. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const store: FakeStore = {};
const authAndCompany = vi.fn();
const loadMembershipRole = vi.fn();
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
  createAdminClient: () =>
    makeFakeDb(store, {
      fail: (table, mode, payload) => failRule?.(table, mode, payload) ?? false,
    }),
}));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    resolveActor: async (
      _s: unknown,
      userId: string,
      opts?: { companyId?: string | null }
    ) => ({
      userId,
      companyId: opts?.companyId ?? null,
      role: actual.normalizeRole(
        await loadMembershipRole(opts?.companyId, userId)
      ),
      isMiltonStaff: false,
    }),
  };
});

import { POST } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route";

const COMPANY = "company-1";
const DRAFT = "draft-prep";
const BACON = "ing-bacon";
const PAN = "ing-pan";

function prepBody(over: Record<string, unknown> = {}) {
  return {
    kind: "preparacion",
    dish_name: "Salsa Roja · preparación",
    yield_quantity: 1,
    yield_unit: "l",
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

const draftRow = () => store.kitchen_recipe_drafts[0];

beforeEach(() => {
  failRule = null;
  authAndCompany.mockResolvedValue({
    ok: true,
    companyId: COMPANY,
    userId: "user-1",
    supabase: {},
  });
  loadMembershipRole.mockResolvedValue("owner");
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    kitchen_recipe_drafts: [
      {
        id: DRAFT,
        company_id: COMPANY,
        status: "draft",
        dish_name: "Salsa Roja · preparación",
        portions: null,
        currency: "USD",
      },
    ],
    kitchen_recipe_draft_lines: [
      { id: "line-1", draft_id: DRAFT, company_id: COMPANY },
      { id: "line-2", draft_id: DRAFT, company_id: COMPANY },
    ],
    ingredients: [
      { id: BACON, company_id: COMPANY, name: "Bacon", default_unit: "kg" },
      { id: PAN, company_id: COMPANY, name: "Pan", default_unit: "pza" },
    ],
    ingredient_cost_entries: [],
    prepared_components: [],
    component_recipes: [],
    component_recipe_versions: [],
    component_recipe_version_inputs: [],
    recipes: [],
    menu_items: [],
    menu_recipe_inputs: [],
  });
});

describe("confirm a preparation draft", () => {
  it("creates a new preparation with an in_review version and nothing else", async () => {
    const res = await confirm(prepBody());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      kind: "preparacion",
      status: "in_review",
    });
    expect(store.prepared_components).toHaveLength(1);
    // the marker is not stored in the name
    expect(store.prepared_components[0]).toMatchObject({
      name: "Salsa Roja",
      company_id: COMPANY,
      output_unit: "l",
    });
    expect(json.component_id).toBe(store.prepared_components[0].id);
    const v = store.component_recipe_versions;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      id: json.version_id,
      status: "in_review",
      output_quantity: 1,
      output_unit: "l",
      version_number: 1,
    });
    const lines = store.component_recipe_version_inputs;
    expect(lines.map((r) => [r.ingredient_id, r.quantity, r.unit])).toEqual([
      [BACON, 0.4, "kg"],
      [PAN, 2, "pza"],
    ]);
    // no dish side effects, no prices
    expect(store.recipes).toHaveLength(0);
    expect(store.menu_items).toHaveLength(0);
    expect(store.menu_recipe_inputs).toHaveLength(0);
    expect(store.ingredient_cost_entries).toHaveLength(0);
    // the draft leaves the pending list
    expect(draftRow()).toMatchObject({
      status: "confirmed",
      confirmed_by: "user-1",
    });
    expect(draftRow().confirmed_recipe_id ?? null).toBeNull();
    expect(draftRow().portions).toBeNull();
  });

  it("adds a NEW in_review version to an existing preparation found by folded name; the approved version is untouched", async () => {
    store.prepared_components.push({
      id: "pc-1",
      company_id: COMPANY,
      name: "salsa  rójá",
      output_unit: "kg",
    });
    store.component_recipes.push({
      id: "cr-1",
      company_id: COMPANY,
      component_id: "pc-1",
      name: "salsa  rójá",
      output_quantity: 5,
      output_unit: "kg",
    });
    store.component_recipe_versions.push({
      id: "crv-1",
      company_id: COMPANY,
      component_recipe_id: "cr-1",
      component_id: "pc-1",
      version_number: 1,
      status: "approved",
      output_quantity: 5,
      output_unit: "kg",
      source_type: "manual",
    });
    store.component_recipe_version_inputs.push({
      id: "crvi-1",
      company_id: COMPANY,
      component_recipe_version_id: "crv-1",
      ingredient_id: PAN,
      quantity: 9,
      unit: "kg",
    });
    const before = JSON.stringify([
      store.prepared_components,
      store.component_recipes,
      store.component_recipe_versions,
      store.component_recipe_version_inputs,
    ]);
    const res = await confirm(prepBody({ dish_name: "Salsa Roja" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.component_id).toBe("pc-1");
    expect(store.prepared_components).toHaveLength(1);
    expect(store.prepared_components[0].name).toBe("salsa  rójá");
    expect(store.prepared_components[0].output_unit).toBe("kg");
    expect(store.component_recipes).toHaveLength(1);
    expect(
      store.component_recipe_versions.map((v) => [
        v.version_number,
        v.status,
        v.output_quantity,
        v.output_unit,
      ])
    ).toEqual([
      [1, "approved", 5, "kg"],
      [2, "in_review", 1, "l"],
    ]);
    // the approved version and its lines are exactly as they were
    const approvedOnly = JSON.stringify([
      store.component_recipe_versions[0],
      store.component_recipe_version_inputs[0],
    ]);
    expect(before).toContain(
      JSON.stringify(store.component_recipe_versions[0])
    );
    expect(approvedOnly).toContain('"quantity":9');
    expect(store.component_recipe_version_inputs).toHaveLength(3);
  });

  it("is idempotent: a second Confirmar returns the same version and creates nothing", async () => {
    const first = await (await confirm(prepBody())).json();
    const res = await confirm(prepBody());
    expect(res.status).toBe(200);
    const again = await res.json();
    expect(again).toMatchObject({
      ok: true,
      kind: "preparacion",
      component_id: first.component_id,
      version_id: first.version_id,
      status: "in_review",
    });
    expect(store.prepared_components).toHaveLength(1);
    expect(store.component_recipe_versions).toHaveLength(1);
    expect(store.component_recipe_version_inputs).toHaveLength(2);
  });

  it("a failure mid-way removes only what this call created and leaves the draft claimable", async () => {
    failRule = (table, mode) =>
      table === "component_recipe_version_inputs" && mode === "insert";
    const res = await confirm(prepBody());
    expect(res.status).toBe(500);
    expect(store.prepared_components).toHaveLength(0);
    expect(store.component_recipes).toHaveLength(0);
    expect(store.component_recipe_versions).toHaveLength(0);
    expect(store.component_recipe_version_inputs).toHaveLength(0);
    expect(draftRow().status).toBe("draft");
    expect(draftRow().confirmed_by ?? null).toBeNull();
    failRule = null;
    expect((await confirm(prepBody())).status).toBe(200);
    expect(store.component_recipe_versions).toHaveLength(1);
  });

  it("a failure on an existing preparation keeps it and its approved version", async () => {
    store.prepared_components.push({
      id: "pc-1",
      company_id: COMPANY,
      name: "Salsa Roja",
      output_unit: "kg",
    });
    store.component_recipes.push({
      id: "cr-1",
      company_id: COMPANY,
      component_id: "pc-1",
      name: "Salsa Roja",
    });
    store.component_recipe_versions.push({
      id: "crv-1",
      company_id: COMPANY,
      component_recipe_id: "cr-1",
      component_id: "pc-1",
      version_number: 1,
      status: "approved",
    });
    failRule = (table, mode) =>
      table === "component_recipe_version_inputs" && mode === "insert";
    expect((await confirm(prepBody())).status).toBe(500);
    expect(store.prepared_components).toHaveLength(1);
    expect(store.component_recipes).toHaveLength(1);
    expect(store.component_recipe_versions.map((v) => v.id)).toEqual(["crv-1"]);
    expect(draftRow().status).toBe("draft");
  });

  it("a stale claim (old, no result) is taken over; a young one answers 409", async () => {
    Object.assign(draftRow(), {
      status: "confirmed",
      confirmed_by: "user-1",
      confirmed_at: new Date().toISOString(),
    });
    expect((await confirm(prepBody())).status).toBe(409);
    draftRow().confirmed_at = new Date(
      Date.now() - 10 * 60 * 1000
    ).toISOString();
    expect((await confirm(prepBody())).status).toBe(200);
    expect(store.component_recipe_versions).toHaveLength(1);
  });
});

describe("validation", () => {
  it.each([
    ["zero", 0],
    ["negative", -2],
    ["NaN", Number.NaN],
    ["text", "mucho"],
    ["missing", undefined],
  ])("a yield of %s is a 400 in Spanish and writes nothing", async (_n, q) => {
    const res = await confirm(prepBody({ yield_quantity: q }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rinde/i);
    expect(store.prepared_components).toHaveLength(0);
    expect(draftRow().status).toBe("draft");
  });

  it("an unknown yield unit is a 400", async () => {
    const res = await confirm(prepBody({ yield_unit: "cucharadas" }));
    expect(res.status).toBe(400);
    expect(store.prepared_components).toHaveLength(0);
  });

  it("a marked draft without kind:'preparacion' is refused", async () => {
    const res = await confirm({ ...prepBody(), kind: undefined, portions: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Indica cuánto rinde esta preparación."
    );
    expect(store.prepared_components).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
  });

  it("kind:'preparacion' for a plato draft is refused", async () => {
    draftRow().dish_name = "Hamburguesa";
    const res = await confirm(prepBody());
    expect(res.status).toBe(400);
    expect(store.prepared_components).toHaveLength(0);
  });

  it("lines are validated like for platos (archived, quantity, unit)", async () => {
    store.ingredients[0].archived_at = "2026-10-01";
    expect((await confirm(prepBody())).status).toBe(400);
    store.ingredients[0].archived_at = null;
    const noQty = prepBody({
      lines: [{ ingredient_id: BACON, total_quantity: 0, unit: "kg" }],
    });
    expect((await confirm(noQty)).status).toBe(400);
    const badUnit = prepBody({
      lines: [{ ingredient_id: BACON, total_quantity: 1, unit: "xyz" }],
    });
    expect((await confirm(badUnit)).status).toBe(400);
    expect(store.prepared_components).toHaveLength(0);
  });

  it("another company's draft is a 404; a member gets 403", async () => {
    draftRow().company_id = "company-2";
    expect((await confirm(prepBody())).status).toBe(404);
    draftRow().company_id = COMPANY;
    loadMembershipRole.mockResolvedValue("member");
    expect((await confirm(prepBody())).status).toBe(403);
    expect(store.prepared_components).toHaveLength(0);
  });
});
