import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;

const { store, rpc } = vi.hoisted(() => {
  const store: Record<string, Row[]> = {
    kitchen_recipe_drafts: [],
    kitchen_recipe_draft_lines: [],
    menu_items: [],
    ingredients: [],
    ingredient_cost_entries: [],
    recipes: [],
    recipe_versions: [],
    recipe_version_inputs: [],
  };
  const rpc = vi.fn();
  return { store, rpc };
});

const authAndCompany = vi.fn();
const isUserAdminServer = vi.fn();
const loadMembershipRole = vi.fn();

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...args: unknown[]) => authAndCompany(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...makeFakeDb(store),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: (...args: unknown[]) => isUserAdminServer(...args),
}));

// The role is read through resolveActor (loadCompanyRole + the admin client in
// production); here the tests decide the role and the Milton-staff flag.
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    resolveActor: async (
      _supabase: unknown,
      userId: string,
      opts?: { companyId?: string | null }
    ) => ({
      userId,
      companyId: opts?.companyId ?? null,
      role: actual.normalizeRole(
        await loadMembershipRole(opts?.companyId, userId)
      ),
      isMiltonStaff: Boolean(await isUserAdminServer(userId)),
    }),
  };
});

import { PATCH } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/route";
import { POST } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route";

const COMPANY = "company-1";
const DRAFT_ID = "draft-1";
const KEEP_ID = "line-keep";
const REMOVE_ID = "line-remove";
const ING_KEEP = "ing-keep";
const ING_NEW = "ing-new";
const ING_REMOVE = "ing-remove";
const MENU_ID = "menu-1";

function seed() {
  store.recipes = [];
  store.recipe_versions = [];
  store.recipe_version_inputs = [];
  store.kitchen_recipe_drafts = [
    {
      id: DRAFT_ID,
      company_id: COMPANY,
      status: "draft",
      portions: 2,
      dish_name: "Pollo con arroz",
    },
  ];
  store.kitchen_recipe_draft_lines = [
    {
      id: KEEP_ID,
      draft_id: DRAFT_ID,
      company_id: COMPANY,
      line_number: 1,
      raw_name: "Pollo",
      ingredient_id: ING_KEEP,
      total_quantity: 0.5,
      unit: "kg",
      per_portion_quantity: 0.25,
    },
    {
      id: REMOVE_ID,
      draft_id: DRAFT_ID,
      company_id: COMPANY,
      line_number: 2,
      raw_name: "Sal",
      ingredient_id: ING_REMOVE,
      total_quantity: 0.01,
      unit: "kg",
      per_portion_quantity: 0.005,
    },
  ];
  store.menu_items = [{ id: MENU_ID, company_id: COMPANY }];
  store.ingredients = [
    { id: ING_KEEP, company_id: COMPANY, default_unit: "kg" },
    { id: ING_NEW, company_id: COMPANY, default_unit: "kg" },
    { id: ING_REMOVE, company_id: COMPANY, default_unit: "kg" },
  ];
  store.ingredient_cost_entries = [
    {
      company_id: COMPANY,
      ingredient_id: ING_KEEP,
      normalized_unit_cost: 80,
      normalized_unit: "kg",
      cost_date: "2026-10-01",
    },
    {
      company_id: COMPANY,
      ingredient_id: ING_NEW,
      normalized_unit_cost: 30,
      normalized_unit: "kg",
      cost_date: "2026-10-01",
    },
    {
      company_id: COMPANY,
      ingredient_id: ING_REMOVE,
      normalized_unit_cost: 5,
      normalized_unit: "kg",
      cost_date: "2026-10-01",
    },
  ];
}

describe("PATCH then confirm with returned line ids", () => {
  beforeEach(() => {
    seed();
    authAndCompany.mockResolvedValue({
      ok: true,
      companyId: COMPANY,
      userId: "user-1",
      supabase: {},
    });
    isUserAdminServer.mockResolvedValue(false);
    loadMembershipRole.mockResolvedValue("owner");
    rpc.mockReset();
  });

  it("keeps existing ids, inserts new lines, deletes missing, then confirm succeeds", async () => {
    const patchReq = new NextRequest(
      `http://localhost/api/restaurant/kitchen/recipe-drafts/${DRAFT_ID}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: "Pollo con arroz",
          portions: 2,
          menu_item_id: MENU_ID,
          lines: [
            {
              id: KEEP_ID,
              raw_name: "Pollo",
              ingredient_id: ING_KEEP,
              total_quantity: 0.6,
              unit: "kg",
            },
            {
              raw_name: "Arroz",
              ingredient_id: ING_NEW,
              total_quantity: 0.3,
              unit: "kg",
            },
          ],
        }),
      }
    );

    const patchRes = await PATCH(patchReq, {
      params: Promise.resolve({ id: DRAFT_ID }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.lines).toHaveLength(2);
    expect(patchBody.lines[0].id).toBe(KEEP_ID);
    expect(patchBody.lines[0].total_quantity).toBe(0.6);
    expect(patchBody.lines[1].id).not.toBe(REMOVE_ID);
    expect(patchBody.lines[1].ingredient_id).toBe(ING_NEW);
    expect(store.kitchen_recipe_draft_lines.map((l) => l.id).sort()).toEqual(
      [KEEP_ID, patchBody.lines[1].id].sort()
    );

    const confirmReq = new NextRequest(
      `http://localhost/api/restaurant/kitchen/recipe-drafts/${DRAFT_ID}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: "Pollo con arroz",
          portions: 2,
          menu_item_id: MENU_ID,
          selling_price: 120,
          lines: patchBody.lines.map(
            (l: {
              id: string;
              ingredient_id: string;
              total_quantity: number;
              unit: string;
            }) => ({
              id: l.id,
              ingredient_id: l.ingredient_id,
              total_quantity: l.total_quantity,
              unit: l.unit,
            })
          ),
        }),
      }
    );

    const confirmRes = await POST(confirmReq, {
      params: Promise.resolve({ id: DRAFT_ID }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.ok).toBe(true);
    expect(confirmBody.status).toBe("in_review");
    expect(confirmBody.recipe_id).toBeTruthy();
    // a NEW in_review version with the two lines; the SQL function is not used
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.recipe_versions[0].status).toBe("in_review");
    expect(store.recipe_version_inputs).toHaveLength(2);
    expect(rpc).not.toHaveBeenCalled();
  });
});
