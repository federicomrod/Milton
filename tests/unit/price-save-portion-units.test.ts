// «Agregar precio» on a portion unit (ORDEN / CONVOY): it saves 1:1, never guessed
// into an ounce; a price that cannot be read in the ingredient's unit is a Spanish
// 400, not «No pude guardar el cambio.»; a merged-away ingredient says so;
// archived ingredients are not offered. Synthetic data.
import { describe, expect, it } from "vitest";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  buildIngredientCostEntryInsert,
  unitMismatchMessage,
} from "@/lib/restaurant/cost-import";
import { convertUnitPriceOrPortion } from "@/lib/restaurant/units";
import {
  createMemoryEditorStore,
  memoryEditorState,
} from "./helpers/memory-editor-store";

function build(unit: string, ingredientUnit: string | null, cost = 0.23513) {
  return buildIngredientCostEntryInsert({
    companyId: "co-1",
    ingredientId: "i-1",
    ingredientDefaultUnit: ingredientUnit,
    supplierId: null,
    row: {
      rowIndex: 0,
      cost_date: "2026-07-01",
      supplier_name: "",
      ingredient_name: "",
      quantity: 1,
      unit,
      total_cost: cost,
      currency: "USD",
      notes: null,
      supplier_item_name: null,
      supplier_sku: null,
    },
  });
}

describe("the cost-entry builder", () => {
  it("ORDEN on an ORDEN ingredient saves 1:1", () => {
    const r = build("ORDEN", "ORDEN");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.insert.normalized_unit_cost).toBe(0.23513);
  });
  it("ORDEN, ORDENES and CONVOY are one portion unit", () => {
    for (const [a, b] of [
      ["ORDEN", "ORDENES"],
      ["ORDENES", "ORDEN"],
      ["CONVOY", "ORDEN"],
      ["PORCIÓN", "PORCIÓN"],
    ]) {
      const r = build(a, b);
      expect(r.ok, `${a}→${b}`).toBe(true);
      if (r.ok) expect(r.insert.normalized_unit_cost).toBe(0.23513);
    }
  });
  it("a portion is never guessed to be an ounce or a unit", () => {
    expect(build("ORDEN", "oz").ok).toBe(false);
    expect(build("ORDEN", "unit").ok).toBe(false);
    expect(build("oz", "ORDEN").ok).toBe(false);
  });
  it("an existing oz / lb conversion is unchanged", () => {
    const r = build("oz", "lb", 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.insert.normalized_unit_cost).toBeCloseTo(16, 6);
    const same = convertUnitPriceOrPortion(2, "lb", "lb");
    expect(same).toEqual({ ok: true, value: 2 });
  });
  it("the Spanish message names both units", () => {
    expect(unitMismatchMessage("ORDEN", "oz")).toBe(
      "No puedo guardar un precio por orden en un ingrediente que se compra por oz. Cambia la unidad de la línea o del ingrediente."
    );
  });
});

function recipe(
  unit: string,
  over: Parameters<typeof memoryEditorState>[0] = {}
) {
  return memoryEditorState({
    ingredients: [{ id: "i-1", name: "Papas", default_unit: unit }],
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [
      {
        id: "in-1",
        input_type: "ingredient",
        ingredient_id: "i-1",
        component_id: null,
        quantity: 2,
        unit,
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
    ...over,
  });
}
const ctxOf = (state: ReturnType<typeof recipe>) => ({
  store: createMemoryEditorStore(state),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});

describe("«Agregar precio» in the recipe editor", () => {
  it("0.23513 /ORDEN on an ORDEN ingredient saves and shows $0.23513/orden", async () => {
    const s = recipe("ORDEN");
    const r = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-1",
      unit: "ORDEN",
      unit_cost: 0.23513,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({
      unit_cost: 0.23513,
      source_type: "manual",
    });
    const line = r.state.lines[0];
    expect(line.amount).toBeCloseTo(2 * 0.23513, 6);
    expect(JSON.stringify(line).toLowerCase()).toContain("orden");
  });
  it("ORDENES typed on an ORDEN ingredient is the same thing", async () => {
    const s = recipe("ORDEN");
    const r = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-1",
      unit: "ORDENES",
      unit_cost: 0.5,
    });
    expect(r.ok).toBe(true);
    expect(s.entries[0].normalized_unit_cost).toBe(0.5);
  });
  it("ORDEN on an oz ingredient is a Spanish 400 and nothing is stored", async () => {
    const s = recipe("oz");
    const r = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-1",
      unit: "ORDEN",
      unit_cost: 0.23513,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toBe(
      "No puedo guardar un precio por orden en un ingrediente que se compra por oz. Cambia la unidad de la línea o del ingrediente."
    );
    expect(s.entries).toHaveLength(0);
  });
  it("the same refusal for a price typed on a line (set_line_cost)", async () => {
    const s = recipe("oz");
    s.inputs[0].unit = "ORDEN";
    const r = await applyEdit(ctxOf(s), {
      action: "set_line_cost",
      input_id: "in-1",
      unit_cost: 0.3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(s.entries).toHaveLength(0);
  });
  it("an ingredient that was merged away answers «se unió con X; recarga la receta»", async () => {
    const s = recipe("lb", {
      merges: [{ loserId: "i-1", survivorName: "Papa blanca" }],
    });
    const r = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-1",
      unit: "lb",
      unit_cost: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(
      "Este ingrediente se unió con Papa blanca; recarga la receta."
    );
    expect(s.entries).toHaveLength(0);
  });
  it("archived ingredients are not offered in the picker, but old lines still read them", async () => {
    const s = recipe("lb", {
      ingredients: [
        { id: "i-1", name: "Papas", default_unit: "lb", archived: true },
        { id: "i-2", name: "Papa blanca", default_unit: "lb" },
      ],
    });
    const r = await loadEditor(ctxOf(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.state.options.map((o) => o.name);
    expect(names).toContain("Papa blanca");
    expect(names).not.toContain("Papas");
    expect(r.state.lines[0].name).toBe("Papas");
  });
});
