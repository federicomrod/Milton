// «Leer menú» end to end with an in-memory repo: a Confirmado link with no
// recipe gets a draft and keeps its meaning; "Deshacer lote" restores it
// exactly; the report is per MENU dish (Σ menu_outcomes = dishes_read), over
// the current month's Platos groups. Synthetic names only.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
  type MemoryCostWorkbookStore,
} from "./helpers/memory-cost-workbook-repo";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook/undo";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";

const world = vi.hoisted(() => ({
  repo: null as unknown,
  products: [] as Array<Record<string, unknown>>,
  /** Platos groups; default = one group per product, sin receta. */
  groups: null as null | Array<Record<string, unknown>>,
  economics: vi.fn(),
}));

vi.mock("@/lib/restaurant/cost-workbook/repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/cost-workbook/repo")>()),
  createSupabaseCostWorkbookRepo: () => world.repo,
}));
vi.mock("@/lib/restaurant/costing/dish-economics-server", () => ({
  loadDishEconomicsWith: world.economics,
}));

import {
  loadPeriodPlatos,
  readMenuIntoDrafts,
} from "@/lib/restaurant/menu-reading/server";

const CO = "co-1";
const MENU_DISHES = [
  {
    name: "Plato Demo",
    section: "Platos fuertes",
    price: 18.5,
    description: "Carne a la parrilla con papas y ensalada",
    variants: [],
    components: ["carne", "papas", "ensalada"],
  },
  {
    name: "Sopa Demo",
    section: "Entradas",
    price: 4,
    description: null,
    variants: [],
    components: [],
  },
];

let mem: MemoryCostWorkbookStore;
let db: FakeStore;

function product(id: number, name: string, over: Record<string, unknown> = {}) {
  return {
    odoo_product_id: id,
    odoo_name: name,
    net_sales: 100,
    units_sold: 10,
    treatment: "plato_preparado",
    is_combo: false,
    link_state: "sin_vincular",
    ...over,
  };
}

function confirmedLink(
  id: number,
  name: string,
  menuItemId: string
): PosProductLinkRecord {
  return {
    id: `l${id}`,
    company_id: CO,
    location_id: null,
    odoo_product_id: id,
    odoo_name: name,
    classification: "plato_preparado",
    menu_item_id: menuItemId,
    link_state: "confirmado",
    confirmed_by: "u-9",
    confirmed_at: "2026-09-01T00:00:00Z",
    confirmed_how: "manual",
    evidence: {},
  };
}

function addMenuItem(id: string, name: string) {
  mem.menuItems.push({
    id,
    name,
    source_type: "import",
    source_id: null,
    selling_price: 18.5,
  });
  mem.recipes.push({
    id: `r-${id}`,
    menu_item_id: id,
    name,
    source_type: "import",
    source_id: null,
  });
}

function addVersion(
  menuItemId: string,
  status: "approved" | "in_review",
  lines: number
) {
  const vid = `v-${menuItemId}-${mem.recipeVersions.length}`;
  mem.recipeVersions.push({
    id: vid,
    recipe_id: `r-${menuItemId}`,
    menu_item_id: menuItemId,
    version_number: mem.recipeVersions.length + 1,
    status,
    effective_date: null,
    inputs: [],
  });
  for (let i = 0; i < lines; i++) {
    db.recipe_version_inputs.push({
      id: `${vid}-in${i}`,
      company_id: CO,
      recipe_version_id: vid,
    });
  }
}

/** A Platos group of the month: its variants are POS products by id. */
function group(
  id: string,
  name: string,
  productIds: number[],
  status: "sin_receta" | "aprobado" = "sin_receta"
) {
  return {
    id,
    name,
    variants: productIds.map((pid) => ({
      odoo_product_id: pid,
      name: `p${pid}`,
      status,
      covered: status === "aprobado",
    })),
  };
}

const read = () =>
  readMenuIntoDrafts(makeFakeDb(db) as never, {
    companyId: CO,
    currency: "USD",
    source: { kind: "text", text: "menu" },
    loadPlatos: async () => ({
      range: { from: "2026-10-01", to: "2026-10-20" },
      products: world.products as never,
      menu_dishes: (world.groups ??
        world.products.map((p) =>
          group(`g${p.odoo_product_id}`, String(p.odoo_name), [
            p.odoo_product_id as number,
          ])
        )) as never,
    }),
    readSource: async () => ({
      kind: "text",
      source_ref: null,
      text: "menu",
      truncated: false,
    }),
    ai: async () => ({ dishes: MENU_DISHES }),
  });

beforeEach(() => {
  mem = emptyMemoryStore();
  db = { restaurant_menu_sources: [], recipe_version_inputs: [] };
  world.repo = createMemoryCostWorkbookRepo(mem);
  world.products = [];
  world.groups = null;
  world.economics.mockReset();
});

