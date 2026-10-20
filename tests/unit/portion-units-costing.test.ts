// ORDEN / ORDENES / CONVOY are counts: 1 orden = 1 unidad, never weight or
// volume. The editor line, the dish total, «Falta precio · N» and dish
// economics (what the Cockpit reads) must agree. Synthetic names and prices.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  convertToSubRecipeUnit,
  convertUnitPriceOrPortion,
} from "@/lib/restaurant/units";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import { buildDishEconomics } from "@/lib/restaurant/costing/dish-economics";
import {
  evidenceLinesOf,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  FLAG_PENDING_UNIT,
  latestPrice,
} from "@/lib/restaurant/recipe-costing/editor";
import {
  UNIT_MISMATCH_LABEL,
  unitMismatchHint,
} from "@/lib/restaurant/recipe-costing/format";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

describe("portion ↔ each in the unit rules", () => {
  it("quantities: orden ≡ ORDEN ≡ ordenes ≡ CONVOY are 1:1; an orden is NEVER a unidad", () => {
    for (const a of ["ORDEN", "ORDENES", "CONVOY", "orden"])
      for (const b of ["ORDEN", "ordenes", "convoy", "Orden"])
        expect(convertToSubRecipeUnit(2, a, b), `${a}→${b}`).toEqual({
          ok: true,
          value: 2,
        });
    for (const a of ["ORDEN", "ORDENES", "CONVOY", "orden"])
      for (const b of ["unidad", "unit", "pieza", "each"]) {
        expect(convertToSubRecipeUnit(2, a, b).ok, `${a}→${b}`).toBe(false);
        expect(convertToSubRecipeUnit(2, b, a).ok, `${b}→${a}`).toBe(false);
      }
  });
  it("prices: $0.23/orden is $0.23/ORDEN; $0.23/unidad is NOT a price per orden", () => {
    expect(convertUnitPriceOrPortion(0.23, "ordenes", "ORDEN")).toEqual({
      ok: true,
      value: 0.23,
    });
    expect(convertUnitPriceOrPortion(0.23, "unidad", "ORDEN").ok).toBe(false);
    expect(convertUnitPriceOrPortion(0.892, "CONVOY", "unit").ok).toBe(false);
  });
  it("a portion never converts to weight or volume", () => {
    for (const u of ["oz", "lb", "g", "kg", "ml", "l"]) {
      expect(convertToSubRecipeUnit(1, "ORDEN", u).ok, u).toBe(false);
      expect(convertToSubRecipeUnit(1, u, "CONVOY").ok, u).toBe(false);
      expect(convertUnitPriceOrPortion(1, "ORDENES", u).ok, u).toBe(false);
    }
  });
});

const CO = "co-1";
const ING = [
  { id: "i-guar", name: "Guarniciones de prueba", default_unit: "orden" },
  { id: "i-conv", name: "Convoy de prueba", default_unit: "orden" },
  { id: "i-oz", name: "Salsa de prueba", default_unit: "oz" },
];
const ENTRIES = [
  entry("i-guar", "orden", 0.23),
  entry("i-conv", "orden", 0.892),
  entry("i-oz", "oz", 0.5),
];
function inputs(
  extra: Array<{ id: string; ing: string; qty: number; unit: string }>
) {
  return extra.map((x) => ({
    id: x.id,
    input_type: "ingredient" as const,
    ingredient_id: x.ing,
    component_id: null,
    quantity: x.qty,
    unit: x.unit,
    unit_cost: null,
    cost_source: null,
  }));
}
function editorCtx(lines: ReturnType<typeof inputs>) {
  const state = memoryEditorState({
    ingredients: ING,
    entries: ENTRIES,
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: lines,
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
  });
  return {
    store: createMemoryEditorStore(state),
    companyId: CO,
    odooProductId: 7,
    locationId: null,
    userId: "u1",
  };
}
function economics(lines: ReturnType<typeof inputs>) {
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
  } as never;
  const sales = [
    {
      company_id: CO,
      raw_item_name: "Plato de prueba",
      quantity: 10,
      gross_revenue: 100,
      net_revenue: 100,
      source_metadata: { product_id: 7 },
    },
  ];
  const links = [
    {
      company_id: CO,
      location_id: null,
      odoo_product_id: 7,
      odoo_name: "Plato de prueba",
      classification: "plato_preparado",
      menu_item_id: "m1",
      link_state: "confirmado",
      confirmed_by: null,
      confirmed_at: null,
      confirmed_how: null,
      evidence: {},
    },
  ] as never;
  const versions = [
    {
      id: "v1",
      menu_item_id: "m1",
      version_number: 1,
      status: "approved",
      effective_date: null,
      approved_at: "2026-10-01T10:00:00Z",
    },
  ] as never;
  const list = buildPosProductList({
    companyId: CO,
    sales: sales as never,
    links,
    recipeVersions: [{ menu_item_id: "m1", status: "approved" }] as never,
  });
  const result = buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId: new Map([["v1", lines as never]]),
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
  return result.dishes.find((d) => d.odoo_product_id === 7)!;
}

