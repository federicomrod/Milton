// A price set once for an ingredient applies everywhere until a new one is set;
// it can be set on an APPROVED recipe or preparation (it is ingredient data) and
// never changes the version. A preparation costs as soon as its lines are priced.
// Synthetic names and prices only.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { es } from "@/lib/i18n/es";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const ING = [
  { id: "i-chimi", name: "Chimicurri de prueba", default_unit: "oz" },
];
/** CONVOY (yield 1 orden) = CHIMICURRI 2 onza, approved, with an OLD price copy on the line. */
function kitchen(sharedEntries: ReturnType<typeof entry>[] = []) {
  const lines = [
    {
      id: "pin-1",
      input_type: "ingredient" as const,
      ingredient_id: "i-chimi",
      component_id: null,
      quantity: 2,
      unit: "onza",
      unit_cost: 0.11,
      cost_source: "SUB RECETAS!E8",
    },
  ];
  return memoryEditorState({
    ingredients: ING,
    entries: sharedEntries,
    components: [
      { id: "c-convoy", name: "Convoy de prueba", output_unit: "orden" },
    ],
    componentRecipes: [
      {
        id: "cr1",
        component_id: "c-convoy",
        output_quantity: 1,
        output_unit: "orden",
      },
    ],
    componentInputs: [],
    preparations: [
      {
        component_id: "c-convoy",
        name: "Convoy de prueba",
        version: {
          id: "cv1",
          status: "approved",
          kind: "preparation",
          component_id: "c-convoy",
          component_recipe_id: "cr1",
          output_quantity: 1,
          output_unit: "orden",
        },
        inputs: lines,
        holder: null,
      },
    ],
    version: { id: "v8", status: "approved", kind: "dish", menu_item_id: "m8" },
    inputs: [
      {
        id: "in-convoy",
        input_type: "component",
        ingredient_id: null,
        component_id: "c-convoy",
        quantity: 1,
        unit: "orden",
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-8", menu_item_id: "m8", evidence: {} },
  });
}
const prepCtx = (s: ReturnType<typeof kitchen>) => ({
  store: createMemoryEditorStore(s),
  companyId: "co-1",
  odooProductId: 8,
  componentId: "c-convoy",
  locationId: null,
  userId: "u1",
});
const dishCtx = (s: ReturnType<typeof kitchen>) => ({
  store: createMemoryEditorStore(s),
  companyId: "co-1",
  odooProductId: 8,
  locationId: null,
  userId: "u1",
});

describe("approved preparation CONVOY with an unpriced ingredient line", () => {
  it("the line is Sin precio with the old copy offered; the preparation has no total", async () => {
    const s = kitchen();
    const r = await loadEditor(prepCtx(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.editable).toBe(false);
    const l = r.state.lines[0];
    expect(l.amount).toBeNull();
    expect(l.legacy_price).toEqual({ unit_cost: 0.11, unit: "onza" });
    expect(r.state.total_cost).toBeNull();
  });

  it("set_price $0.11/onza → ONE new cost entry, the version and its lines unchanged, CONVOY total known", async () => {
    const s = kitchen();
    const versionBefore = JSON.stringify(s.preparations[0].version);
    const inputsBefore = JSON.stringify(s.preparations[0].inputs);
    const r = await applyEdit(prepCtx(s), {
      action: "set_price",
      ingredient_id: "i-chimi",
      unit: "onza",
      unit_cost: 0.11,
    });
    expect(r.ok).toBe(true);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({
      source_type: "manual",
      normalized_unit_cost: 0.11,
    });
    expect(JSON.stringify(s.preparations[0].version)).toBe(versionBefore);
    expect(JSON.stringify(s.preparations[0].inputs)).toBe(inputsBefore);
    if (r.ok) expect(r.state.total_cost).toBeCloseTo(0.22, 10);
  });

  it("«Usar precio antiguo» (adopt_legacy) on the approved preparation gives the same result", async () => {
    const s = kitchen();
    const l = await loadEditor(prepCtx(s));
    if (!l.ok) throw new Error("no state");
    const legacy = l.state.lines[0].legacy_price!;
    const r = await applyEdit(prepCtx(s), {
      action: "set_price",
      ingredient_id: "i-chimi",
      unit: legacy.unit,
      unit_cost: legacy.unit_cost,
      adopt_legacy: true,
    });
    expect(r.ok).toBe(true);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].notes).toBe("Adoptado del precio de línea");
    if (r.ok) expect(r.state.total_cost).toBeCloseTo(0.22, 10);
  });
});

describe("a dish with CONVOY 1 orden", () => {
  it("says what is missing in the preparation, not «aprueba primero»", async () => {
    const s = kitchen();
    const r = await loadEditor(dishCtx(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.state.lines[0];
    expect(line.amount).toBeNull();
    expect(line.component_missing).toEqual(["Chimicurri de prueba"]);
    const ui = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    const lines = es.menu.editor.lines;
    expect(ui).toContain("d.lines.prepNoCostMissing");
    expect(lines.prepNoCostMissing).toContain(
      "no tiene costo todavía: falta precio en"
    );
    expect(ui).not.toContain("Aprueba primero la preparación");
    expect(JSON.stringify(lines)).not.toContain(
      "Aprueba primero la preparación"
    );
    expect(ui).toContain("d.lines.orTypePrice");
    expect(lines.orTypePrice).toBe("O escribe aquí el precio de esta línea.");
  });

  it("once the ingredient has a price the line costs from CONVOY automatically, and another dish updates in the same reload", async () => {
    const shared: ReturnType<typeof entry>[] = [];
    const dishA = kitchen(shared);
    const dishB = kitchen(shared);
    dishB.version = {
      id: "v9",
      status: "approved",
      kind: "dish",
      menu_item_id: "m9",
    };
    dishB.link = { id: "link-9", menu_item_id: "m9", evidence: {} };
    // the price is set ONCE, from the preparation (or from any dish)
    const set = await applyEdit(prepCtx(dishA), {
      action: "set_price",
      ingredient_id: "i-chimi",
      unit: "onza",
      unit_cost: 0.11,
    });
    expect(set.ok).toBe(true);
    for (const s of [dishA, dishB]) {
      const r = await loadEditor(dishCtx(s));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.state.lines[0].pending).toBe(false);
      expect(r.state.lines[0].amount).toBeCloseTo(0.22, 10); // 1 orden × CONVOY
      expect(r.state.total_cost).toBeCloseTo(0.22, 10); // header = live total
    }
  });

  it("a preparation that is still in review costs too (approval does not gate cost)", async () => {
    const s = kitchen([entry("i-chimi", "oz", 0.11)]);
    s.preparations[0].version!.status = "in_review";
    const r = await loadEditor(dishCtx(s));
    expect(r.ok && r.state.lines[0].amount).toBeCloseTo(0.22, 10);
  });
});

describe("what stays locked on an approved version, and what never is", () => {
  it("a quantity or unit change is 409; a price change is allowed", async () => {
    const s = kitchen();
    const qty = await applyEdit(prepCtx(s), {
      action: "update",
      input_id: "pin-1",
      quantity: 3,
    });
    expect(qty.ok).toBe(false);
    if (!qty.ok) expect(qty.status).toBe(409);
    const unit = await applyEdit(prepCtx(s), {
      action: "update",
      input_id: "pin-1",
      unit: "lb",
    });
    expect(unit.ok).toBe(false);
    if (!unit.ok) expect(unit.status).toBe(409);
    const line = await applyEdit(prepCtx(s), {
      action: "set_line_cost",
      input_id: "pin-1",
      unit_cost: 0.2,
    });
    expect(line.ok).toBe(false);
    const price = await applyEdit(prepCtx(s), {
      action: "set_price",
      ingredient_id: "i-chimi",
      unit: "onza",
      unit_cost: 0.11,
    });
    expect(price.ok).toBe(true);
    expect(s.preparations[0].inputs[0]).toMatchObject({
      quantity: 2,
      unit: "onza",
    });
  });
  it("the server guard skips set_price and answer_catalog_unit on approved versions (pinned)", () => {
    const src = read("lib/restaurant/recipe-costing/editor-service.ts");
    expect(src).toMatch(
      /action\.action !== "set_price" &&\s*action\.action !== "answer_catalog_unit"/
    );
    // the preparation editor goes through the SAME applyEdit (one guard)
    expect(read("app/api/restaurant/recipes/editor/route.ts")).toContain(
      "applyEdit("
    );
  });
});

describe("a likely typo of a preparation is only a hint", () => {
  it("«¿Es CHIMICHURRI (preparación)?» next to CHIMICURRI; nothing is changed", async () => {
    const s = memoryEditorState({
      ingredients: [{ id: "i-x", name: "Chimicurri", default_unit: "oz" }],
      entries: [],
      components: [{ id: "c-chim", name: "Chimichurri", output_unit: "oz" }],
      version: {
        id: "v1",
        status: "approved",
        kind: "dish",
        menu_item_id: "m1",
      },
      inputs: [
        {
          id: "l1",
          input_type: "ingredient",
          ingredient_id: "i-x",
          component_id: null,
          quantity: 2,
          unit: "oz",
          unit_cost: null,
          cost_source: null,
        },
      ],
      link: { id: "link-1", menu_item_id: "m1", evidence: {} },
    });
    const before = JSON.stringify(s.inputs);
    const r = await loadEditor(dishCtx(s as never));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].name_hint).toEqual({
      name: "Chimichurri",
      kind: "component",
    });
    expect(JSON.stringify(s.inputs)).toBe(before);
  });
});
