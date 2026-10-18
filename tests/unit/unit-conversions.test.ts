// One price, several units (migration 056): «1 taza de PAPAS FRANCESAS = 5 oz».
// Conversion, inverse, no conversion (Sin precio, never a guess), costing in the
// editor / dish economics / «Se usa en», typing a price in another unit, the
// API's rules and RLS. Synthetic names and prices only.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  convertPriceWithIngredientConversions,
  convertWithIngredientConversions,
} from "@/lib/restaurant/units";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import { dishesUsingIngredient } from "@/lib/restaurant/costing/dish-economics";
import {
  applyEdit,
  evidenceLinesOf,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  FLAG_PENDING_UNIT,
  latestPrice,
} from "@/lib/restaurant/recipe-costing/editor";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TAZA_OZ = [{ from_unit: "taza", to_unit: "oz", factor: 5 }];

describe("conversion maths", () => {
  it("1 taza = 5 oz: quantities both ways", () => {
    expect(convertWithIngredientConversions(2, "taza", "oz", TAZA_OZ)).toEqual({
      ok: true,
      value: 10,
    });
    // the inverse is derived, not stored
    expect(convertWithIngredientConversions(10, "oz", "taza", TAZA_OZ)).toEqual(
      { ok: true, value: 2 }
    );
  });
  it("bridges through the standard table for the rest (taza → oz → lb)", () => {
    const r = convertWithIngredientConversions(1, "taza", "lb", TAZA_OZ);
    expect(r.ok && r.value).toBeCloseTo(5 / 16, 10);
  });
  it("prices: $0.11/oz is $0.55/taza, and back", () => {
    const toTaza = convertPriceWithIngredientConversions(
      0.11,
      "oz",
      "taza",
      TAZA_OZ
    );
    expect(toTaza.ok && toTaza.value).toBeCloseTo(0.55, 10);
    const toOz = convertPriceWithIngredientConversions(
      0.55,
      "taza",
      "oz",
      TAZA_OZ
    );
    expect(toOz.ok && toOz.value).toBeCloseTo(0.11, 10);
  });
  it("without a conversion nothing is guessed: refused", () => {
    expect(
      convertWithIngredientConversions(1, "taza", "oz", undefined).ok
    ).toBe(false);
    expect(convertWithIngredientConversions(1, "taza", "oz", []).ok).toBe(
      false
    );
    expect(
      convertPriceWithIngredientConversions(0.11, "oz", "taza", []).ok
    ).toBe(false);
    // a conversion for another pair does not help
    expect(
      convertWithIngredientConversions(1, "porcion", "oz", TAZA_OZ).ok
    ).toBe(false);
  });
  it("the standard conversions do not change", () => {
    expect(
      convertWithIngredientConversions(2, "lb", "oz", TAZA_OZ)
    ).toMatchObject({ ok: true, value: 32 });
  });
});

const CO = "co-1";
const ING = [
  { id: "i-papas", name: "Papas fritas de prueba", default_unit: "oz" },
  { id: "i-sal", name: "Sal de prueba", default_unit: "oz" },
];
const ENTRIES = [entry("i-papas", "oz", 0.11), entry("i-sal", "oz", 0.02)];
const line = (id: string, qty: number, unit: string, ing = "i-papas") => ({
  id,
  input_type: "ingredient" as const,
  ingredient_id: ing,
  component_id: null,
  quantity: qty,
  unit,
  unit_cost: null,
  cost_source: null,
});
// Three dishes: 3 oz, 1 taza, 2 taza of the same ingredient.
const DISHES: Record<string, ReturnType<typeof line>[]> = {
  m1: [line("a1", 3, "oz")],
  m2: [line("b1", 1, "taza")],
  m3: [line("c1", 2, "taza"), line("c2", 1, "oz", "i-sal")],
};

function editorCtx(
  menu: string,
  conversions: Array<Record<string, unknown>> = []
) {
  const state = memoryEditorState({
    ingredients: ING,
    entries: [...ENTRIES],
    conversions: conversions.map((c: any) => ({
      ...c,
      ingredient_id: "i-papas",
    })),
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: menu,
    },
    inputs: DISHES[menu],
    link: { id: "link-1", menu_item_id: menu, evidence: {} },
  });
  return {
    state,
    ctx: {
      store: createMemoryEditorStore(state),
      companyId: CO,
      odooProductId: 7,
      locationId: null,
      userId: "u1",
    },
  };
}