describe("«Leer menú» with a Confirmado link", () => {
  it("drafts a Confirmado plato with no recipe and keeps the link as it was", async () => {
    addMenuItem("m1", "Plato Demo 8 oz");
    mem.posProductLinks.push(confirmedLink(1, "Plato Demo 8 oz", "m1"));
    world.products = [
      product(1, "Plato Demo 8 oz", { link_state: "confirmado" }),
    ];
    const before = structuredClone(mem.posProductLinks[0]);

    const result = await read();

    expect(result).toMatchObject({
      dishes_read: 2,
      drafted: 1,
      skipped_has_recipe: 0,
      not_on_menu: 0,
      failed: 0,
    });
    const link = mem.posProductLinks[0];
    expect(link).toMatchObject({
      link_state: "confirmado",
      menu_item_id: "m1",
      confirmed_by: "u-9",
      confirmed_at: "2026-09-01T00:00:00Z",
      confirmed_how: "manual",
    });
    expect(link.evidence).toMatchObject({ source: "menu", pending: true });
    // One in-review version with NO lines: quantities are the person's.
    expect(mem.recipeVersions).toHaveLength(1);
    expect(mem.recipeVersions[0]).toMatchObject({
      status: "in_review",
      inputs: [],
    });
    expect(mem.ingredients).toHaveLength(0);

    // «Deshacer lote» restores the link exactly.
    const undone = await undoCostImportBatch(
      world.repo as never,
      CO,
      result.batch_id!
    );
    expect(undone.ok).toBe(true);
    expect(mem.posProductLinks[0]).toEqual(before);
    expect(mem.recipeVersions).toHaveLength(0);
  });

  it("an empty version row does not count as a recipe", async () => {
    addMenuItem("m1", "Plato Demo");
    mem.posProductLinks.push(confirmedLink(1, "Plato Demo", "m1"));
    addVersion("m1", "in_review", 0);
    world.products = [product(1, "Plato Demo", { link_state: "confirmado" })];
    const result = await read();
    expect(result.drafted).toBe(1);
    expect(result.skipped_has_recipe).toBe(0);
  });

  it("an approved recipe with lines is left alone", async () => {
    addMenuItem("m1", "Plato Demo");
    mem.posProductLinks.push(confirmedLink(1, "Plato Demo", "m1"));
    addVersion("m1", "approved", 2);
    world.products = [product(1, "Plato Demo", { link_state: "confirmado" })];
    const result = await read();
    expect(result).toMatchObject({ drafted: 0, skipped_has_recipe: 1 });
    expect(result.batch_id).toBeNull();
    expect(mem.recipeVersions).toHaveLength(1);
  });
});

describe("the report is per menu dish", () => {
  it("three POS sizes of the same plato are one drafted menu dish, with the Odoo products named", async () => {
    addMenuItem("m1", "Plato Demo");
    for (const [id, name] of [
      [1, "Plato Demo 8 oz"],
      [2, "Plato Demo 12 oz"],
      [3, "Plato Demo 16 oz"],
    ] as const) {
      mem.posProductLinks.push(confirmedLink(id, name, "m1"));
    }
    world.products = [
      product(1, "Plato Demo 8 oz", { link_state: "confirmado" }),
      product(2, "Plato Demo 12 oz", { link_state: "confirmado" }),
      product(3, "Plato Demo 16 oz", { link_state: "confirmado" }),
    ];
    world.groups = [group("gA", "Plato Demo", [1, 2, 3])];
    const result = await read();
    expect(result.drafted).toBe(1);
    expect(mem.recipeVersions).toHaveLength(1);
    const drafted = result.menu_outcomes.find((o) => o.outcome === "drafted")!;
    expect(drafted.menu_dish).toBe("Plato Demo");
    expect(drafted.products.map((p) => p.odoo_product_id).sort()).toEqual([
      1, 2, 3,
    ]);
    expect(drafted.products.map((p) => p.odoo_name)).toContain(
      "Plato Demo 8 oz"
    );
  });

  it("Σ menu_outcomes = dishes_read; a menu dish without a POS product is named", async () => {
    addMenuItem("m1", "Plato Demo");
    mem.posProductLinks.push(confirmedLink(1, "Plato Demo", "m1"));
    world.products = [product(1, "Plato Demo", { link_state: "confirmado" })];
    const result = await read();
    expect(result.menu_outcomes).toHaveLength(result.dishes_read);
    expect(result.menu_outcomes).toEqual([
      expect.objectContaining({ menu_dish: "Plato Demo", outcome: "drafted" }),
      {
        menu_dish: "Sopa Demo",
        outcome: "no_pos_match",
        products: [],
      },
    ]);
    expect(
      result.drafted +
        result.skipped_has_recipe +
        result.skipped_draft_exists +
        result.skipped_no_ingredients +
        result.no_pos_match +
        result.failed
    ).toBe(result.dishes_read);
    expect(result.no_pos_match).toBe(1);
  });

  it("splits the rest: no ingredients, not on the menu", async () => {
    addMenuItem("m1", "Sopa Demo");
    mem.posProductLinks.push(confirmedLink(1, "Sopa Demo", "m1"));
    world.products = [
      product(1, "Sopa Demo", { link_state: "confirmado" }),
      product(2, "Plato Fuera Del Menu"),
    ];
    const result = await read();
    expect(result).toMatchObject({
      drafted: 0,
      skipped_no_ingredients: 1,
      no_pos_match: 1,
      not_on_menu: 1,
      not_found: ["Plato Fuera Del Menu"],
    });
    expect(result.menu_outcomes).toEqual([
      { menu_dish: "Plato Demo", outcome: "no_pos_match", products: [] },
      {
        menu_dish: "Sopa Demo",
        outcome: "no_ingredients",
        products: [{ odoo_product_id: 1, odoo_name: "Sopa Demo" }],
      },
    ]);
  });

  it("a plato that already has a recipe is matched first and reported, never changed", async () => {
    addMenuItem("m1", "Plato Demo");
    mem.posProductLinks.push(confirmedLink(1, "Plato Demo", "m1"));
    addVersion("m1", "approved", 2);
    world.products = [product(1, "Plato Demo", { link_state: "confirmado" })];
    const before = structuredClone(mem.recipeVersions);
    const linkBefore = structuredClone(mem.posProductLinks);
    const result = await read();
    expect(result.menu_outcomes[0]).toMatchObject({
      menu_dish: "Plato Demo",
      outcome: "has_recipe",
      products: [{ odoo_product_id: 1, odoo_name: "Plato Demo" }],
    });
    expect(result.batch_id).toBeNull();
    expect(mem.recipeVersions).toEqual(before);
    expect(mem.posProductLinks).toEqual(linkBefore);
  });

  it("an existing menu draft is reported as «ya tenía borrador» and not touched", async () => {
    addMenuItem("m1", "Plato Demo");
    const link = confirmedLink(1, "Plato Demo", "m1");
    link.evidence = { source: "menu", pending: true };
    mem.posProductLinks.push(link);
    addVersion("m1", "in_review", 0);
    world.products = [product(1, "Plato Demo", { link_state: "confirmado" })];
    const before = structuredClone(mem.recipeVersions);
    const result = await read();
    expect(result.menu_outcomes[0]).toMatchObject({
      outcome: "draft_exists",
    });
    expect(result.skipped_draft_exists).toBe(1);
    expect(mem.recipeVersions).toEqual(before);
  });
});

