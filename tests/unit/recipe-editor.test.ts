// Validar editor: edits go to the version's inputs by id, nothing is
// created from a typed name, and the cached evidence is rebuilt from the
// inputs. Synthetic names and prices only.

import { describe, expect, it } from "vitest";
import { parseEditorAction } from "@/lib/restaurant/recipe-costing/editor-actions";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
  type MemoryEditorState,
} from "./helpers/memory-editor-store";

const ctx = (state: MemoryEditorState, companyId = "co-1") => ({
  store: createMemoryEditorStore(state),
  companyId,
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});

function line(over: Record<string, unknown>) {
  return {
    source_row: null,
    raw_name: "x",
    ingredient_match: null,
    sub_recipe_match: null,
    qty: 1,
    unit: "oz",
    unit_cost: null,
    pending: false,
    flags: [],
    reasons: [],
    ...over,
  };
}

/** A draft with one resolved line, one typo'd line, one unpriced line. */
function draft(): MemoryEditorState {
  return memoryEditorState({
    ingredients: [
      { id: "i-harina", name: "Harina", default_unit: "oz" },
      { id: "i-queso", name: "Queso fresco", default_unit: "oz" },
      { id: "i-sal", name: "Sal fina", default_unit: "oz" },
    ],
    entries: [
      entry("i-harina", "oz", 0.1),
      entry("i-queso", "oz", 0.2),
      // Sal fina has no price yet.
    ],
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [
      {
        id: "in-seed",
        input_type: "ingredient",
        ingredient_id: "i-harina",
        component_id: null,
        quantity: 4,
        unit: "oz",
      },
    ],
    link: {
      id: "link-1",
      menu_item_id: "m1",
      evidence: {
        excel_total: 1.4,
        yield: { value: 1, unit: "porción", source: "confirmed" },
        lines: [
          line({
            raw_name: "HARINA",
            ingredient_match: "Harina",
            qty: 4,
            source_row: 8,
          }),
          line({
            raw_name: "QUESO FRSCO",
            qty: 2,
            pending: true,
            flags: ["pendiente_ingrediente"],
            source_row: 9,
          }),
          line({
            raw_name: "SAL",
            ingredient_match: "Sal fina",
            qty: 1,
            pending: true,
            flags: ["pendiente_costo"],
            source_row: 10,
          }),
        ],
      },
    },
  });
}