describe("the editor costs a line in another unit with the ingredient's conversion", () => {
  it("without it: «Unidad distinta» material — not costed, flagged, total unknown (never $0)", async () => {
    const r = await loadEditor(editorCtx("m2").ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeNull();
    expect(r.state.lines[0].flags).toContain(FLAG_PENDING_UNIT);
    expect(r.state.lines[0].price?.unit).toBe("oz");
    expect(r.state.total_cost).toBeNull();
  });
  it("with 1 taza = 5 oz at $0.11/oz: every dish shows a cost", async () => {
    const totals: Array<number | null> = [];
    for (const m of ["m1", "m2", "m3"]) {
      const r = await loadEditor(editorCtx(m, TAZA_OZ).ctx);
      expect(r.ok).toBe(true);
      if (r.ok) totals.push(r.state.total_cost);
    }
    expect(totals[0]).toBeCloseTo(0.33, 10); // 3 oz
    expect(totals[1]).toBeCloseTo(0.55, 10); // 1 taza = 5 oz
    expect(totals[2]).toBeCloseTo(1.1 + 0.02, 10); // 2 taza + 1 oz of another ingredient
  });
  it("an ingredient without a conversion is untouched", async () => {
    const r = await loadEditor(editorCtx("m1", TAZA_OZ).ctx);
    expect(r.ok && r.state.lines[0].amount).toBeCloseTo(0.33, 10);
  });
});

function economics(conversions: typeof TAZA_OZ) {
  const data = {
    ingredientsById: new Map(ING.map((i) => [i.id, i])),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(
      ENTRIES.map((e) => [e.ingredient_id, [e]])
    ),
    unitConversionsByIngredientId: new Map([["i-papas", conversions]]),
  } as never;
  const ids = ["m1", "m2", "m3"];
  const sales = ids.map((m, i) => ({
    company_id: CO,
    raw_item_name: `Plato ${m}`,
    quantity: 10,
    gross_revenue: 100,
    net_revenue: 100,
    source_metadata: { product_id: i + 1 },
  }));
  const links = ids.map((m, i) => ({
    company_id: CO,
    location_id: null,
    odoo_product_id: i + 1,
    odoo_name: `Plato ${m}`,
    classification: "plato_preparado",
    menu_item_id: m,
    link_state: "confirmado",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
  })) as never;
  const versions: DishVersion[] = ids.map((m) => ({
    id: `v-${m}`,
    menu_item_id: m,
    version_number: 1,
    status: "approved",
    effective_date: null,
    approved_at: "2026-10-01T10:00:00Z",
  }));
  const list = buildPosProductList({
    companyId: CO,
    sales: sales as never,
    links,
    recipeVersions: versions.map((v) => ({
      menu_item_id: v.menu_item_id,
      status: v.status,
    })) as never,
  });
  return buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId: new Map(ids.map((m) => [`v-${m}`, DISHES[m] as never])),
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
}

describe("dish economics and «Se usa en»", () => {
  it("without the conversion two dishes are «Falta precio»; with it none, and «Se usa en» shows amounts", () => {
    const without = economics([]);
    expect(
      without.dishes.filter((d) => d.lines_missing_price > 0)
    ).toHaveLength(2);
    const withIt = economics(TAZA_OZ);
    expect(withIt.dishes.every((d) => d.lines_missing_price === 0)).toBe(true);
    const uses = dishesUsingIngredient(withIt, "i-papas");
    expect(uses).toHaveLength(3);
    expect(uses.map((u) => u.line.amount).sort()).toEqual(
      [
        expect.closeTo(0.33, 10),
        expect.closeTo(0.55, 10),
        expect.closeTo(1.1, 10),
      ].sort()
    );
    const usesWithout = dishesUsingIngredient(without, "i-papas");
    expect(usesWithout.filter((u) => u.line.amount === null)).toHaveLength(2);
  });
});

describe("typing a price on a line whose unit differs from the price unit", () => {
  it("with a conversion: converted to the ingredient's price unit and saved once", async () => {
    const { state, ctx } = editorCtx("m2", TAZA_OZ);
    const r = await applyEdit(ctx, {
      action: "set_price",
      ingredient_id: "i-papas",
      unit: "taza",
      unit_cost: 0.55,
    });
    expect(r.ok).toBe(true);
    const added = state.entries.filter((e) => e.source_type === "manual");
    expect(added).toHaveLength(1);
    expect(added[0].normalized_unit).toBe("oz");
    expect(added[0].normalized_unit_cost).toBeCloseTo(0.11, 10);
  });
  it("without one: the Spanish error with what «Definir conversión» needs", async () => {
    const { state, ctx } = editorCtx("m2");
    const r = await applyEdit(ctx, {
      action: "set_price",
      ingredient_id: "i-papas",
      unit: "taza",
      unit_cost: 0.55,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toContain("No puedo guardar un precio por taza");
    expect(r.conversion).toMatchObject({
      ingredient_id: "i-papas",
      from_unit: "taza",
      to_unit: "oz",
    });
    expect(
      state.entries.filter((e) => e.source_type === "manual")
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The API and RLS
// ---------------------------------------------------------------------------

type Call = { table: string; op: string; args?: unknown };
let calls: Call[];
let failWith: { code: string; message?: string } | null;

function fakeSupabase() {
  const chain = (table: string, op: string): any => {
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: [], error: failWith });
          }
          if (prop === "single")
            return () =>
              Promise.resolve(
                failWith
                  ? { data: null, error: failWith }
                  : {
                      data: {
                        id: "c1",
                        ingredient_id: "11111111-1111-4111-8111-111111111111",
                        from_unit: "taza",
                        to_unit: "oz",
                        factor: 5,
                      },
                      error: null,
                    }
              );
          return (...args: unknown[]) => {
            calls.push({ table, op: `${op}.${prop}`, args });
            return proxy;
          };
        },
      }
    );
    return proxy;
  };
  return {
    from: (table: string) => ({
      select: (...a: unknown[]) => (
        calls.push({ table, op: "select", args: a }),
        chain(table, "select")
      ),
      delete: (...a: unknown[]) => (
        calls.push({ table, op: "delete", args: a }),
        chain(table, "delete")
      ),
      upsert: (...a: unknown[]) => (
        calls.push({ table, op: "upsert", args: a }),
        chain(table, "upsert")
      ),
    }),
  };
}

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: fakeSupabase(),
    companyId: "co-1",
    userId: "u-1",
  }),
}));