describe("«no aparecen en el menú»: Platos with sales this month", () => {
  it("counts Platos groups, not the option combinations inside them", async () => {
    world.products = [
      product(10, "Desayuno Vicentino (Pan con Ajo)"),
      product(11, "Desayuno Vicentino (Papas)"),
      product(12, "Desayuno Vicentino (Arroz)"),
      product(20, "Cena Especial"),
      product(30, "Plato Con Receta"),
    ];
    world.groups = [
      group("gD", "Desayuno Vicentino", [10, 11, 12]),
      group("gC", "Cena Especial", [20]),
      group("gR", "Plato Con Receta", [30], "aprobado"),
    ];
    const result = await read();
    expect(result.not_on_menu).toBe(2);
    expect(result.not_found).toEqual(["Desayuno Vicentino", "Cena Especial"]);
  });

  it("a Platos group the menu lists is not «fuera del menú»", async () => {
    addMenuItem("m1", "Sopa Demo");
    mem.posProductLinks.push(confirmedLink(1, "Sopa Demo", "m1"));
    world.products = [product(1, "Sopa Demo", { link_state: "confirmado" })];
    const result = await read();
    expect(result.not_on_menu).toBe(0);
    expect(result.not_found).toEqual([]);
  });
});

describe("the month of the last sale", () => {
  it("reads the same range Resumen opens on and hands the Platos groups on", async () => {
    db.pos_sales_items = [
      { company_id: CO, pos_source: "odoo", sale_date: "2026-09-30" },
      { company_id: CO, pos_source: "odoo", sale_date: "2026-10-20" },
    ];
    world.economics.mockResolvedValue({
      ok: true,
      list: { products: [{ odoo_product_id: 1 }] },
      result: { menu_dishes: [{ id: "d1" }] },
    });
    const got = await loadPeriodPlatos(makeFakeDb(db) as never, {
      companyId: CO,
      locationId: null,
    });
    expect(world.economics).toHaveBeenCalledWith(expect.anything(), {
      companyId: CO,
      from: "2026-10-01",
      to: "2026-10-20",
      locationId: null,
    });
    expect(got.range).toEqual({ from: "2026-10-01", to: "2026-10-20" });
    expect(got.menu_dishes).toHaveLength(1);
  });

  it("with no sales there is nothing to read", async () => {
    db.pos_sales_items = [];
    const got = await loadPeriodPlatos(makeFakeDb(db) as never, {
      companyId: CO,
      locationId: null,
    });
    expect(got).toEqual({ range: null, products: [], menu_dishes: [] });
    expect(world.economics).not.toHaveBeenCalled();
  });
});