async function state(s: MemoryEditorState) {
  const r = await loadEditor(ctx(s));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("loadEditor", () => {
  it("shows resolved lines with live prices and unresolved lines with a proposal", async () => {
    const s = await state(draft());
    expect(s.editable).toBe(true);
    const harina = s.lines.find((l) => l.name === "Harina")!;
    expect(harina).toMatchObject({
      kind: "ingredient",
      qty: 4,
      unit: "oz",
      raw_name: "HARINA",
      source_row: 8,
    });
    expect(harina.amount).toBeCloseTo(0.4, 6);
    expect(harina.price).toMatchObject({
      unit: "oz",
      unit_cost: 0.1,
      source: "lista",
    });

    const typo = s.lines.find(
      (l) => l.kind === "unresolved" && l.raw_name === "QUESO FRSCO"
    )!;
    expect(typo.pending).toBe(true);
    expect(typo.possible_match).toMatchObject({
      kind: "ingredient",
      name: "Queso fresco",
    });
    // A proposal only: nothing is applied until a person picks.
    expect(typo.ingredient_id).toBeNull();
    expect(s.pending).toBe(2);
  });

  it("offers a remembered alias as a proposal too", async () => {
    const d = draft();
    d.aliases.push({
      key: "SAL",
      name: "SAL",
      ingredient_id: "i-sal",
      by: "u0",
    });
    const s = await state(d);
    const sal = s.lines.find((l) => l.raw_name === "SAL")!;
    expect(sal.possible_match).toMatchObject({ name: "Sal fina" });
  });

  it("offers a picker over ingredients and preparations with price and unit", async () => {
    const d = draft();
    d.components.push({
      id: "c-salsa",
      name: "Salsa casera",
      output_unit: "oz",
    });
    d.componentRecipes.push({
      id: "cr1",
      component_id: "c-salsa",
      output_quantity: 10,
      output_unit: "oz",
    });
    d.componentInputs.push({
      component_recipe_id: "cr1",
      ingredient_id: "i-harina",
      quantity: 10,
      unit: "oz",
    });
    const s = await state(d);
    const names = s.options.map((o) => [o.kind, o.name]);
    expect(names).toEqual(
      expect.arrayContaining([
        ["ingredient", "Harina"],
        ["component", "Salsa casera"],
      ])
    );
    const harina = s.options.find((o) => o.name === "Harina")!;
    expect(harina).toMatchObject({
      unit: "oz",
      unit_cost: 0.1,
      price_date: "2026-04-01",
    });
    const prep = s.options.find((o) => o.name === "Salsa casera")!;
    expect(prep.unit_cost).toBeCloseTo(0.1, 6);
    expect(s.options.find((o) => o.name === "Sal fina")!.unit_cost).toBeNull();
  });

  it("does not see another company's recipe", async () => {
    const r = await loadEditor(ctx(draft(), "co-2"));
    expect(r.ok).toBe(false);
  });
});

describe("resolving a line", () => {
  it("adds the ingredient to the recipe's inputs, so approval includes it", async () => {
    const d = draft();
    const before = await state(d);
    const typo = before.lines.find((l) => l.raw_name === "QUESO FRSCO")!;
    const r = await applyEdit(ctx(d), {
      action: "resolve",
      line_key: typo.key,
      kind: "ingredient",
      id: "i-queso",
    });
    expect(r.ok).toBe(true);
    // The recipe itself now has the line (this is what gets approved).
    expect(d.inputs.map((i) => [i.ingredient_id, i.quantity, i.unit])).toEqual([
      ["i-harina", 4, "oz"],
      ["i-queso", 2, "oz"],
    ]);
    // No ingredient was created.
    expect(d.ingredients).toHaveLength(3);
    // Remembered for next time.
    expect(d.aliases).toEqual([
      expect.objectContaining({
        name: "QUESO FRSCO",
        ingredient_id: "i-queso",
        by: "u1",
      }),
    ]);
    // Evidence follows: that line is no longer pending.
    const lines = d.link!.evidence.lines as Array<Record<string, unknown>>;
    expect(lines.find((l) => l.raw_name === "QUESO FRSCO")).toMatchObject({
      pending: false,
      ingredient_match: "Queso fresco",
    });
  });

  it("still resolves when the alias table is not there yet", async () => {
    const d = draft();
    d.failAlias = true;
    const typo = (await state(d)).lines.find(
      (l) => l.raw_name === "QUESO FRSCO"
    )!;
    const r = await applyEdit(ctx(d), {
      action: "resolve",
      line_key: typo.key,
      kind: "ingredient",
      id: "i-queso",
    });
    expect(r.ok).toBe(true);
    expect(d.inputs).toHaveLength(2);
  });

  it("rejects an item that is not in the company's list", async () => {
    const d = draft();
    const typo = (await state(d)).lines.find(
      (l) => l.raw_name === "QUESO FRSCO"
    )!;
    const r = await applyEdit(ctx(d), {
      action: "resolve",
      line_key: typo.key,
      kind: "ingredient",
      id: "someone-elses",
    });
    expect(r.ok).toBe(false);
    expect(d.inputs).toHaveLength(1);
  });
});

describe("editing by id", () => {
  it("a quantity or unit edit reaches the recipe and the cost", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "update",
      input_id: "in-seed",
      quantity: 6,
      unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(d.inputs[0].quantity).toBe(6);
    const harina = (r.ok ? r.state.lines : []).find(
      (l) => l.name === "Harina"
    )!;
    expect(harina.amount).toBeCloseTo(0.6, 6);
  });

  it("refuses a bad quantity, a bad unit and an unknown line", async () => {
    const d = draft();
    expect(
      (
        await applyEdit(ctx(d), {
          action: "update",
          input_id: "in-seed",
          quantity: 0,
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await applyEdit(ctx(d), {
          action: "update",
          input_id: "in-seed",
          unit: "parsec",
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await applyEdit(ctx(d), {
          action: "update",
          input_id: "nope",
          quantity: 1,
        })
      ).ok
    ).toBe(false);
    expect(d.inputs[0]).toMatchObject({ quantity: 4, unit: "oz" });
  });

  it("changes which item a line points to, and keeps the cache in step", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "change_item",
      input_id: "in-seed",
      kind: "ingredient",
      id: "i-queso",
    });
    expect(r.ok).toBe(true);
    expect(d.inputs[0].ingredient_id).toBe("i-queso");
    const first = (d.link!.evidence.lines as Array<Record<string, unknown>>)[0];
    expect(first.ingredient_match).toBe("Queso fresco");
  });

  it("removes a resolved line and an unresolved one", async () => {
    const d = draft();
    const s = await state(d);
    const typo = s.lines.find((l) => l.raw_name === "QUESO FRSCO")!;
    expect(
      (await applyEdit(ctx(d), { action: "remove", line_key: typo.key })).ok
    ).toBe(true);
    expect(
      (await applyEdit(ctx(d), { action: "remove", line_key: "in-seed" })).ok
    ).toBe(true);
    expect(d.inputs).toHaveLength(0);
    const names = (
      d.link!.evidence.lines as Array<Record<string, unknown>>
    ).map((l) => l.raw_name);
    expect(names).toEqual(["SAL"]);
  });

  it("adds a catalog item as a new line", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "add",
      kind: "ingredient",
      id: "i-queso",
      quantity: 3,
      unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(d.inputs.at(-1)).toMatchObject({
      ingredient_id: "i-queso",
      quantity: 3,
      unit: "oz",
    });
  });
});

