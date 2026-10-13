// Preparaciones: edit a preparation draft, confirm its yield, approve it,
// and see dishes that use it pick up the cost. Synthetic data only.

import { describe, expect, it } from "vitest";
import { parseEditorAction } from "@/lib/restaurant/recipe-costing/editor-actions";
import {
  applyEdit,
  approvePreparation,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
  type MemoryEditorState,
} from "./helpers/memory-editor-store";

function kitchen(): MemoryEditorState {
  return memoryEditorState({
    ingredients: [
      { id: "i-tomate", name: "Tomate", default_unit: "oz" },
      { id: "i-sal", name: "Sal", default_unit: "oz" },
      { id: "i-carne", name: "Carne", default_unit: "oz" },
    ],
    entries: [
      entry("i-tomate", "oz", 0.04),
      entry("i-sal", "oz", 0.01),
      entry("i-carne", "oz", 0.5),
    ],
    components: [{ id: "c-salsa", name: "Salsa roja", output_unit: "oz" }],
    preparations: [
      {
        component_id: "c-salsa",
        name: "Salsa roja",
        version: {
          id: "cv1",
          status: "in_review",
          kind: "preparation",
          component_id: "c-salsa",
          component_recipe_id: "cr1",
          output_quantity: 1,
          output_unit: "unit",
        },
        inputs: [
          {
            id: "pin-1",
            input_type: "ingredient",
            ingredient_id: "i-tomate",
            component_id: null,
            quantity: 16,
            unit: "oz",
          },
        ],
        holder: {
          id: "rev-1",
          evidence: {
            kind: "preparation_draft",
            component_id: "c-salsa",
            yield: {
              value: 1,
              unit: "unit",
              source: "assumed",
              confirmed: false,
            },
            lines: [
              {
                raw_name: "TOMATE",
                qty: 16,
                unit: "oz",
                pending: false,
                resolved: {
                  kind: "ingredient",
                  id: "i-tomate",
                  name: "Tomate",
                },
              },
              {
                raw_name: "SAL MARINA",
                qty: 1,
                unit: "oz",
                pending: true,
                resolved: null,
                reasons: [],
              },
            ],
          },
        },
      },
    ],
    // A dish that uses the preparation.
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [
      {
        id: "in-carne",
        input_type: "ingredient",
        ingredient_id: "i-carne",
        component_id: null,
        quantity: 6,
        unit: "oz",
      },
      {
        id: "in-salsa",
        input_type: "component",
        ingredient_id: null,
        component_id: "c-salsa",
        quantity: 2,
        unit: "oz",
      },
    ],
    link: {
      id: "link-1",
      menu_item_id: "m1",
      evidence: {
        yield: { value: 1, unit: "porción", source: "excel" },
        lines: [],
      },
    },
  });
}

const prep = (s: MemoryEditorState, companyId = "co-1") => ({
  store: createMemoryEditorStore(s),
  companyId,
  odooProductId: 0,
  locationId: null,
  componentId: "c-salsa",
  userId: "u1",
});
const dish = (s: MemoryEditorState) => ({
  store: createMemoryEditorStore(s),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});

