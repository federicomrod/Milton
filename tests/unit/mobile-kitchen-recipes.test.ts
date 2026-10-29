import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "99999999-9999-4999-8999-999999999999";
const LOC_A = "22222222-2222-4222-8222-222222222222";
const LOC_B = "88888888-8888-4888-8888-888888888888";
const STAFF = "44444444-4444-4444-8444-444444444441";
const TOKEN = "device-token-for-cook-one-0000000000000000000";

// Distinctive amounts: if one shows up in a response, money leaked.
const MONEY = {
  selling_price: 7731.17,
  unit_cost: 5528.43,
  cost_source: "invoice",
  current_unit_cost: 4417.91,
  total_cost: 3306.62,
  margin: 2295.88,
};
const MONEY_VALUES = ["7731.17", "5528.43", "4417.91", "3306.62", "2295.88"];

const h = vi.hoisted(() => ({ state: { db: null as any } }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.state.db.client,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: vi.fn(),
  getCachedCompanyId: vi.fn(),
}));
vi.mock("@/lib/restaurant/supabase-sales", () => ({
  resolveCompanyIdForUser: vi.fn(),
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));

import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import { assertNoMoneyFields } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { GET } from "@/app/api/mobile/v1/kitchen/recipes/route";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ITEM = {
  tacos: id(1),
  sopa: id(2),
  pizza: id(3),
  ajeno: id(4),
  off: id(5),
  draft: id(6),
};
const V = {
  tacos1: id(11),
  tacos2: id(12),
  tacos3: id(13),
  sopa1: id(14),
  pizza1: id(15),
  ajeno1: id(16),
  draft1: id(17),
};
const ING = { tortilla: id(21), carne: id(22), caldo: id(23), masa: id(24) };
const COMP = id(31);

function seed() {
  const rows = {
    restaurant_locations: [
      { id: LOC_A, company_id: CO_A, name: "Centro", status: "active" },
      { id: LOC_B, company_id: CO_A, name: "Norte", status: "active" },
    ],
    kitchen_staff: [
      {
        id: STAFF,
        company_id: CO_A,
        location_id: LOC_A,
        display_name: "Luis",
        is_active: true,
        can_see_costs: false,
      },
    ],
    kitchen_devices: [
      {
        id: id(41),
        company_id: CO_A,
        staff_id: STAFF,
        token_hash: hashToken(TOKEN),
        revoked_at: null,
        last_seen_at: null,
      },
    ],
    menu_items: [
      {
        id: ITEM.tacos,
        company_id: CO_A,
        location_id: LOC_A,
        name: "Tacos al pastor",
        category: "Platos fuertes",
        description: "Con piña",
        status: "active",
        ...MONEY,
      },
      {
        id: ITEM.sopa,
        company_id: CO_A,
        location_id: null,
        name: "Sopa del día",
        category: "Sopas",
        description: null,
        status: "active",
        ...MONEY,
      },
      {
        id: ITEM.pizza,
        company_id: CO_A,
        location_id: LOC_B,
        name: "Pizza norte",
        category: null,
        description: null,
        status: "active",
        ...MONEY,
      },
      {
        id: ITEM.ajeno,
        company_id: CO_B,
        location_id: null,
        name: "Plato de otra empresa",
        category: null,
        description: null,
        status: "active",
        ...MONEY,
      },
      {
        id: ITEM.off,
        company_id: CO_A,
        location_id: LOC_A,
        name: "Plato apagado",
        category: null,
        description: null,
        status: "inactive",
        ...MONEY,
      },
      {
        id: ITEM.draft,
        company_id: CO_A,
        location_id: LOC_A,
        name: "Plato sin aprobar",
        category: null,
        description: null,
        status: "active",
        ...MONEY,
      },
    ],
    recipe_versions: [
      {
        id: V.tacos1,
        company_id: CO_A,
        menu_item_id: ITEM.tacos,
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: 1,
        serving_unit: "porción",
        notes: "VIEJA",
        ...MONEY,
      },
      {
        id: V.tacos2,
        company_id: CO_A,
        menu_item_id: ITEM.tacos,
        version_number: 2,
        status: "approved",
        effective_date: null,
        serving_quantity: 4,
        serving_unit: "porciones",
        notes: "Marinar la carne.\n\nAsar 8 minutos.\n  Servir con piña.  ",
        ...MONEY,
      },
      {
        id: V.tacos3,
        company_id: CO_A,
        menu_item_id: ITEM.tacos,
        version_number: 3,
        status: "in_review",
        effective_date: null,
        serving_quantity: 9,
        serving_unit: "x",
        notes: "EN REVISION",
        ...MONEY,
      },
      {
        id: V.sopa1,
        company_id: CO_A,
        menu_item_id: ITEM.sopa,
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: null,
        serving_unit: null,
        notes: null,
      },
      {
        id: V.pizza1,
        company_id: CO_A,
        menu_item_id: ITEM.pizza,
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: null,
        serving_unit: null,
        notes: null,
      },
      {
        id: V.ajeno1,
        company_id: CO_B,
        menu_item_id: ITEM.ajeno,
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: null,
        serving_unit: null,
        notes: null,
      },
      {
        id: V.draft1,
        company_id: CO_A,
        menu_item_id: ITEM.draft,
        version_number: 1,
        status: "in_review",
        effective_date: null,
        serving_quantity: null,
        serving_unit: null,
        notes: "NO",
      },
    ],
    recipe_version_inputs: [
      {
        id: id(51),
        company_id: CO_A,
        recipe_version_id: V.tacos1,
        input_type: "ingredient",
        ingredient_id: ING.tortilla,
        component_id: null,
        quantity: 99,
        unit: "pza",
        notes: null,
        ...MONEY,
      },
      {
        id: id(52),
        company_id: CO_A,
        recipe_version_id: V.tacos2,
        input_type: "ingredient",
        ingredient_id: ING.tortilla,
        component_id: null,
        quantity: 12,
        unit: "pza",
        notes: null,
        ...MONEY,
      },
      {
        id: id(53),
        company_id: CO_A,
        recipe_version_id: V.tacos2,
        input_type: "ingredient",
        ingredient_id: ING.carne,
        component_id: null,
        quantity: 0.5,
        unit: "kg",
        notes: "cortada fina",
        ...MONEY,
      },
      {
        id: id(54),
        company_id: CO_A,
        recipe_version_id: V.tacos2,
        input_type: "component",
        ingredient_id: null,
        component_id: COMP,
        quantity: 200,
        unit: "ml",
        notes: null,
        ...MONEY,
      },
      {
        id: id(55),
        company_id: CO_A,
        recipe_version_id: V.sopa1,
        input_type: "ingredient",
        ingredient_id: ING.caldo,
        component_id: null,
        quantity: 1,
        unit: "l",
        notes: null,
      },
    ],
    ingredients: [
      {
        id: ING.tortilla,
        company_id: CO_A,
        name: "Tortilla de maíz",
        ...MONEY,
      },
      { id: ING.carne, company_id: CO_A, name: "Carne de cerdo", ...MONEY },
      { id: ING.caldo, company_id: CO_A, name: "Caldo", ...MONEY },
    ],
    prepared_components: [
      { id: COMP, company_id: CO_A, name: "Salsa roja", ...MONEY },
    ],
  };
  return createFakeDb(rows);
}

const get = (qs = "", token: string | null = TOKEN) =>
  GET(
    new NextRequest(`http://localhost/api/mobile/v1/kitchen/recipes${qs}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

beforeEach(() => {
  h.state.db = seed();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GET kitchen/recipes", () => {
  it("returns only this location's (and company-wide) approved recipes of this company", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.recipes.map((r: any) => r.name)).toEqual([
      "Sopa del día",
      "Tacos al pastor",
    ]);
    const text = JSON.stringify(body);
    for (const gone of [
      "Pizza norte",
      "Plato de otra empresa",
      "Plato apagado",
      "Plato sin aprobar",
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(body.nextCursor).toBeNull();
  });

  it("uses the approved version in force: highest approved, never one in review", async () => {
    const body = await (await get()).json();
    const tacos = body.recipes.find((r: any) => r.name === "Tacos al pastor");
    expect(tacos).toEqual({
      id: ITEM.tacos,
      name: "Tacos al pastor",
      category: "Platos fuertes",
      description: "Con piña",
      yield: { quantity: 4, unit: "porciones" },
      ingredients: [
        { name: "Tortilla de maíz", quantity: 12, unit: "pza", note: null },
        {
          name: "Carne de cerdo",
          quantity: 0.5,
          unit: "kg",
          note: "cortada fina",
        },
        { name: "Salsa roja", quantity: 200, unit: "ml", note: null },
      ],
      steps: ["Marinar la carne.", "Asar 8 minutos.", "Servir con piña."],
    });
    expect(JSON.stringify(body)).not.toMatch(/VIEJA|EN REVISION/);
  });

  it("never carries money: no price, cost or margin key or value, whatever the source rows hold", async () => {
    const raw = await (await get()).text();
    expect(() => assertNoMoneyFields(JSON.parse(raw))).not.toThrow();
    for (const v of MONEY_VALUES) expect(raw).not.toContain(v);
    for (const key of Object.keys(MONEY)) expect(raw).not.toContain(`"${key}"`);
    expect(raw).not.toMatch(/invoice/);
  });

  it("is read only: nothing is written to any table", async () => {
    await get();
    await get("?q=taco");
    // The only write is the device's «last seen» heartbeat from auth.
    const writes = h.state.db.writes as { table: string; op: string }[];
    expect(
      writes.filter(
        (w: { table: string; op: string }) =>
          !(w.table === "kitchen_devices" && w.op === "update")
      )
    ).toEqual([]);
    for (const t of [
      "menu_items",
      "recipe_versions",
      "recipe_version_inputs",
      "ingredients",
      "prepared_components",
    ]) {
      expect(writes.map((w) => w.table)).not.toContain(t);
    }
  });

  it("searches by name", async () => {
    const body = await (await get("?q=TACO")).json();
    expect(body.recipes.map((r: any) => r.name)).toEqual(["Tacos al pastor"]);
    // Characters that would change a filter are neutralised.
    expect((await get("?q=%25,or=(id.not.is.null)")).status).toBe(200);
  });

  it("pages with a cursor", async () => {
    const rows = h.state.db.tables;
    for (let i = 0; i < 40; i++) {
      const itemId = id(1000 + i);
      const versionId = id(2000 + i);
      rows.menu_items.push({
        id: itemId,
        company_id: CO_A,
        location_id: LOC_A,
        name: `Plato ${String(i).padStart(2, "0")}`,
        category: null,
        description: null,
        status: "active",
      });
      rows.recipe_versions.push({
        id: versionId,
        company_id: CO_A,
        menu_item_id: itemId,
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: null,
        serving_unit: null,
        notes: null,
      });
    }
    const first = await (await get()).json();
    expect(first.recipes.length).toBeGreaterThan(0);
    expect(first.nextCursor).toBeTruthy();
    const second = await (await get(`?cursor=${first.nextCursor}`)).json();
    const names = [...first.recipes, ...second.recipes].map((r: any) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(second.recipes.length).toBeGreaterThan(0);
    expect((await get("?cursor=%%%")).status).toBe(400);
    expect((await get("?cursor=AAAA")).status).toBe(400);
  });

  it("a revoked or missing device is 401", async () => {
    h.state.db.tables.kitchen_devices[0].revoked_at = new Date().toISOString();
    expect((await get()).status).toBe(401);
    expect((await get("", null)).status).toBe(401);
  });
});