describe("rebuilding what approval reads", () => {
  it("clears pending, totals the cost and compares with the Excel once everything is resolved", async () => {
    const d = draft();
    d.entries.push(entry("i-sal", "oz", 0.05));
    const s = await state(d);
    await applyEdit(ctx(d), {
      action: "resolve",
      line_key: s.lines.find((l) => l.raw_name === "QUESO FRSCO")!.key,
      kind: "ingredient",
      id: "i-queso",
    });
    // The unpriced line is resolved to Sal fina, which has a price now.
    const s2 = await state(d);
    await applyEdit(ctx(d), {
      action: "resolve",
      line_key: s2.lines.find((l) => l.raw_name === "SAL")!.key,
      kind: "ingredient",
      id: "i-sal",
    });
    const ev = d.link!.evidence;
    expect(ev.pending).toBe(false);
    expect(ev.status).toBe("lista_para_aprobar");
    // 4 oz × 0.10 + 2 oz × 0.20 + 1 oz × 0.05
    expect(ev.milton_cost as number).toBeCloseTo(0.85, 6);
    expect(ev.excel_match).toBe("mismatch"); // Excel said 1.40: informational only
  });

  it("keeps the recipe a draft while any line is pending or the yield is assumed", async () => {
    const d = draft();
    await applyEdit(ctx(d), {
      action: "update",
      input_id: "in-seed",
      quantity: 5,
    });
    expect(d.link!.evidence.pending).toBe(true);
    expect(d.link!.evidence.status).toBe("borrador");
    expect(d.link!.evidence.milton_cost).toBeNull();
  });
});

describe("explicit ingredient creation", () => {
  it("creates only when asked, with a unit, and refuses a duplicate", async () => {
    const d = draft();
    const dup = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "  harina ",
      unit: "oz",
    });
    expect(dup.ok).toBe(false);
    expect(d.ingredients).toHaveLength(3);

    const noUnit = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Comino",
      unit: "parsec",
    });
    expect(noUnit.ok).toBe(false);
    expect(d.ingredients).toHaveLength(3);

    const ok = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Comino",
      unit: "oz",
      unit_cost: 0.3,
    });
    expect(ok.ok).toBe(true);
    const created = d.ingredients.at(-1)!;
    expect(created.name).toBe("Comino");
    const price = d.entries.find((e) => e.ingredient_id === created.id)!;
    expect(price).toMatchObject({
      source_type: "manual",
      date_source: "manual",
      currency: "USD",
    });
  });

  it("can create the ingredient straight from an unresolved line and remembers the name", async () => {
    const d = draft();
    const typo = (await state(d)).lines.find(
      (l) => l.raw_name === "QUESO FRSCO"
    )!;
    const r = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Queso de la casa",
      unit: "oz",
      unit_cost: 0.25,
      line_key: typo.key,
    });
    expect(r.ok).toBe(true);
    const created = d.ingredients.at(-1)!;
    expect(d.inputs.at(-1)).toMatchObject({
      ingredient_id: created.id,
      quantity: 2,
      unit: "oz",
    });
    expect(d.aliases[0]).toMatchObject({
      name: "QUESO FRSCO",
      ingredient_id: created.id,
    });
  });

  it("rejects a price of zero or less", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Comino",
      unit: "oz",
      unit_cost: 0,
    });
    expect(r.ok).toBe(false);
    expect(d.ingredients).toHaveLength(3);
  });
});

