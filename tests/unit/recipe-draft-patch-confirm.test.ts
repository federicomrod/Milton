import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const { store, rpc } = vi.hoisted(() => {
  const store: Record<string, Row[]> = {
    kitchen_recipe_drafts: [],
    kitchen_recipe_draft_lines: [],
    menu_items: [],
    ingredients: [],
    ingredient_cost_entries: [],
  };
  const rpc = vi.fn();
  return { store, rpc };
});

let nextGeneratedId = 1;

function matches(
  row: Row,
  ops: { type: "eq" | "in"; col: string; val: unknown }[]
) {
  return ops.every((op) => {
    if (op.type === "eq") return row[op.col] === op.val;
    return Array.isArray(op.val) && op.val.includes(row[op.col]);
  });
}

function makeFrom(table: string) {
  const ops: { type: "eq" | "in"; col: string; val: unknown }[] = [];
  let mode: "select" | "update" | "insert" | "delete" = "select";
  let payload: unknown = null;
  let orderCol: string | null = null;

  const rows = () => store[table] ?? [];

  const run = () => {
    if (mode === "update") {
      const patch = payload as Row;
      const matched = rows().filter((row) => matches(row, ops));
      for (const row of matched) Object.assign(row, patch);
      return {
        data: matched.map((r) => ({ ...r })),
        error: null,
      };
    }
    if (mode === "insert") {
      const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const inserted = incoming.map((r) => {
        const row = { ...r, id: r.id ?? `gen-${nextGeneratedId++}` };
        rows().push(row);
        return { ...row };
      });
      return { data: inserted, error: null };
    }
    if (mode === "delete") {
      const matched = rows().filter((row) => matches(row, ops));
      const ids = new Set(matched.map((r) => r.id));
      store[table] = rows().filter((r) => !ids.has(r.id));
      return { data: matched.map((r) => ({ ...r })), error: null };
    }
    let data = rows()
      .filter((row) => matches(row, ops))
      .map((r) => ({ ...r }));
    if (orderCol) {
      const col = orderCol;
      data.sort((a, b) => Number(a[col] ?? 0) - Number(b[col] ?? 0));
    }
    return { data, error: null };
  };

  const chain: Record<string, unknown> = {};
  const self = chain as {
    select: () => typeof self;
    eq: (col: string, val: unknown) => typeof self;
    in: (col: string, val: unknown[]) => typeof self;
    order: (col: string) => typeof self;
    update: (data: Row) => typeof self;
    insert: (data: Row | Row[]) => typeof self;
    delete: () => typeof self;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    single: () => Promise<{ data: Row | null; error: null }>;
    then: (
      resolve: (v: { data: Row[]; error: null }) => unknown,
      reject: (e: unknown) => unknown
    ) => Promise<unknown>;
  };
  self.select = () => self;
  self.eq = (col, val) => {
    ops.push({ type: "eq", col, val });
    return self;
  };
  self.in = (col, val) => {
    ops.push({ type: "in", col, val });
    return self;
  };
  self.order = (col) => {
    orderCol = col;
    return self;
  };
  self.update = (data) => {
    mode = "update";
    payload = data;
    return self;
  };
  self.insert = (data) => {
    mode = "insert";
    payload = data;
    return self;
  };
  self.delete = () => {
    mode = "delete";
    return self;
  };
  self.maybeSingle = async () => {
    const { data, error } = run();
    return { data: data[0] ?? null, error };
  };
  self.single = self.maybeSingle;
  self.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
  return self;
}

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
    from: (table: string) => makeFrom(table),
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
  nextGeneratedId = 1;
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
    rpc.mockResolvedValue({
      data: [{ out_recipe_id: "recipe-1", out_menu_item_id: MENU_ID }],
      error: null,
    });
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
    expect(confirmBody.recipe_id).toBe("recipe-1");
    expect(rpc).toHaveBeenCalledOnce();
  });
});