const ING_ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) =>
  new Request("http://x/api/restaurant/ingredients/unit-conversions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

describe("POST /api/restaurant/ingredients/unit-conversions", () => {
  beforeEach(() => {
    calls = [];
    failWith = null;
  });
  it("stores ONE direction, replacing the inverse, scoped to the company", async () => {
    const { POST } =
      await import("@/app/api/restaurant/ingredients/unit-conversions/route");
    const res = await POST(
      post({
        ingredient_id: ING_ID,
        from_unit: "Taza",
        to_unit: "OZ",
        factor: 5,
      })
    );
    expect(res.status).toBe(200);
    const up = calls.find((c) => c.op === "upsert");
    expect((up?.args as unknown[])[0]).toMatchObject({
      company_id: "co-1",
      ingredient_id: ING_ID,
      from_unit: "taza",
      to_unit: "oz",
      factor: 5,
      created_by: "u-1",
    });
    // the opposite direction (oz → taza) is removed first
    expect(
      calls.some(
        (c) =>
          c.op === "delete.eq" &&
          JSON.stringify(c.args) === JSON.stringify(["from_unit", "oz"])
      )
    ).toBe(true);
  });
  it("refuses a pair the standard table already converts, equal units and a bad factor", async () => {
    const { POST } =
      await import("@/app/api/restaurant/ingredients/unit-conversions/route");
    for (const body of [
      { ingredient_id: ING_ID, from_unit: "oz", to_unit: "lb", factor: 16 },
      { ingredient_id: ING_ID, from_unit: "taza", to_unit: "taza", factor: 1 },
      { ingredient_id: ING_ID, from_unit: "taza", to_unit: "oz", factor: 0 },
      {
        ingredient_id: ING_ID,
        from_unit: "taza",
        to_unit: "oz",
        factor: "abc",
      },
      { ingredient_id: "no-uuid", from_unit: "taza", to_unit: "oz", factor: 5 },
    ]) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });
  it("a non-member (RLS 42501) gets 403; a missing table gets 409 with the migration", async () => {
    const { POST } =
      await import("@/app/api/restaurant/ingredients/unit-conversions/route");
    failWith = {
      code: "42501",
      message: "new row violates row-level security policy",
    };
    expect(
      (
        await POST(
          post({
            ingredient_id: ING_ID,
            from_unit: "taza",
            to_unit: "oz",
            factor: 5,
          })
        )
      ).status
    ).toBe(403);
    failWith = {
      code: "42P01",
      message: 'relation "ingredient_unit_conversions" does not exist',
    };
    const res = await POST(
      post({
        ingredient_id: ING_ID,
        from_unit: "taza",
        to_unit: "oz",
        factor: 5,
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("migración 056");
  });
});

describe("migration 056", () => {
  const sql = read("supabase/migrations/056_ingredient_unit_conversions.sql");
  it("is additive, company-scoped, unique per (ingredient, from, to) and closed to anon", () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.ingredient_unit_conversions/
    );
    for (const col of [
      "company_id",
      "ingredient_id",
      "from_unit",
      "to_unit",
      "factor",
      "created_by",
      "created_at",
    ])
      expect(sql).toContain(col);
    expect(sql).toMatch(/UNIQUE \(ingredient_id, from_unit, to_unit\)/);
    expect(sql).toMatch(/CHECK \(factor > 0\)/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/is_company_member\(company_id\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.ingredient_unit_conversions FROM anon/
    );
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE public\./);
  });
  it("an ingredient of another company is refused", () => {
    expect(sql).toMatch(
      /ingredients\s+WHERE id = NEW\.ingredient_id AND company_id = NEW\.company_id/
    );
  });
});

describe("speed: the treatment dropdown no longer reloads Platos", () => {
  it("withTreatment changes the product, the selection and the queue at once", async () => {
    const { withTreatment } =
      await import("@/lib/restaurant/recipe-costing/optimistic");
    const data = {
      products: [
        {
          odoo_product_id: 1,
          treatment: "plato_preparado",
          treatment_label: "Plato preparado",
          classification: "plato_preparado",
          classification_label: "x",
          in_food_sales: true,
        },
      ],
      selected: {
        odoo_product_id: 1,
        treatment: "plato_preparado",
        treatment_label: "Plato preparado",
        classification: "plato_preparado",
        classification_label: "x",
        in_food_sales: true,
      },
      plato_queue: [{ odoo_product_id: 1 }, { odoo_product_id: 2 }],
    } as never as Parameters<typeof withTreatment>[0];
    const excluded = withTreatment(data, 1, "excluido");
    expect(excluded.selected?.treatment).toBe("excluido");
    expect(excluded.selected?.in_food_sales).toBe(false);
    expect(excluded.products[0].treatment_label).toBe(
      "Excluido (no es comida)"
    );
    expect(excluded.plato_queue.map((r) => r.odoo_product_id)).toEqual([2]);
    const reventa = withTreatment(data, 1, "reventa");
    expect(reventa.plato_queue).toHaveLength(2);
    expect(reventa.selected?.treatment).toBe("reventa");
  });
  it("the workspace saves the treatment in the background, with a rollback, and never calls reload()", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    const body = src.slice(
      src.indexOf("const postOptimistic"),
      src.indexOf("/** What a one-dish read changes")
    );
    expect(body).toContain("withTreatment(prev, id, treatment)");
    expect(body).toContain("void post(url, body).catch");
    expect(body).toContain("withTreatment(prev, id, previous)");
    expect(body).not.toMatch(/\breload\(|mutate\(/);
    expect(src).toContain("onPost={postOptimistic}");
  });
  it("a price in the ingredient's own unit patches one picker option instead of dropping the list", async () => {
    const {
      rememberPickerOptions,
      patchPickerOptionPrice,
      cachedPickerOptions,
      invalidatePickerOptions,
    } = await import("@/lib/restaurant/recipe-costing/picker-cache");
    rememberPickerOptions([
      {
        kind: "ingredient",
        id: "i1",
        name: "A",
        unit: "oz",
        unit_cost: null,
        price_date: null,
        price_source: null,
      },
      {
        kind: "ingredient",
        id: "i2",
        name: "B",
        unit: "lb",
        unit_cost: 1,
        price_date: null,
        price_source: null,
      },
    ]);
    expect(patchPickerOptionPrice("i1", "onza", 0.11)).toBe(true);
    expect(cachedPickerOptions()?.[0]).toMatchObject({
      unit_cost: 0.11,
      price_source: "manual",
    });
    expect(cachedPickerOptions()?.[1].unit_cost).toBe(1); // untouched
    // another unit cannot be patched exactly: the caller clears the list
    expect(patchPickerOptionPrice("i1", "taza", 0.5)).toBe(false);
    invalidatePickerOptions();
  });
});