describe("prices", () => {
  it("sets a price on an existing ingredient only, never creating one", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "set_price",
      ingredient_id: "i-sal",
      unit: "oz",
      unit_cost: 0.07,
    });
    expect(r.ok).toBe(true);
    expect(d.ingredients).toHaveLength(3);
    expect(d.entries.find((e) => e.ingredient_id === "i-sal")).toMatchObject({
      unit_cost: 0.07,
      source_type: "manual",
    });
    const missing = await applyEdit(ctx(d), {
      action: "set_price",
      ingredient_id: "ghost",
      unit: "oz",
      unit_cost: 1,
    });
    expect(missing.ok).toBe(false);
    expect(d.ingredients).toHaveLength(3);
  });
});

describe("an approved recipe is read-only", () => {
  it("locks every line edit and says why, but still allows a price", async () => {
    const d = draft();
    d.version = {
      id: "v1",
      status: "approved",
      kind: "dish",
      menu_item_id: "m1",
    };
    const s = await state(d);
    expect(s.editable).toBe(false);
    expect(s.locked_reason).toMatch(/aprobada/);
    for (const action of [
      { action: "update", input_id: "in-seed", quantity: 9 },
      {
        action: "add",
        kind: "ingredient",
        id: "i-queso",
        quantity: 1,
        unit: "oz",
      },
      { action: "remove", line_key: "in-seed" },
    ] as const) {
      const r = await applyEdit(ctx(d), action);
      expect(r.ok, action.action).toBe(false);
    }
    expect(d.inputs[0].quantity).toBe(4);
    expect(
      (
        await applyEdit(ctx(d), {
          action: "set_price",
          ingredient_id: "i-sal",
          unit: "oz",
          unit_cost: 0.07,
        })
      ).ok
    ).toBe(true);
  });
});

describe("parseEditorAction", () => {
  it("accepts well-formed bodies and rejects the rest", () => {
    expect(
      parseEditorAction({
        action: "add",
        kind: "ingredient",
        id: "x",
        unit: "oz",
        quantity: 2,
      })
    ).toEqual({
      action: "add",
      kind: "ingredient",
      id: "x",
      unit: "oz",
      quantity: 2,
    });
    expect(
      parseEditorAction({
        action: "add",
        kind: "ingredient",
        id: "x",
        unit: "oz",
      })
    ).toBeNull();
    expect(
      parseEditorAction({
        action: "resolve",
        line_key: "u:0",
        kind: "weird",
        id: "x",
      })
    ).toBeNull();
    expect(parseEditorAction({ action: "nope" })).toBeNull();
    expect(
      parseEditorAction({
        action: "create_ingredient",
        name: "Comino",
        unit: "oz",
      })
    ).toMatchObject({ action: "create_ingredient" });
  });
});

/** A draft read from the menu: it says what is on the plate, never how much. */
function menuDraft(): MemoryEditorState {
  const d = draft();
  d.inputs = [];
  d.link!.evidence = {
    source: "menu",
    menu_dish: "Pupusa de queso",
    menu_description: "Masa de maíz rellena de queso",
    yield: { value: 1, unit: "portion", source: "menu" },
    lines: [
      line({
        raw_name: "queso",
        ingredient_match: "Queso fresco",
        qty: null,
        unit: null,
        pending: true,
        flags: ["pendiente_ingrediente", "pendiente_cantidad", "del_menu"],
      }),
      line({
        raw_name: "loroco",
        qty: null,
        unit: null,
        pending: true,
        flags: [
          "pendiente_ingrediente",
          "pendiente_cantidad",
          "del_menu",
          "nuevo_sugerido",
        ],
      }),
    ],
  };
  return d;
}

