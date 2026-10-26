// «Estimar con Milton» (issue #212): the estimate and «usar» routes. The AI
// (the openai module) and the database (fake-db) are mocked: no network.
// Synthetic names and prices only.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  menuDraftEvidence,
  menuDraftLines,
} from "@/lib/restaurant/menu-reading/drafts";
import { FLAG_MILTON_ESTIMATE } from "@/lib/restaurant/recipe-costing/editor";
import { makeFakeDb, type FakeStore, type Row } from "./helpers/fake-db";

const world = vi.hoisted(() => ({
  role: "owner" as string | null,
  staff: false,
  db: null as unknown,
  sales: new Map<number, { net_sales: number; units_sold: number }>(),
  /** Answers one chat completion; may throw. */
  ai: null as unknown as (params: {
    messages: Array<{ role: string; content: unknown }>;
  }) => unknown,
  calls: [] as Array<{ dish: string; hasImage: boolean; detail?: string }>,
}));

vi.mock("@/lib/supabase/admin", () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: world.role === null ? null : { role: world.role },
      error: null,
    }),
  };
  return { createAdminClient: () => chain };
});
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => world.staff,
}));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: world.db,
    companyId: "co-1",
    userId: "u-1",
  }),
}));
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/pos-product-list-server", () => ({
  loadPosProductList: async () => ({
    ok: true,
    links: [],
    list: {
      products: [...world.sales.entries()].map(([id, s]) => ({
        odoo_product_id: id,
        ...s,
      })),
    },
  }),
}));
vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content: unknown }>;
        }) => world.ai(params),
      },
    };
  }
  return { OpenAI, default: { OpenAI } };
});

import { GET, POST } from "@/app/api/restaurant/recipes/menu/estimate/route";
import { POST as USE } from "@/app/api/restaurant/recipes/menu/estimate/use/route";
import { dishEstimateFromRow } from "@/lib/restaurant/menu-reading/estimate-store";

const CO = "co-1";

function req(path: string, body?: unknown, method = "POST") {
  return new NextRequest(
    `http://localhost/api/restaurant/recipes/menu/${path}`,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "Content-Type": "application/json" },
    }
  );
}

/** What the AI sees: the dish name, and whether a photo came along. */
function inspect(params: {
  messages: Array<{ role: string; content: unknown }>;
}) {
  const user = params.messages[1].content;
  const parts = Array.isArray(user) ? user : [{ type: "text", text: user }];
  const text = String(
    (parts.find((p: { type: string }) => p.type === "text") as { text: string })
      .text
  );
  const image = parts.find((p: { type: string }) => p.type === "image_url") as
    | { image_url: { url: string; detail: string } }
    | undefined;
  return {
    dish: /Plato: (.*)/.exec(text)?.[1] ?? "",
    image: image?.image_url,
  };
}

function answer(lines: unknown[], note = "Una porción") {
  return {
    choices: [
      { message: { content: JSON.stringify({ lines, portion_note: note }) } },
    ],
  };
}

const POLLO = {
  raw_name: "pollo",
  qty: 200,
  unit: "g",
  price_per_unit: 0.01,
  price_unit: "g",
  confidence: "alta",
};
const SALSA = {
  raw_name: "salsa",
  qty: 2,
  unit: "unidad",
  price_per_unit: 0.5,
  price_unit: "unidad",
  confidence: "media",
};

interface DishOpts {
  /** Recipe lines on these versions (by index): a version with lines is a recipe. */
  lines_on?: number[];
  link_state?: string;
  source?: string | null;
  versions?: string[];
  components?: string[];
  menu_source_id?: string | null;
  evidence?: Row;
}

