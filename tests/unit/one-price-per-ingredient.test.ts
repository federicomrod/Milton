// ONE current price per ingredient: ingredient_cost_entries is the only source of
// an ingredient line's price. A copy left on a line by an old import is ignored
// (Sin precio + «legacy_line_price»), never silently used. Synthetic names/prices.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  calculateMenuItemCost,
  latestCostEntry,
} from "@/lib/restaurant/costing";
import {
  applyEdit,
  evidenceLinesOf,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  FLAG_LEGACY_LINE_PRICE,
  latestPrice,
} from "@/lib/restaurant/recipe-costing/editor";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  buildDishEconomics,
  dishesUsingIngredient,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import {
  planLegacyAdoption,
  type LegacyLineCopy,
} from "@/lib/restaurant/legacy-line-price";
import { duplicateReport } from "@/lib/restaurant/ingredient-duplicate-report";
import { resolveAskMiltonIngredientUnitCost } from "@/lib/restaurant/ask-milton-context";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CO = "co-1";
const ING = [{ id: "i-queso", name: "QUESO MOZARELLA", default_unit: "oz" }];

// Three dishes: two carry a $0.18/oz copy on the line, one does not.
const DISHES: Record<string, Array<ReturnType<typeof line>>> = {
  m1: [line("a1", 1, "oz", 0.18)],
  m2: [line("b1", 1, "oz", 0.18)],
  m3: [line("c1", 1, "oz", null)],
};
function line(id: string, qty: number, unit: string, copy: number | null) {
  return {
    id,
    input_type: "ingredient" as const,
    ingredient_id: "i-queso",
    component_id: null,
    quantity: qty,
    unit,
    unit_cost: copy,
    cost_source: copy === null ? null : "PARRILLA!E8",
  };
}
function editorFor(menu: string, entries: ReturnType<typeof entry>[] = []) {
  const state = memoryEditorState({
    ingredients: ING,
    entries: [...entries],
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: menu,
    },
    inputs: DISHES[menu].map((d) => ({ ...d })),
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

describe("an ingredient line never costs from its own copy", () => {
  it("no cost entry: all three dishes are Sin precio, the two copies are flagged", async () => {
    const totals: Array<number | null> = [];
    const flags: boolean[] = [];
    for (const m of ["m1", "m2", "m3"]) {
      const r = await loadEditor(editorFor(m).ctx);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      totals.push(r.state.total_cost);
      expect(r.state.lines[0].amount).toBeNull();
      expect(r.state.lines[0].pending).toBe(true);
      flags.push(r.state.lines[0].flags.includes(FLAG_LEGACY_LINE_PRICE));
      if (m !== "m3")
        expect(r.state.lines[0].legacy_price).toEqual({
          unit_cost: 0.18,
          unit: "oz",
        });
      else expect(r.state.lines[0].legacy_price ?? null).toBeNull();
    }
    expect(totals).toEqual([null, null, null]); // not $0.18, $0.18, Sin precio
    expect(flags).toEqual([true, true, false]);
  });
  it("the engine itself ignores the copy on an ingredient line", () => {
    const data = {
      ingredientsById: new Map(ING.map((i) => [i.id, i])),
      componentsById: new Map(),
      componentRecipesByComponentId: new Map(),
      componentRecipeInputsByRecipeId: new Map(),
      menuItemsById: new Map([
        ["m", { id: "m", name: "x", selling_price: null, currency: null }],
      ]),
      menuRecipesByMenuItemId: new Map([
        ["m", { id: "r", menu_item_id: "m", status: "active" }],
      ]),
      menuRecipeInputsByRecipeId: new Map([["r", [DISHES.m1[0]]]]),
      costEntriesByIngredientId: new Map(),
    } as never;
    const r = calculateMenuItemCost("m", data);
    expect(r.cost).toBeNull();
  });
  it("an existing cost entry wins over the line copies, with no legacy flag", async () => {
    const entries = [entry("i-queso", "oz", 0.2)];
    const r = await loadEditor(editorFor("m1", entries).ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeCloseTo(0.2, 10);
    expect(r.state.lines[0].flags).not.toContain(FLAG_LEGACY_LINE_PRICE);
    expect(r.state.lines[0].own_cost).toBe(false);
  });
  it("«Usar como precio del ingrediente» adopts the copy once, for every dish", async () => {
    const first = editorFor("m1");
    const adopt = await applyEdit(first.ctx, {
      action: "set_price",
      ingredient_id: "i-queso",
      unit: "oz",
      unit_cost: 0.18,
      adopt_legacy: true,
    });
    expect(adopt.ok).toBe(true);
    expect(first.state.entries).toHaveLength(1);
    expect(first.state.entries[0].notes).toBe("Adoptado del precio de línea");
    const totals: Array<number | null> = [];
    for (const m of ["m1", "m2", "m3"]) {
      const r = await loadEditor(editorFor(m, first.state.entries).ctx);
      totals.push(r.ok ? r.state.total_cost : null);
    }
    expect(totals).toEqual([
      expect.closeTo(0.18, 10),
      expect.closeTo(0.18, 10),
      expect.closeTo(0.18, 10),
    ]);
  });
});

function economics(entries: ReturnType<typeof entry>[]) {
  const data = {
    ingredientsById: new Map(ING.map((i) => [i.id, i])),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(
      entries.length ? [["i-queso", entries]] : []
    ),
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

describe("the dish line offers the old price", () => {
  it("«Precio antiguo de la receta: $X/oz · Usar como precio del ingrediente» calls set_price (adopt_legacy)", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(src).toContain("Precio antiguo de la receta");
    expect(src).toContain("Usar como precio del ingrediente");
    expect(src).toContain("adopt_legacy: true");
    expect(src).toContain("line.legacy_price");
  });
});

describe("dish economics, «Se usa en» and the editor agree", () => {
  it("without an entry every dish is «Falta precio» and «Se usa en» has no amount", () => {
    const e = economics([]);
    expect(
      e.dishes.every((d) => d.lines_missing_price === 1 && d.unit_cost === null)
    ).toBe(true);
    expect(
      dishesUsingIngredient(e, "i-queso").every((u) => u.line.amount === null)
    ).toBe(true);
  });
  it("with one adopted entry all three show the same price in economics and the editor", async () => {
    const entries = [entry("i-queso", "oz", 0.18)];
    const e = economics(entries);
    expect(e.dishes.map((d) => d.unit_cost)).toEqual([
      expect.closeTo(0.18, 10),
      expect.closeTo(0.18, 10),
      expect.closeTo(0.18, 10),
    ]);
    expect(e.dishes.every((d) => d.lines_missing_price === 0)).toBe(true);
    const ed = await loadEditor(editorFor("m2", entries).ctx);
    expect(ed.ok && ed.state.total_cost).toBeCloseTo(
      e.dishes[1].unit_cost!,
      10
    );
  });
});

describe("the cleanup rules (mirror of migration 057)", () => {
  const copy = (id: string, unit: string, c: number): LegacyLineCopy => ({
    ingredient_id: id,
    unit,
    unit_cost: c,
  });
  it("copies that agree → ONE entry", () => {
    const plan = planLegacyAdoption({
      copies: [copy("i-queso", "oz", 0.18), copy("i-queso", "oz", 0.18)],
      withEntry: new Set(),
    });
    expect(plan.adopt).toEqual([
      { ingredient_id: "i-queso", unit: "oz", unit_cost: 0.18, lines: 2 },
    ]);
  });
  it("agree after unit conversion (oz vs lb), written in the ingredient's own unit", () => {
    const plan = planLegacyAdoption({
      copies: [copy("i", "oz", 0.18), copy("i", "lb", 2.88)],
      withEntry: new Set(),
      defaultUnitOf: () => "lb",
    });
    expect(plan.adopt).toHaveLength(1);
    expect(plan.adopt[0].unit).toBe("lb");
    expect(plan.adopt[0].unit_cost).toBeCloseTo(2.88, 6);
  });
  it("disagreeing copies: nothing inserted, the case is listed", () => {
    const plan = planLegacyAdoption({
      copies: [copy("i", "oz", 0.18), copy("i", "oz", 0.25)],
      withEntry: new Set(),
    });
    expect(plan.adopt).toHaveLength(0);
    expect(plan.disagree).toEqual([
      expect.objectContaining({
        ingredient_id: "i",
        lines: 2,
        min_per_base: expect.any(Number),
      }),
    ]);
  });
  it("incompatible units (oz vs unidad): listed, nothing inserted", () => {
    const plan = planLegacyAdoption({
      copies: [copy("i", "oz", 0.18), copy("i", "unit", 0.5)],
      withEntry: new Set(),
    });
    expect(plan.adopt).toHaveLength(0);
    expect(plan.mixed_units).toHaveLength(1);
  });
  it("an ingredient that already has an entry is left alone; a second run adds nothing", () => {
    const copies = [copy("i", "oz", 0.18)];
    const first = planLegacyAdoption({ copies, withEntry: new Set() });
    expect(first.adopt).toHaveLength(1);
    const second = planLegacyAdoption({ copies, withEntry: new Set(["i"]) });
    expect(second.adopt).toHaveLength(0);
    expect(second.left_alone_with_entry).toEqual(["i"]);
  });
  it("migration 057 is SECURITY INVOKER, member-checked (42501), closed to anon, idempotent, and never nulls line prices", () => {
    const sql = read("supabase/migrations/057_adopt_legacy_line_prices.sql");
    expect(sql).toMatch(
      /adopt_legacy_line_prices\(\s*p_company uuid,\s*p_dry_run boolean/
    );
    expect(
      (sql.match(/SECURITY INVOKER/g) ?? []).length
    ).toBeGreaterThanOrEqual(3);
    expect(
      (sql.match(/is_company_member\(p_company\)/g) ?? []).length
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("ERRCODE = '42501'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.adopt_legacy_line_prices\(uuid, boolean\) FROM PUBLIC, anon/
    );
    expect(sql).toContain("'Adoptado del precio de línea'");
    expect(sql).toContain("WHEN EXISTS");
    expect(sql).toContain("'has_entry'");
    expect(sql).toContain("legacy_current_unit_cost_report");
    // additive: no line price is cleared, no row is deleted
    expect(sql).not.toMatch(
      /UPDATE\s+public\.(recipe_version_inputs|component_recipe_version_inputs|ingredients)/i
    );
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/SET\s+unit_cost\s*=\s*NULL/i);
  });
});

describe("the legacy ingredients.current_unit_cost cache is not a price source", () => {
  it("Ask Milton ignores the cache: no entry is a pending price", () => {
    const r = resolveAskMiltonIngredientUnitCost(null, 9.99, "es");
    expect(r.current_unit_cost).toBeNull();
    expect(r.pending_label).not.toBeNull();
  });
  it("no costing / UI reader falls back to it", () => {
    for (const f of [
      "lib/restaurant/calculations.ts",
      "lib/restaurant/ask-milton-context.ts",
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/\?\?\s*(r|ing|ingredient)\.current_unit_cost/);
      expect(src).not.toMatch(/ingredient\.current_unit_cost\s*(==|<=)/);
    }
    expect(read("app/api/restaurant/ingredients/[id]/route.ts")).not.toContain(
      "current_unit_cost"
    );
  });
});

describe("Ingredientes uses the editor's «current entry»", () => {
  it("newest EFFECTIVE date wins, not the newest cost_date", () => {
    const old = entry("i", "oz", 0.1, {
      effective_date: "2026-09-01",
      cost_date: "2026-10-05",
    });
    const dated = entry("i", "oz", 0.3, {
      effective_date: "2026-10-01",
      cost_date: "2026-10-01",
    });
    expect(latestCostEntry([old, dated])?.normalized_unit_cost).toBe(0.3);
    const src = read("lib/restaurant/menu-recipes-server.ts");
    expect(src).toContain("latestCostEntry(list)");
    expect(src).toContain("effective_date, date_source");
  });
});

describe("read-only report of duplicates by spelling", () => {
  it("groups MOZARELLA / MOZZARELLA / MOZARELA and suggests the survivor «Unir…» would keep", () => {
    const groups = duplicateReport(
      [
        {
          id: "a",
          name: "QUESO MOZARELLA",
          unit: "oz",
          price: null,
          priceUnit: null,
          recipeCount: 1,
        },
        {
          id: "b",
          name: "QUESO MOZZARELLA",
          unit: "oz",
          price: 0.18,
          priceUnit: "oz",
          recipeCount: 2,
        },
        {
          id: "c",
          name: "QUESO MOZARELA",
          unit: "oz",
          price: null,
          priceUnit: null,
          recipeCount: 0,
        },
        {
          id: "d",
          name: "TOMATE",
          unit: "oz",
          price: 1,
          priceUnit: "oz",
          recipeCount: 3,
        },
      ],
      new Set()
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(groups[0].members.find((m) => m.suggested_survivor)?.id).toBe("b"); // has a price
  });
  it("is read-only: the route only reads", () => {
    const src = read(
      "app/api/restaurant/ingredients/duplicates/report/route.ts"
    );
    expect(src).toContain("export async function GET");
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  });
});