describe("lines read from the menu", () => {
  it("shows them as pending, with the suggested match and no cost", async () => {
    const lines = (await state(menuDraft())).lines;
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.kind).toBe("unresolved");
      expect(l.amount).toBeNull();
      expect(l.flags).toContain("del_menu");
    }
    expect(lines[0].possible_match).toMatchObject({ id: "i-queso" });
    expect(lines[1].flags).toContain("nuevo_sugerido");
  });

  it("never assumes a quantity: resolving needs one typed", async () => {
    const d = menuDraft();
    const queso = (await state(d)).lines[0];
    const refused = await applyEdit(ctx(d), {
      action: "resolve",
      line_key: queso.key,
      kind: "ingredient",
      id: "i-queso",
    });
    expect(refused.ok).toBe(false);
    expect(d.inputs).toHaveLength(0);

    const r = await applyEdit(ctx(d), {
      action: "resolve",
      line_key: queso.key,
      kind: "ingredient",
      id: "i-queso",
      quantity: 1.5,
      line_unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(d.inputs.map((i) => [i.ingredient_id, i.quantity, i.unit])).toEqual([
      ["i-queso", 1.5, "oz"],
    ]);
  });

  it("creates nothing for a new component until the quantity is typed", async () => {
    const d = menuDraft();
    const loroco = (await state(d)).lines[1];
    const refused = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Loroco",
      unit: "oz",
      line_key: loroco.key,
    });
    expect(refused.ok).toBe(false);
    expect(d.ingredients).toHaveLength(3);

    const r = await applyEdit(ctx(d), {
      action: "create_ingredient",
      name: "Loroco",
      unit: "oz",
      line_key: loroco.key,
      quantity: 0.25,
      line_unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(d.ingredients).toHaveLength(4);
    expect(d.inputs.at(-1)).toMatchObject({ quantity: 0.25, unit: "oz" });
  });
});

describe("a line imported with its own cost from the file", () => {
  function imported(): MemoryEditorState {
    const d = draft();
    d.inputs = [
      {
        id: "in-res",
        input_type: "ingredient",
        ingredient_id: "i-harina",
        component_id: null,
        quantity: 6,
        unit: "oz",
        unit_cost: 0.6,
        cost_source: "HOJA DE PRUEBA!B8",
      },
    ];
    d.link!.evidence = {
      yield: { value: 1, unit: "porción", source: "excel" },
      lines: [line({ raw_name: "HARINA", ingredient_match: "Harina", qty: 6 })],
    };
    return d;
  }

  it("is costed with the file's cost, not the catalog price", async () => {
    const lines = (await state(imported())).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      own_cost: true,
      cost_source: "HOJA DE PRUEBA!B8",
      pending: false,
    });
    expect(lines[0].amount).toBeCloseTo(3.6, 6);
  });

  it("keeps the cost when only the quantity changes", async () => {
    const d = imported();
    await applyEdit(ctx(d), {
      action: "update",
      input_id: "in-res",
      quantity: 8,
    });
    expect(d.inputs[0]).toMatchObject({ quantity: 8, unit_cost: 0.6 });
  });

  it("drops the file's cost when a person changes the unit or the item", async () => {
    const d = imported();
    await applyEdit(ctx(d), {
      action: "update",
      input_id: "in-res",
      unit: "lb",
    });
    expect(d.inputs[0]).toMatchObject({
      unit: "lb",
      unit_cost: null,
      cost_source: null,
    });

    const e = imported();
    await applyEdit(ctx(e), {
      action: "change_item",
      input_id: "in-res",
      kind: "ingredient",
      id: "i-queso",
    });
    expect(e.inputs[0]).toMatchObject({
      ingredient_id: "i-queso",
      unit_cost: null,
    });
  });
});