const GOOD = () =>
  inputs([
    { id: "l1", ing: "i-guar", qty: 2, unit: "ORDEN" },
    { id: "l2", ing: "i-conv", qty: 1, unit: "CONVOY" },
  ]);

describe("a dish with 2 ORDEN × $0.23/orden and 1 CONVOY × $0.892/orden", () => {
  it("the editor costs both lines and the total includes both", async () => {
    const r = await loadEditor(editorCtx(GOOD()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeCloseTo(0.46, 10);
    expect(r.state.lines[1].amount).toBeCloseTo(0.892, 10);
    expect(r.state.total_cost).toBeCloseTo(1.352, 10);
    expect(r.state.lines.every((l) => !l.pending)).toBe(true);
  });
  it("ORDENES costs the same as ORDEN", async () => {
    const r = await loadEditor(
      editorCtx(inputs([{ id: "l1", ing: "i-guar", qty: 2, unit: "ORDENES" }]))
    );
    expect(r.ok && r.state.lines[0].amount).toBeCloseTo(0.46, 10);
  });
  it("dish economics (Cockpit) agrees with the editor: same total, no «Falta precio»", async () => {
    const r = await loadEditor(editorCtx(GOOD()));
    const dish = economics(GOOD());
    expect(dish.lines_missing_price).toBe(0);
    expect(dish.status).toBe("aprobado");
    expect(dish.unit_cost).toBeCloseTo(1.352, 10);
    expect(r.ok && r.state.total_cost).toBeCloseTo(dish.unit_cost!, 10);
    expect(dish.lines.map((l) => l.amount)).toEqual([
      expect.closeTo(0.46, 10),
      expect.closeTo(0.892, 10),
    ]);
  });
  it("the «Falta precio» count drops by 2 compared with before (both lines pending → none)", () => {
    // Before this rule, both lines were unit mismatches. Now only a real mismatch counts.
    const withOz = economics([
      ...GOOD(),
      ...inputs([{ id: "l3", ing: "i-oz", qty: 1, unit: "ORDEN" }]),
    ]);
    expect(withOz.lines_missing_price).toBe(1);
    expect(withOz.unit_cost).toBeNull(); // incomplete: never a partial total, never $0
    expect(economics(GOOD()).lines_missing_price).toBe(0);
  });
});

describe("ORDEN on an oz-priced ingredient", () => {
  const BAD = () => inputs([{ id: "l1", ing: "i-oz", qty: 1, unit: "ORDEN" }]);
  it("is not costed, flagged as a unit problem (not $0)", async () => {
    const r = await loadEditor(editorCtx(BAD()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.state.lines[0];
    expect(line.amount).toBeNull();
    expect(line.pending).toBe(true);
    expect(line.flags).toContain(FLAG_PENDING_UNIT);
    expect(line.price?.unit).toBe("oz");
    expect(r.state.total_cost).toBeNull();
  });
  it("says «Unidad distinta» with the Spanish tooltip", () => {
    expect(UNIT_MISMATCH_LABEL).toBe("Unidad distinta");
    expect(unitMismatchHint("oz", "orden")).toBe(
      "El precio es por oz y la línea usa orden. Cambia una de las dos."
    );
    const src = readFileSync(
      join(
        process.cwd(),
        "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
      ),
      "utf8"
    );
    expect(src).toContain("UNIT_MISMATCH_LABEL");
    expect(src).toMatch(/priceUnitMismatch/);
  });
  it("dish economics counts it as missing, never $0", () => {
    const dish = economics(BAD());
    expect(dish.lines_missing_price).toBe(1);
    expect(dish.unit_cost).toBeNull();
  });
});