/** A menu draft: link + empty in-review version, as «Leer menú» leaves it. */
function addDish(store: FakeStore, n: number, opts: DishOpts = {}) {
  const components = opts.components ?? ["pollo", "salsa"];
  const lines = menuDraftLines(components, {
    ingredients: [],
    preparations: [],
  });
  const evidence =
    opts.evidence ??
    (menuDraftEvidence({
      match: {
        dish: {
          name: `Plato ${n}`,
          section: "Platos fuertes",
          price: 9.5,
          description: "Con salsa",
          variants: [],
          components,
        },
        variant: null,
        basis: "name",
      } as never,
      lines,
      menuSourceId: opts.menu_source_id ?? null,
      menuUrl: null,
    }) as Row);
  if (opts.source === null) delete evidence.source;
  (store.pos_product_links ??= []).push({
    id: `l${n}`,
    company_id: CO,
    odoo_product_id: 100 + n,
    odoo_name: `Plato ${n}`,
    location_id: null,
    menu_item_id: `m${n}`,
    link_state: opts.link_state ?? "sugerido",
    evidence,
  });
  (store.recipe_versions ??= []).push(
    ...(opts.versions ?? ["in_review"]).map((status, i) => ({
      id: `v${n}-${i}`,
      company_id: CO,
      menu_item_id: `m${n}`,
      status,
    }))
  );
  for (const i of opts.lines_on ?? []) giveLines(store, n, i);
  world.sales.set(100 + n, { net_sales: 1000 - n, units_sold: 100 });
}

/** A recipe line on version `v<n>-<i>`: what makes a version a real recipe. */
function giveLines(store: FakeStore, n: number, i = 0) {
  (store.recipe_version_inputs ??= []).push({
    id: `in-${n}-${i}`,
    company_id: CO,
    recipe_version_id: `v${n}-${i}`,
    input_type: "ingredient",
    ingredient_id: "i-pollo",
    quantity: 1,
    unit: "g",
  });
}

function baseStore(): FakeStore {
  return {
    pos_product_links: [],
    recipe_versions: [],
    recipe_version_inputs: [],
    ingredients: [
      { id: "i-pollo", company_id: CO, name: "Pollo", default_unit: "g" },
    ],
    recipes: [],
    menu_items: [],
    ingredient_cost_entries: [],
    ingredient_unit_conversions: [],
    ingredient_aliases: [],
    restaurant_locations: [{ id: "loc-1", company_id: CO, country: "SV" }],
    restaurant_menu_sources: [],
    restaurant_dish_estimates: [],
    ingredient_price_estimates: [],
  };
}

function snapshot(store: FakeStore, ...tables: string[]) {
  return JSON.stringify(tables.map((t) => store[t] ?? []));
}

let store: FakeStore;

function setDb(options?: Parameters<typeof makeFakeDb>[1]) {
  world.db = makeFakeDb(store, options);
}

beforeEach(() => {
  world.role = "owner";
  world.staff = false;
  world.sales = new Map();
  world.calls = [];
  world.ai = (params) => {
    const { dish, image } = inspect(params);
    world.calls.push({
      dish,
      hasImage: Boolean(image),
      detail: image?.detail,
    });
    return answer([POLLO, SALSA]);
  };
  store = baseStore();
  setDb();
});

describe("who may estimate (recipes.edit)", () => {
  for (const role of ["owner", "admin", "manager"]) {
    it(`${role} may`, async () => {
      world.role = role;
      addDish(store, 1);
      const res = await POST(req("estimate", {}));
      expect(res.status).toBe(200);
      expect((await GET()).status).toBe(200);
    });
  }
  it("Milton staff may", async () => {
    world.role = null;
    world.staff = true;
    const res = await POST(req("estimate", {}));
    expect(res.status).toBe(200);
    const use = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(use.status).not.toBe(403);
  });
  for (const role of ["member", "viewer"]) {
    it(`${role} gets a Spanish 403 before the body is read`, async () => {
      world.role = role;
      addDish(store, 1);
      const bad = new NextRequest(
        "http://localhost/api/restaurant/recipes/menu/estimate",
        { method: "POST", body: "{no json" }
      );
      for (const res of [
        await POST(bad),
        await GET(),
        await USE(req("estimate/use", { menu_item_id: "m1" })),
      ]) {
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe(
          "Tu rol no puede preparar recetas."
        );
      }
      expect(world.calls).toHaveLength(0);
      expect(store.restaurant_dish_estimates).toHaveLength(0);
    });
  }
});

