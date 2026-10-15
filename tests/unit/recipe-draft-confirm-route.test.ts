import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authAndCompany = vi.fn();
const isUserAdminServer = vi.fn();
const loadMembershipRole = vi.fn();
const rpc = vi.fn();

type Row = Record<string, unknown>;

let drafts: Row[] = [];
let menuItems: Row[] = [];
let ingredients: Row[] = [];
let draftLines: Row[] = [];
let costEntries: Row[] = [];

function makeChain(table: string) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  const self = chain as {
    select: () => typeof self;
    eq: (col: string, val: unknown) => typeof self;
    in: (col: string, vals: unknown[]) => typeof self;
    order: () => typeof self;
    update: () => typeof self;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    single: () => Promise<{ data: Row | null; error: null }>;
    then: (
      resolve: (v: { data: Row[] | null; error: null }) => unknown,
      reject: (e: unknown) => unknown
    ) => Promise<unknown>;
  };

  self.select = () => self;
  self.eq = (col, val) => {
    filters[col] = val;
    return self;
  };
  self.in = (col, vals) => {
    filters[col] = vals;
    return self;
  };
  self.order = () => self;
  self.update = () => self;
  self.maybeSingle = async () => {
    if (table === "kitchen_recipe_drafts") {
      const found = drafts.find((d) => d.id === filters.id) ?? null;
      return { data: found, error: null };
    }
    if (table === "menu_items") {
      const found =
        menuItems.find(
          (m) => m.id === filters.id && m.company_id === filters.company_id
        ) ?? null;
      return { data: found, error: null };
    }
    return { data: null, error: null };
  };
  self.single = self.maybeSingle;
  self.then = (resolve, reject) => {
    let data: Row[] = [];
    if (table === "kitchen_recipe_draft_lines") {
      data = draftLines.filter((l) => l.draft_id === filters.draft_id);
    } else if (table === "ingredients") {
      data = ingredients.filter((i) => i.company_id === filters.company_id);
    } else if (table === "ingredient_cost_entries") {
      data = costEntries.filter((c) => c.company_id === filters.company_id);
    }
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };
  return self;
}

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
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: (...args: unknown[]) => isUserAdminServer(...args),
}));

vi.mock("@/lib/restaurant/telegram/kitchen-join", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-join")
    >();
  return {
    ...actual,
    loadMembershipRole: (...args: unknown[]) => loadMembershipRole(...args),
  };
});

import { POST } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route";

const COMPANY = "company-1";
const OTHER = "company-2";
const DRAFT_ID = "draft-1";
const LINE_ID = "line-1";
const ING_ID = "ing-1";
const MENU_ID = "menu-1";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    dish_name: "Pollo con arroz",
    portions: 2,
    menu_item_id: MENU_ID,
    selling_price: 120,
    lines: [
      {
        id: LINE_ID,
        ingredient_id: ING_ID,
        total_quantity: 0.5,
        unit: "kg",
      },
    ],
    ...overrides,
  };
}

async function callConfirm(body: unknown, id = DRAFT_ID) {
  const req = new NextRequest(
    `http://localhost/api/restaurant/kitchen/recipe-drafts/${id}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("POST /recipe-drafts/:id/confirm", () => {
  beforeEach(() => {
    authAndCompany.mockResolvedValue({
      ok: true,
      companyId: COMPANY,
      userId: "user-1",
      supabase: {},
    });
    isUserAdminServer.mockResolvedValue(false);
    loadMembershipRole.mockResolvedValue("owner");
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [{ out_recipe_id: "recipe-1", out_menu_item_id: MENU_ID }],
      error: null,
    });
    drafts = [
      {
        id: DRAFT_ID,
        company_id: COMPANY,
        status: "draft",
        portions: 2,
      },
    ];
    menuItems = [{ id: MENU_ID, company_id: COMPANY }];
    ingredients = [{ id: ING_ID, company_id: COMPANY, default_unit: "kg" }];
    draftLines = [{ id: LINE_ID, draft_id: DRAFT_ID, ingredient_id: ING_ID }];
    costEntries = [
      {
        company_id: COMPANY,
        ingredient_id: ING_ID,
        normalized_unit_cost: 80,
        normalized_unit: "kg",
        cost_date: "2026-10-01",
      },
    ];
  });

  it("returns 403 for a member", async () => {
    loadMembershipRole.mockResolvedValue("member");
    const res = await callConfirm(validBody());
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 403 for another company's draft", async () => {
    drafts[0].company_id = OTHER;
    const res = await callConfirm(validBody());
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects another company's menu item", async () => {
    menuItems = [{ id: MENU_ID, company_id: OTHER }];
    const res = await callConfirm(validBody());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/menu item/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is idempotent on double confirm", async () => {
    drafts[0] = {
      id: DRAFT_ID,
      company_id: COMPANY,
      status: "confirmed",
      portions: 2,
      confirmed_recipe_id: "recipe-1",
      menu_item_id: MENU_ID,
    };
    const res = await callConfirm(validBody());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.recipe_id).toBe("recipe-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects empty lines", async () => {
    const res = await callConfirm(validBody({ lines: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ingredient line/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts newly added lines with a new- id", async () => {
    draftLines = [];
    const res = await callConfirm(
      validBody({
        lines: [
          {
            id: "new-1",
            ingredient_id: ING_ID,
            total_quantity: 0.5,
            unit: "kg",
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("accepts newly added lines with no id", async () => {
    draftLines = [];
    const res = await callConfirm(
      validBody({
        lines: [
          {
            ingredient_id: ING_ID,
            total_quantity: 0.5,
            unit: "kg",
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });
});