describe("line price, removal and speed (Stage Test 1 bugs)", () => {
  function withPrep(): MemoryEditorState {
    const d = draft();
    d.components = [{ id: "c-guac", name: "GUACAMOL", output_unit: "oz" }];
    d.inputs = [
      {
        id: "in-seed",
        input_type: "ingredient",
        ingredient_id: "i-harina",
        component_id: null,
        quantity: 4,
        unit: "oz",
      },
      {
        id: "in-guac",
        input_type: "component",
        ingredient_id: null,
        component_id: "c-guac",
        quantity: 2.5,
        unit: "oz",
      },
    ];
    d.link!.evidence = {
      yield: { value: 1, unit: "unit", source: "assumed" },
      lines: [
        line({ raw_name: "HARINA", ingredient_match: "Harina", qty: 4 }),
        // An AI draft's pending line with no match name, next to the
        // GUACAMOL preparation input.
        line({
          raw_name: "GUACAMOL ",
          qty: 2.5,
          pending: true,
          flags: ["pendiente_ingrediente"],
        }),
      ],
    };
    return d;
  }

  it("shows a preparation once, not as two lines", async () => {
    const lines = (await state(withPrep())).lines;
    expect(lines.map((l) => [l.kind, l.name ?? l.raw_name])).toEqual([
      ["ingredient", "Harina"],
      ["component", "GUACAMOL"],
    ]);
  });

  it("Quitar removes the preparation line for good, and its assumed yield stops blocking", async () => {
    const d = withPrep();
    const guac = (await state(d)).lines.find((l) => l.kind === "component")!;
    const r = await applyEdit(ctx(d), { action: "remove", line_key: guac.key });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines.map((l) => l.name ?? l.raw_name)).toEqual(["Harina"]);
    expect(d.inputs.map((i) => i.id)).toEqual(["in-seed"]);
    expect(d.link!.evidence.yield).toMatchObject({ confirmed: true });
  });

  it("sets a line's own price (a preparation line too) without touching the list", async () => {
    const d = withPrep();
    const entriesBefore = d.entries.length;
    const r = await applyEdit(ctx(d), {
      action: "set_line_cost",
      input_id: "in-guac",
      unit_cost: 0.15,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(d.inputs.find((i) => i.id === "in-guac")).toMatchObject({
      unit_cost: 0.15,
      cost_source: "manual",
    });
    expect(d.entries).toHaveLength(entriesBefore);
    const guac = r.state.lines.find((l) => l.kind === "component")!;
    expect(guac.amount).toBeCloseTo(0.375, 6);
    // And back to the list's price.
    await applyEdit(ctx(d), {
      action: "set_line_cost",
      input_id: "in-guac",
      unit_cost: null,
    });
    expect(d.inputs.find((i) => i.id === "in-guac")?.unit_cost).toBeNull();
    expect(
      parseEditorAction({
        action: "set_line_cost",
        input_id: "x",
        unit_cost: 0,
      })
    ).toMatchObject({ unit_cost: 0 });
  });

  it("reads the catalog once per edit", async () => {
    const d = draft();
    const store = createMemoryEditorStore(d);
    let loads = 0;
    const counting = {
      ...store,
      loadCosting: (companyId: string) => {
        loads += 1;
        return store.loadCosting(companyId);
      },
    };
    const run = { ...ctx(d), store: counting };
    await applyEdit(run, {
      action: "update",
      input_id: "in-seed",
      quantity: 5,
    });
    expect(loads).toBe(1);
  });
});

describe("a price save does the least work", () => {
  it("set_line_cost reads the catalog once and skips the pin pass", async () => {
    const d = draft();
    const store = createMemoryEditorStore(d);
    let loads = 0;
    let listings = 0;
    const counting = {
      ...store,
      loadCosting: (companyId: string) => {
        loads += 1;
        return store.loadCosting(companyId);
      },
      listInputs: (...args: Parameters<typeof store.listInputs>) => {
        listings += 1;
        return store.listInputs(...args);
      },
    };
    const r = await applyEdit(
      { ...ctx(d), store: counting },
      { action: "set_line_cost", input_id: "in-seed", unit_cost: 0.12 }
    );
    expect(r.ok).toBe(true);
    expect(loads).toBe(1);
    // One to check the line exists, one for the final state.
    expect(listings).toBe(2);
  });
});