describe("chunks", () => {
  it("processes at most 5 dishes per call, highest sales first", async () => {
    for (let n = 1; n <= 8; n++) addDish(store, n);
    const res = await POST(req("estimate", {}));
    const body = await res.json();
    expect(body.results).toHaveLength(5);
    expect(body.done).toBe(5);
    expect(body.remaining).toBe(3);
    expect(body.results.map((r: { name: string }) => r.name)).toEqual([
      "Plato 1",
      "Plato 2",
      "Plato 3",
      "Plato 4",
      "Plato 5",
    ]);
    // Without ids, the next call does not pick the same dishes again.
    const next = await (await POST(req("estimate", {}))).json();
    expect(next.results.map((r: { name: string }) => r.name)).toEqual([
      "Plato 6",
      "Plato 7",
      "Plato 8",
    ]);
    expect(next.remaining).toBe(0);
  });

  it("never runs more than 3 AI calls at once", async () => {
    for (let n = 1; n <= 5; n++) addDish(store, n);
    let running = 0;
    let peak = 0;
    world.ai = async (params) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      void params;
      return answer([POLLO]);
    };
    await POST(req("estimate", {}));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("caps a run at 20 dishes, whatever limit is asked", async () => {
    for (let n = 1; n <= 30; n++) addDish(store, n);
    const body = await (await POST(req("estimate", { limit: 500 }))).json();
    expect(body.results).toHaveLength(5);
    expect(body.remaining).toBe(15); // 20 − 5
    const small = await (
      await POST(req("estimate", { menu_item_ids: ["m10", "m11"], limit: 1 }))
    ).json();
    expect(small.results).toHaveLength(1);
    expect(small.remaining).toBe(0);
  });

  it("explicit ids are estimated again (the estimate is replaced)", async () => {
    addDish(store, 1);
    await POST(req("estimate", { menu_item_ids: ["m1"] }));
    world.ai = () => answer([{ ...POLLO, qty: 300 }]);
    await POST(req("estimate", { menu_item_ids: ["m1"] }));
    expect(store.restaurant_dish_estimates).toHaveLength(1);
    const row = dishEstimateFromRow(store.restaurant_dish_estimates[0])!;
    expect(row.lines[0].qty).toBe(300);
  });

  it("one dish failing never stops the others", async () => {
    for (let n = 1; n <= 4; n++) addDish(store, n);
    world.ai = (params) => {
      const { dish } = inspect(params);
      if (dish === "Plato 2") throw new Error("boom");
      if (dish === "Plato 3")
        return { choices: [{ message: { content: "no json" } }] };
      return answer([POLLO, SALSA]);
    };
    const body = await (await POST(req("estimate", {}))).json();
    const by = Object.fromEntries(
      body.results.map((r: { name: string; skipped_reason: string | null }) => [
        r.name,
        r.skipped_reason,
      ])
    );
    expect(by).toEqual({
      "Plato 1": null,
      "Plato 2": "error_ia",
      "Plato 3": "error_ia",
      "Plato 4": null,
    });
    expect(body.done).toBe(2);
    expect(store.restaurant_dish_estimates).toHaveLength(2);
  });
});

describe("the photo", () => {
  function withPhoto() {
    store.restaurant_menu_sources.push({
      id: "src-1",
      company_id: CO,
      dishes: [
        {
          name: "Plato 1",
          section: null,
          price: 9.5,
          description: null,
          variants: [],
          components: ["pollo"],
          image_url: "https://menu.example/plato1.jpg",
        },
      ],
    });
    addDish(store, 1, { menu_source_id: "src-1" });
    store.pos_product_links[0].evidence = {
      ...(store.pos_product_links[0].evidence as Row),
      menu_dish: "Plato 1",
    };
  }

  it("sends the photo as a low-detail image part", async () => {
    withPhoto();
    await POST(req("estimate", {}));
    expect(world.calls).toEqual([
      { dish: "Plato 1", hasImage: true, detail: "low" },
    ]);
  });

  it("retries ONCE without the photo when the AI cannot fetch it", async () => {
    withPhoto();
    world.ai = (params) => {
      const { dish, image } = inspect(params);
      world.calls.push({ dish, hasImage: Boolean(image) });
      if (image) throw new Error("Error while downloading image");
      return answer([POLLO]);
    };
    const body = await (await POST(req("estimate", {}))).json();
    expect(world.calls.map((c) => c.hasImage)).toEqual([true, false]);
    expect(body.results[0].skipped_reason).toBeNull();
  });

  it("does not retry more than once", async () => {
    withPhoto();
    world.ai = (params) => {
      const { dish, image } = inspect(params);
      world.calls.push({ dish, hasImage: Boolean(image) });
      throw new Error("down");
    };
    const body = await (await POST(req("estimate", {}))).json();
    expect(world.calls).toHaveLength(2);
    expect(body.results[0].skipped_reason).toBe("error_ia");
  });

  it("a dish with no photo is asked once, without an image", async () => {
    addDish(store, 1);
    await POST(req("estimate", {}));
    expect(world.calls).toEqual([
      { dish: "Plato 1", hasImage: false, detail: undefined },
    ]);
  });
});

describe("prices: a real price always wins", () => {
  beforeEach(() => {
    store.ingredient_cost_entries.push({
      id: "e1",
      company_id: CO,
      ingredient_id: "i-pollo",
      source_type: "invoice_line",
      cost_date: "2026-09-01",
      effective_date: "2026-09-01",
      unit: "g",
      unit_cost: 0.005,
      normalized_unit: "g",
      normalized_unit_cost: 0.005,
      created_at: "2026-09-01T00:00:00Z",
    });
  });

  it("uses the real price and writes no estimated price for that ingredient", async () => {
    addDish(store, 1);
    await POST(req("estimate", {}));
    const prices = store.ingredient_price_estimates;
    expect(prices.map((p) => p.name_key)).toEqual(["salsa"]);
    const row = dishEstimateFromRow(store.restaurant_dish_estimates[0])!;
    const pollo = row.lines.find((l) => l.raw_name === "pollo")!;
    expect(pollo).toMatchObject({
      ingredient_id: "i-pollo",
      price_source: "real",
      unit_price: 0.005,
    });
    expect(pollo.line_cost).toBeCloseTo(1, 10);
    const salsa = row.lines.find((l) => l.raw_name === "salsa")!;
    expect(salsa.price_source).toBe("estimado");
    expect(salsa.price_estimate_id).toBe(prices[0].id);
    expect(row.est_cost).toBeCloseTo(2, 10);
  });

  it("writes nothing but the two estimate tables", async () => {
    for (let n = 1; n <= 3; n++) addDish(store, n);
    const guarded = [
      "ingredient_cost_entries",
      "recipe_versions",
      "pos_product_links",
      "ingredients",
      "recipe_version_inputs",
    ];
    const before = snapshot(store, ...guarded);
    const writes: string[] = [];
    setDb({
      fail: (table, mode) => {
        if (mode !== "select") writes.push(`${mode}:${table}`);
        return false;
      },
    });
    await POST(req("estimate", {}));
    expect(snapshot(store, ...guarded)).toBe(before);
    expect([...new Set(writes)].sort()).toEqual([
      "insert:ingredient_price_estimates",
      "insert:restaurant_dish_estimates",
    ]);
  });

  it("estimates are never matched as a price for the same name twice", async () => {
    addDish(store, 1);
    addDish(store, 2);
    world.ai = () => answer([SALSA]);
    await POST(req("estimate", {}));
    expect(store.ingredient_price_estimates).toHaveLength(1);
    expect(store.restaurant_dish_estimates).toHaveLength(2);
  });
});

describe("Sin precio is null, never 0", () => {
  it("a line with no price makes the dish cost null (and no margin)", async () => {
    addDish(store, 1);
    world.ai = () =>
      answer([POLLO, { ...SALSA, price_per_unit: null, price_unit: null }]);
    const body = await (await POST(req("estimate", {}))).json();
    expect(body.results[0]).toMatchObject({
      est_cost: null,
      est_margin_pct: null,
      skipped_reason: null,
    });
    const row = store.restaurant_dish_estimates[0];
    expect(row.est_cost).toBeNull();
    const lines = dishEstimateFromRow(row)!.lines;
    expect(lines.find((l) => l.raw_name === "salsa")).toMatchObject({
      price_source: null,
      unit_price: null,
      line_cost: null,
    });
    expect(store.ingredient_price_estimates).toHaveLength(1); // pollo only
  });

  it("a zero price from the AI is not a price", async () => {
    addDish(store, 1);
    world.ai = () => answer([{ ...POLLO, price_per_unit: 0 }]);
    const body = await (await POST(req("estimate", {}))).json();
    expect(body.results[0].est_cost).toBeNull();
    expect(store.ingredient_price_estimates).toHaveLength(0);
  });
});

describe("margin", () => {
  it("uses the POS average net price, not the menu's selling price", async () => {
    addDish(store, 1);
    store.menu_items = [{ id: "m1", company_id: CO, selling_price: 1 }];
    // Average net price = 500 / 50 = 10. Cost = 200 g × 0.01 + 2 × 0.50 = 3.00.
    world.sales.set(101, { net_sales: 500, units_sold: 50 });
    const body = await (await POST(req("estimate", {}))).json();
    expect(body.results[0].est_cost).toBeCloseTo(3, 10);
    expect(body.results[0].est_margin_pct).toBeCloseTo(70, 6);
  });

  it("is null when the POS has no price for the dish", async () => {
    addDish(store, 1);
    world.sales.set(101, { net_sales: 0, units_sold: 0 });
    const body = await (await POST(req("estimate", {}))).json();
    expect(body.results[0].est_cost).toBeCloseTo(3, 10);
    expect(body.results[0].est_margin_pct).toBeNull();
  });
});

describe("dishes Milton does not touch", () => {
  it("refuses approved and Excel or hand-made dishes; a Confirmado link without a recipe is estimated", async () => {
    addDish(store, 1, { versions: ["approved"], lines_on: [0] });
    addDish(store, 2, { link_state: "confirmado" });
    addDish(store, 3, { source: null, versions: ["in_review"] }); // hand-made
    addDish(store, 4, { versions: ["in_review", "in_review"], lines_on: [1] });
    addDish(store, 5); // the one that can
    const before = snapshot(
      store,
      "pos_product_links",
      "recipe_versions",
      "ingredient_cost_entries"
    );
    const body = await (
      await POST(
        req("estimate", { menu_item_ids: ["m1", "m2", "m3", "m4", "m5"] })
      )
    ).json();
    const by = Object.fromEntries(
      body.results.map(
        (r: { menu_item_id: string; skipped_reason: string }) => [
          r.menu_item_id,
          r.skipped_reason,
        ]
      )
    );
    expect(by).toEqual({
      m1: "approved",
      m2: null,
      m3: "has_recipe",
      m4: "has_recipe",
      m5: null,
    });
    expect(world.calls.map((c) => c.dish).sort()).toEqual([
      "Plato 2",
      "Plato 5",
    ]);
    expect(
      store.restaurant_dish_estimates.map((r) => r.menu_item_id).sort()
    ).toEqual(["m2", "m5"]);
    expect(
      snapshot(
        store,
        "pos_product_links",
        "recipe_versions",
        "ingredient_cost_entries"
      )
    ).toBe(before);
  });

  it("an approved or in-review version with no lines is not a recipe: the plato is estimated", async () => {
    addDish(store, 1, { versions: ["approved"] });
    addDish(store, 2, { versions: ["in_review", "in_review"] });
    const body = await (
      await POST(req("estimate", { menu_item_ids: ["m1", "m2"] }))
    ).json();
    expect(
      body.results.map((r: { skipped_reason: unknown }) => r.skipped_reason)
    ).toEqual([null, null]);
  });

  it("without ids it picks every plato with no recipe, best sellers first, and skips the ones with a recipe", async () => {
    addDish(store, 1, { versions: ["approved"], lines_on: [0] });
    addDish(store, 2, { link_state: "confirmado" });
    // A plato with no menu draft at all: a confirmed link, no evidence, no version.
    (store.pos_product_links ??= []).push({
      id: "l9",
      company_id: CO,
      odoo_product_id: 109,
      odoo_name: "Plato 9",
      location_id: null,
      menu_item_id: "m9",
      link_state: "confirmado",
      evidence: {},
    });
    world.sales.set(109, { net_sales: 5000, units_sold: 10 });
    const auto = await (await POST(req("estimate", {}))).json();
    expect(auto.results.map((r: { name: string }) => r.name)).toEqual([
      "Plato 9",
      "Plato 2",
    ]);
    expect(world.calls.map((c) => c.dish)).toEqual(["Plato 9", "Plato 2"]);
    const unknown = await (
      await POST(req("estimate", { menu_item_ids: ["nope"] }))
    ).json();
    expect(unknown.results[0].skipped_reason).toBe("no_encontrado");
  });

  it("with menu_item_ids: [id] it estimates just that plato", async () => {
    for (let n = 1; n <= 3; n++) addDish(store, n);
    const body = await (
      await POST(req("estimate", { menu_item_ids: ["m2"] }))
    ).json();
    expect(
      body.results.map((r: { menu_item_id: string }) => r.menu_item_id)
    ).toEqual(["m2"]);
    expect(store.restaurant_dish_estimates.map((r) => r.menu_item_id)).toEqual([
      "m2",
    ]);
  });
});

describe("migration 062 not applied", () => {
  const missing = (table: string) => ({
    code: "42P01",
    message: `relation "public.${table}" does not exist`,
  });

  it("POST answers 503 in Spanish and calls no AI", async () => {
    addDish(store, 1);
    setDb({
      fail: (table) =>
        table === "restaurant_dish_estimates" ? missing(table) : false,
    });
    const res = await POST(req("estimate", {}));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(
      "Falta aplicar la actualización de la base de datos (062)."
    );
    expect(world.calls).toHaveLength(0);
  });

  it("PostgREST's PGRST205 counts as missing too", async () => {
    addDish(store, 1);
    setDb({
      fail: (table) =>
        table === "restaurant_dish_estimates"
          ? {
              code: "PGRST205",
              message: `Could not find the table 'public.${table}' in the schema cache`,
            }
          : false,
    });
    expect((await POST(req("estimate", {}))).status).toBe(503);
  });

  it("GET says it is not available, and «usar» answers 503", async () => {
    addDish(store, 1);
    setDb({
      fail: (table) =>
        table === "restaurant_dish_estimates" ? missing(table) : false,
    });
    expect(await (await GET()).json()).toEqual({
      available: false,
      eligible: 1,
      needs_link: 0,
    });
    const use = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(use.status).toBe(503);
  });

  it("the price table missing (dish table present) also answers 503", async () => {
    addDish(store, 1);
    setDb({
      fail: (table) =>
        table === "ingredient_price_estimates" ? missing(table) : false,
    });
    expect((await POST(req("estimate", {}))).status).toBe(503);
  });
});

describe("GET", () => {
  it("counts every plato with no recipe, Confirmado or not", async () => {
    addDish(store, 1);
    addDish(store, 2);
    addDish(store, 3, { versions: ["approved"], lines_on: [0] });
    addDish(store, 4, { link_state: "confirmado" });
    addDish(store, 5, { source: null });
    expect(await (await GET()).json()).toEqual({
      available: true,
      eligible: 3,
      needs_link: 0,
    });
  });

  it("counts a plato that is not a menu draft at all", async () => {
    addDish(store, 1);
    (store.pos_product_links ??= []).push({
      id: "l9",
      company_id: CO,
      odoo_product_id: 109,
      odoo_name: "Plato 9",
      location_id: null,
      menu_item_id: "m9",
      link_state: "confirmado",
      evidence: {},
    });
    const body = await (await GET()).json();
    expect(body.eligible).toBe(2);
  });
});

describe("«usar como borrador»", () => {
  async function estimated() {
    addDish(store, 1);
    store.ingredient_cost_entries.push({
      id: "e1",
      company_id: CO,
      ingredient_id: "i-pollo",
      source_type: "invoice_line",
      cost_date: "2026-09-01",
      effective_date: "2026-09-01",
      unit: "g",
      unit_cost: 0.005,
      normalized_unit: "g",
      normalized_unit_cost: 0.005,
      created_at: "2026-09-01T00:00:00Z",
    });
    await POST(req("estimate", {}));
  }

  it("fills quantity and unit on the existing lines and marks them", async () => {
    await estimated();
    const guarded = [
      "recipe_versions",
      "ingredient_cost_entries",
      "ingredients",
      "recipe_version_inputs",
    ];
    const before = snapshot(store, ...guarded);
    const linkBefore = store.pos_product_links[0];
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      applied: 2,
      not_copied: [],
      version_status: "in_review",
    });
    expect(body.used_as_draft_at).toEqual(expect.any(String));

    const link = store.pos_product_links[0];
    expect(link.id).toBe(linkBefore.id);
    // Real status untouched.
    expect(link.link_state).toBe("sugerido");
    const lines = (link.evidence as { lines: Row[] }).lines;
    const pollo = lines.find((l) => l.raw_name === "pollo")!;
    expect(pollo).toMatchObject({ qty: 200, unit: "g", unit_cost: null });
    expect(pollo.flags).toContain(FLAG_MILTON_ESTIMATE);
    expect(pollo.flags).not.toContain("pendiente_cantidad");
    // Still unresolved: those flags stay.
    expect(pollo.flags).toEqual(
      expect.arrayContaining([
        "pendiente_ingrediente",
        "del_menu",
        "nuevo_sugerido",
      ])
    );
    expect(lines.find((l) => l.raw_name === "salsa")).toMatchObject({
      qty: 2,
      unit: "unidad",
    });
    // The same single in-review version; no cost entry, no new rows.
    expect(snapshot(store, ...guarded)).toBe(before);
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.recipe_versions[0].status).toBe("in_review");
    // The estimate row remembers it was used.
    expect(store.restaurant_dish_estimates[0].used_as_draft_at).toBe(
      body.used_as_draft_at
    );
  });

  it("leaves a line a person already typed alone, and adds no lines", async () => {
    await estimated();
    const lines = (store.pos_product_links[0].evidence as { lines: Row[] })
      .lines;
    lines[1].qty = 7;
    lines[1].unit = "oz";
    const body = await (
      await USE(req("estimate/use", { menu_item_id: "m1" }))
    ).json();
    expect(body.applied).toBe(1);
    expect(body.not_copied).toEqual(["salsa"]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ qty: 7, unit: "oz" });
    expect(lines[1].flags).not.toContain(FLAG_MILTON_ESTIMATE);
  });

  it("works on a Confirmado link and leaves the link exactly as it was", async () => {
    await estimated();
    Object.assign(store.pos_product_links[0], {
      link_state: "confirmado",
      confirmed_by: "u-9",
      confirmed_at: "2026-09-01T00:00:00Z",
      confirmed_how: "manual",
    });
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(200);
    expect(store.pos_product_links[0]).toMatchObject({
      link_state: "confirmado",
      confirmed_by: "u-9",
      confirmed_how: "manual",
      menu_item_id: "m1",
    });
  });

  it("is refused with 409 and writes nothing once the dish is approved or hand-made", async () => {
    for (const change of [
      () => {
        store.recipe_versions[0].status = "approved";
        giveLines(store, 1, 0);
      },
      () => {
        delete (store.pos_product_links[0].evidence as Row).source;
      },
    ]) {
      store = baseStore();
      setDb();
      await estimated();
      change();
      const before = snapshot(
        store,
        "pos_product_links",
        "recipe_versions",
        "ingredient_cost_entries",
        "restaurant_dish_estimates"
      );
      const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(
        "Este plato ya tiene receta aprobada; Milton no la cambia."
      );
      expect(
        snapshot(
          store,
          "pos_product_links",
          "recipe_versions",
          "ingredient_cost_entries",
          "restaurant_dish_estimates"
        )
      ).toBe(before);
    }
  });

  it("404 in Spanish when there is no estimate", async () => {
    addDish(store, 1);
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(
      "No hay un estimado de Milton para este plato."
    );
  });

  it("400 without a dish", async () => {
    const res = await USE(req("estimate/use", {}));
    expect(res.status).toBe(400);
  });

  it("an empty draft gets the estimate lines appended, with flags", async () => {
    addDish(store, 1, { components: [] });
    await POST(req("estimate", {}));
    const guarded = [
      "recipe_versions",
      "ingredient_cost_entries",
      "ingredients",
      "recipe_version_inputs",
    ];
    const before = snapshot(store, ...guarded);
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      applied: 2,
      not_copied: [],
      version_status: "in_review",
    });
    const lines = (store.pos_product_links[0].evidence as { lines: Row[] })
      .lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      raw_name: "pollo",
      qty: 200,
      unit: "g",
      unit_cost: null,
    });
    expect(lines[0].flags).toEqual(
      expect.arrayContaining([FLAG_MILTON_ESTIMATE, "pendiente_ingrediente"])
    );
    expect(lines[1]).toMatchObject({
      raw_name: "salsa",
      qty: 2,
      unit: "unidad",
    });
    expect(snapshot(store, ...guarded)).toBe(before);
    expect(store.recipe_versions[0].status).toBe("in_review");
  });

  it("fills existing lines and does not duplicate by normalized name", async () => {
    addDish(store, 1, { components: ["Pollo"] });
    await POST(req("estimate", {}));
    const body = await (
      await USE(req("estimate/use", { menu_item_id: "m1" }))
    ).json();
    expect(body.applied).toBe(2);
    const lines = (store.pos_product_links[0].evidence as { lines: Row[] })
      .lines;
    expect(lines.map((l) => l.raw_name)).toEqual(["Pollo", "salsa"]);
    expect(lines[0]).toMatchObject({ qty: 200, unit: "g" });
    expect(lines[0].flags).toContain(FLAG_MILTON_ESTIMATE);
    expect(lines[1]).toMatchObject({ qty: 2, unit: "unidad" });
    expect(lines.filter((l) => nameOf(l) === "pollo")).toHaveLength(1);
  });

  it("Sin receta without a draft creates the menu draft and appends the lines", async () => {
    addDish(store, 1, { evidence: {}, versions: [] });
    await POST(req("estimate", {}));
    expect(store.recipe_versions).toHaveLength(0);
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      applied: 2,
      version_status: "in_review",
    });
    expect(store.recipes).toHaveLength(1);
    expect(store.recipes[0]).toMatchObject({
      company_id: CO,
      menu_item_id: "m1",
      source_type: "import",
    });
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.recipe_versions[0]).toMatchObject({
      company_id: CO,
      menu_item_id: "m1",
      status: "in_review",
      notes: "Borrador desde el menú",
    });
    expect(store.recipe_version_inputs ?? []).toHaveLength(0);
    const evidence = store.pos_product_links[0].evidence as {
      source: string;
      status: string;
      lines: Row[];
    };
    expect(evidence.source).toBe("menu");
    expect(evidence.status).toBe("borrador");
    expect(evidence.lines).toHaveLength(2);
    expect(evidence.lines[0].flags).toContain(FLAG_MILTON_ESTIMATE);
    expect(store.ingredients).toHaveLength(1);
  });

  it("stays inside the company: another company's draft and estimate are not touched", async () => {
    addDish(store, 1);
    await POST(req("estimate", {}));
    store.pos_product_links.push({
      id: "l-other",
      company_id: "co-2",
      odoo_product_id: 101,
      odoo_name: "Plato 1",
      location_id: null,
      menu_item_id: "m1",
      link_state: "sugerido",
      evidence: { source: "menu", status: "borrador", lines: [] },
    });
    store.restaurant_dish_estimates.push({
      ...store.restaurant_dish_estimates[0],
      id: "est-other",
      company_id: "co-2",
      used_as_draft_at: null,
    });
    store.recipe_versions.push({
      id: "v-other",
      company_id: "co-2",
      menu_item_id: "m1",
      status: "in_review",
    });
    const otherBefore = JSON.stringify([
      store.pos_product_links[1],
      store.restaurant_dish_estimates[1],
      store.recipe_versions[1],
    ]);
    const res = await USE(req("estimate/use", { menu_item_id: "m1" }));
    expect(res.status).toBe(200);
    expect(
      JSON.stringify([
        store.pos_product_links[1],
        store.restaurant_dish_estimates[1],
        store.recipe_versions[1],
      ])
    ).toBe(otherBefore);
    expect(store.pos_product_links[0].company_id).toBe(CO);
    expect(
      (store.pos_product_links[0].evidence as { lines: Row[] }).lines.length
    ).toBe(2);
    expect(store.restaurant_dish_estimates[0].used_as_draft_at).toEqual(
      expect.any(String)
    );
    expect(store.restaurant_dish_estimates[1].used_as_draft_at).toBeNull();
  });
});

function nameOf(line: Row): string {
  return String(line.raw_name ?? "").toLowerCase();
}
