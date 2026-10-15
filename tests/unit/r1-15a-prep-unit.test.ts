// R1-15a: an APPROVED preparation (CONVOY, yields in "orden") must be usable
// in every dish. Used to read "approve it first" because the unit "orden"
// could not be converted to anything, even to itself. Synthetic data only.

import { describe, expect, it } from "vitest";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  convertToSubRecipeUnit,
  isUsableLineUnit,
} from "@/lib/restaurant/units";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

function kitchen(lineUnit: string, prepUnit = "orden") {
  return memoryEditorState({
    ingredients: [{ id: "i-frijol", name: "Frijol", default_unit: "oz" }],
    entries: [entry("i-frijol", "oz", 0.1)],
    components: [{ id: "c-convoy", name: "Convoy", output_unit: prepUnit }],
    componentRecipes: [
      {
        id: "cr1",
        component_id: "c-convoy",
        output_quantity: 1,
        output_unit: prepUnit,
      },
    ],
    componentInputs: [
      {
        component_recipe_id: "cr1",
        ingredient_id: "i-frijol",
        quantity: 10,
        unit: "oz",
      },
    ],
    preparations: [
      {
        component_id: "c-convoy",
        name: "Convoy",
        version: {
          id: "cv1",
          status: "approved",
          kind: "preparation",
          component_id: "c-convoy",
          component_recipe_id: "cr1",
          output_quantity: 1,
          output_unit: prepUnit,
        },
        inputs: [
          {
            id: "pin-1",
            input_type: "ingredient",
            ingredient_id: "i-frijol",
            component_id: null,
            quantity: 10,
            unit: "oz",
          },
        ],
        holder: null,
      },
    ],
    version: {
      id: "v8",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m8",
    },
    inputs: [
      {
        id: "in-convoy",
        input_type: "component",
        ingredient_id: null,
        component_id: "c-convoy",
        quantity: 1,
        unit: lineUnit,
      },
    ],
    link: { id: "link-8", menu_item_id: "m8", evidence: {} },
  });
}
const ctx = (s: ReturnType<typeof kitchen>) => ({
  store: createMemoryEditorStore(s),
  companyId: "co-1",
  odooProductId: 8,
  locationId: null,
  userId: "u1",
});

describe("units of a preparation", () => {
  it("the label it yields in needs no conversion; CONVOY and ORDEN are the same thing; nothing is guessed", () => {
    expect(convertToSubRecipeUnit(2, "orden", "orden")).toEqual({
      ok: true,
      value: 2,
    });
    expect(convertToSubRecipeUnit(2, "ORDEN", "orden")).toEqual({
      ok: true,
      value: 2,
    });
    expect(convertToSubRecipeUnit(2, "convoy", "orden")).toEqual({
      ok: true,
      value: 2,
    });
    expect(convertToSubRecipeUnit(3, "lb", "oz")).toMatchObject({
      ok: true,
      value: 48,
    });
    // A portion is a count: 1 orden = 1 unidad. Never an ounce or any weight.
    expect(convertToSubRecipeUnit(1, "portion", "orden").ok).toBe(false);
    expect(convertToSubRecipeUnit(1, "unit", "orden")).toEqual({
      ok: true,
      value: 1,
    });
    expect(convertToSubRecipeUnit(1, "oz", "orden").ok).toBe(false);
  });

  it("a person may pick the sub-recipe label as a line unit", () => {
    expect(isUsableLineUnit("orden")).toBe(true);
    expect(isUsableLineUnit("convoy")).toBe(true);
    expect(isUsableLineUnit("oz")).toBe(true);
    expect(isUsableLineUnit("florb")).toBe(false);
  });
});

describe("a dish line that uses an approved preparation", () => {
  it("in the preparation's own unit it is costed (the 6 oz case that worked, and the 8 oz that did not)", async () => {
    const r = await loadEditor(ctx(kitchen("orden")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeCloseTo(1.0, 6); // 10 oz × 0.10
    expect(r.state.lines[0].pending).toBe(false);
  });

  it("in another unit it stays Pendiente for a UNIT reason, not 'approve it first', and offers the prep's unit", async () => {
    const r = await loadEditor(ctx(kitchen("portion")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.state.lines[0];
    expect(line.amount).toBeNull();
    expect(line.flags).toContain("pendiente_unidad");
    expect(line.component_unit).toBe("orden");
  });

  it("choosing the preparation's unit fixes the line (the server accepts 'orden')", async () => {
    const s = kitchen("portion");
    const r = await applyEdit(ctx(s), {
      action: "update",
      input_id: "in-convoy",
      unit: "orden",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeCloseTo(1.0, 6);
    expect(s.inputs[0].unit).toBe("orden");
  });

  it("a preparation that is not approved still reads as waiting for approval", async () => {
    const s = kitchen("orden");
    s.preparations[0].version!.status = "in_review";
    const r = await loadEditor(ctx(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeNull();
    expect(r.state.lines[0].flags).not.toContain("pendiente_unidad");
  });
});