describe("a preparation in the editor", () => {
  it("shows its lines, the open one, the suggested yield and a checklist", async () => {
    const r = await loadEditor(prep(kitchen()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.state.preparation!;
    expect(p.name).toBe("Salsa roja");
    expect(p.status).toBe("in_review");
    expect(p.yield).toMatchObject({ value: 1, unit: "unit", confirmed: false });
    expect(r.state.lines.map((l) => [l.kind, l.raw_name])).toEqual([
      ["ingredient", "TOMATE"],
      ["unresolved", "SAL MARINA"],
    ]);
    expect(p.checklist.ready).toBe(false);
    expect(p.checklist.blockers).toEqual(
      expect.arrayContaining([
        "Hay líneas que todavía no están en tu lista.",
        "Confirma cuánto rinde.",
      ])
    );
    // It never offers itself as one of its own lines.
    expect(r.state.options.some((o) => o.id === "c-salsa")).toBe(false);
  });

  it("edits go to the preparation's own version", async () => {
    const s = kitchen();
    const r = await applyEdit(prep(s), {
      action: "update",
      input_id: "pin-1",
      quantity: 20,
    });
    expect(r.ok).toBe(true);
    expect(s.preparations[0].inputs[0].quantity).toBe(20);
    expect(s.inputs.find((i) => i.id === "in-carne")?.quantity).toBe(6); // the dish is untouched
  });

  it("confirms the yield on the version and in its open item", async () => {
    const s = kitchen();
    const r = await applyEdit(prep(s), {
      action: "set_yield",
      quantity: 32,
      unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(s.preparations[0].version).toMatchObject({
      output_quantity: 32,
      output_unit: "oz",
    });
    expect(s.preparations[0].holder!.evidence.yield).toMatchObject({
      value: 32,
      unit: "oz",
      confirmed: true,
    });
    if (r.ok)
      expect(r.state.preparation!.yield).toMatchObject({
        confirmed: true,
        value: 32,
      });
  });

  it("refuses a yield on a dish and a bad yield", async () => {
    const s = kitchen();
    expect(
      (
        await applyEdit(dish(s), {
          action: "set_yield",
          quantity: 2,
          unit: "oz",
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await applyEdit(prep(s), {
          action: "set_yield",
          quantity: 0,
          unit: "oz",
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await applyEdit(prep(s), {
          action: "set_yield",
          quantity: 2,
          unit: "parsec",
        })
      ).ok
    ).toBe(false);
    expect(s.preparations[0].version!.output_quantity).toBe(1);
  });
});

describe("approving a preparation", () => {
  async function ready(s: MemoryEditorState) {
    const state = await loadEditor(prep(s));
    const sal = state.ok
      ? state.state.lines.find((l) => l.kind === "unresolved")!
      : null;
    await applyEdit(prep(s), {
      action: "resolve",
      line_key: sal!.key,
      kind: "ingredient",
      id: "i-sal",
    });
    await applyEdit(prep(s), { action: "set_yield", quantity: 16, unit: "oz" });
  }

  it("is refused while the checklist is open", async () => {
    const s = kitchen();
    const r = await approvePreparation(prep(s));
    expect(r.ok).toBe(false);
    expect(s.preparations[0].version!.status).toBe("in_review");
  });

  it("approves once lines, prices and yield are settled, and closes the open item", async () => {
    const s = kitchen();
    await ready(s);
    const r = await approvePreparation(prep(s));
    expect(r.ok).toBe(true);
    expect(s.preparations[0].version!.status).toBe("approved");
    expect(s.preparations[0].resolved).toBe(true);
    if (r.ok) {
      expect(r.state.editable).toBe(false);
      // (16 oz × 0.04 + 1 oz × 0.01) / 16 oz
      expect(r.state.preparation!.cost_per_output_unit).toBeCloseTo(
        0.040625,
        6
      );
    }
    // Approving twice is refused.
    expect((await approvePreparation(prep(s))).ok).toBe(false);
  });

  it("gives the dish that uses it a cost for that line, right away", async () => {
    const s = kitchen();
    const before = await loadEditor(dish(s));
    const salsaBefore = before.ok
      ? before.state.lines.find((l) => l.kind === "component")
      : null;
    expect(salsaBefore?.amount).toBeNull(); // a draft counts nowhere

    await ready(s);
    const r = await approvePreparation(prep(s));
    expect(r.ok && r.refreshed_dishes).toBe(1);

    const after = await loadEditor(dish(s));
    const salsa = after.ok
      ? after.state.lines.find((l) => l.kind === "component")
      : null;
    expect(salsa?.amount).toBeCloseTo(2 * 0.040625, 6);
    // The dish's cached evidence was rebuilt with the new cost.
    expect(s.link!.evidence.milton_cost as number).toBeCloseTo(
      6 * 0.5 + 2 * 0.040625,
      6
    );
  });

  it("does not see another company's preparation", async () => {
    const r = await loadEditor(prep(kitchen(), "co-2"));
    expect(r.ok).toBe(false);
  });
});

describe("parsing", () => {
  it("accepts set_yield", () => {
    expect(
      parseEditorAction({ action: "set_yield", quantity: 3, unit: "oz" })
    ).toEqual({
      action: "set_yield",
      quantity: 3,
      unit: "oz",
    });
    expect(parseEditorAction({ action: "set_yield", unit: "oz" })).toBeNull();
  });
});
