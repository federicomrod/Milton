// An orden is never silently a unidad. Same label (case, accents, plural) is
// 1:1; any other pair the table cannot convert is pending, unless the
// ingredient has its own saved conversion. Synthetic names and prices.
import { describe, expect, it } from "vitest";
import { loadEditor } from "@/lib/restaurant/recipe-costing/editor-service";
import { FLAG_PENDING_UNIT } from "@/lib/restaurant/recipe-costing/editor";
import { mapKitchenUnit, KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import { isUsableLineUnit } from "@/lib/restaurant/units";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

function ctx(opts: {
  priceUnit: string;
  lineUnit: string;
  conversions?: Array<{
    ingredient_id: string;
    from_unit: string;
    to_unit: string;
    factor: number;
  }>;
}) {
  const state = memoryEditorState({
    ingredients: [
      {
        id: "i-g",
        name: "Guarniciones de prueba",
        default_unit: opts.priceUnit,
      },
    ],
    entries: [entry("i-g", opts.priceUnit, 0.23)],
    conversions: opts.conversions,
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [
      {
        id: "l1",
        input_type: "ingredient",
        ingredient_id: "i-g",
        component_id: null,
        quantity: 2,
        unit: opts.lineUnit,
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
  });
  return {
    store: createMemoryEditorStore(state),
    companyId: "co-1",
    odooProductId: 7,
    locationId: null,
    userId: "u1",
  };
}

async function line(o: Parameters<typeof ctx>[0]) {
  const r = await loadEditor(ctx(o));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("editor failed");
  return r.state.lines[0];
}

describe("orden vs unidad in the costing", () => {
  it("$0.23/unidad used as 2 ORDEN: pending, no amount, unit flag, price unit kept", async () => {
    const l = await line({ priceUnit: "unit", lineUnit: "ORDEN" });
    expect(l.amount).toBeNull();
    expect(l.pending).toBe(true);
    expect(l.flags).toContain(FLAG_PENDING_UNIT);
    expect(l.price?.unit).toBe("unit");
  });
  it("orden price used as ORDEN: 1:1", async () => {
    const l = await line({ priceUnit: "orden", lineUnit: "ORDEN" });
    expect(l.amount).toBeCloseTo(0.46, 10);
  });
  it("ordenes price used as ORDEN: 1:1", async () => {
    const l = await line({ priceUnit: "ordenes", lineUnit: "ORDEN" });
    expect(l.amount).toBeCloseTo(0.46, 10);
  });
  it("a saved per-ingredient conversion costs it (1 orden = 3 unidad)", async () => {
    const l = await line({
      priceUnit: "unit",
      lineUnit: "ORDEN",
      conversions: [
        {
          ingredient_id: "i-g",
          from_unit: "orden",
          to_unit: "unit",
          factor: 3,
        },
      ],
    });
    expect(l.amount).toBeCloseTo(2 * 3 * 0.23, 10);
    expect(l.flags).not.toContain(FLAG_PENDING_UNIT);
  });
});

describe("the one unit list", () => {
  it("has exactly the nine units, orden included", () => {
    expect(KITCHEN_UNITS.map((u) => u.value)).toEqual([
      "g",
      "kg",
      "ml",
      "l",
      "pza",
      "unidad",
      "oz",
      "lb",
      "orden",
    ]);
    expect(KITCHEN_UNITS.find((u) => u.value === "pza")?.label).toBe(
      "pza (pieza)"
    );
  });
  it("orden / ordenes / ORDEN map to orden and are valid line units", () => {
    for (const w of ["orden", "ordenes", "ORDEN", "Órdenes"])
      expect(mapKitchenUnit(w)).toBe("orden");
    expect(isUsableLineUnit("orden")).toBe(true);
  });
});
