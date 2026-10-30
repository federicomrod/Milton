// Catalog-only prefill and the unit-label check. Synthetic data only.

import { menuEditor } from "@/lib/i18n/es/menu-editor";
import { describe, expect, it } from "vitest";
import {
  prefillLines,
  suggestedUnitFromPrice,
} from "@/lib/restaurant/recipe-costing/prefill";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const ingredients = [
  { id: "i-betabel", name: "Betabel", default_unit: "oz", unit_cost: 0.03 },
  { id: "i-papa", name: "Papa", default_unit: "lb", unit_cost: 0.72 },
  { id: "i-comino", name: "Comino", default_unit: "g", unit_cost: 0.02 },
  { id: "i-dup1", name: "Ajo", default_unit: "oz", unit_cost: 0.1 },
];
const preparations = [
  { id: "p-salsa", name: "Salsa casera" },
  { id: "p-ajo", name: "AJO" },
];

const line = (
  raw_name: string,
  unit: string,
  qty = 1,
  excel: number | null = null
) => ({
  source_row: 5,
  raw_name,
  qty,
  unit,
  excel_unit_cost: excel,
});

describe("prefillLines", () => {
  it("resolves exact names (case and accents) to ingredients and preparations", () => {
    const [b, s] = prefillLines({
      lines: [line("BETABEL", "ONZA"), line("salsa  casera", "ONZA")],
      ingredients,
      preparations,
    });
    expect(b.resolved).toMatchObject({
      kind: "ingredient",
      id: "i-betabel",
      via: "exact",
    });
    expect(b.pending).toBe(false);
    expect(s.resolved).toMatchObject({ kind: "component", id: "p-salsa" });
  });

  it("uses a name a person already confirmed", () => {
    const [b] = prefillLines({
      lines: [line("BETABL", "ONZA")],
      ingredients,
      preparations,
      aliases: new Map([["betabl", "i-betabel"]]),
    });
    expect(b.resolved).toMatchObject({ id: "i-betabel", via: "alias" });
  });

  it("never resolves a look-alike or an ambiguous name", () => {
    const [typo, both] = prefillLines({
      lines: [line("BETABL", "ONZA"), line("Ajo", "ONZA")],
      ingredients,
      preparations,
    });
    expect(typo.resolved).toBeNull();
    expect(typo.pending).toBe(true);
    expect(typo.reasons[0]).toContain("BETABL");
    expect(both.resolved).toBeNull();
    expect(both.reasons[0]).toContain("más de un");
  });

  it("never carries the Excel price as a cost", () => {
    const [b] = prefillLines({
      lines: [line("Betabel", "ONZA", 2, 0.9)],
      ingredients,
      preparations,
    });
    expect(b).not.toHaveProperty("unit_cost");
    expect(b.excel_unit_cost).toBe(0.9);
    // A different price is a catalog conflict, not a unit question.
    expect(b.unit_question).toBeNull();
  });

  it("asks when the Excel's own price says the unit label is wrong", () => {
    // 16 written as LIBRA but priced per ounce, like the catalog.
    const [b] = prefillLines({
      lines: [line("Betabel", "LIBRA", 16, 0.03)],
      ingredients,
      preparations,
    });
    expect(b.unit).toBe("lb");
    expect(b.unit_question).toEqual({ written: "lb", suggested: "oz" });
    expect(b.pending).toBe(true);
    expect(b.flags).toContain("pendiente_unidad");
    expect(b.resolved).not.toBeNull(); // still added to the recipe
  });

  it("keeps a consistent unit quiet", () => {
    const [p] = prefillLines({
      lines: [line("Papa", "ONZA", 4, 0.045)],
      ingredients,
      preparations,
    });
    expect(p.unit_question).toBeNull();
    expect(p.pending).toBe(false);
  });

  it("flags a unit cell it cannot read, without guessing", () => {
    const [b] = prefillLines({
      lines: [line("Betabel", "APIO")],
      ingredients,
      preparations,
    });
    expect(b.unit_ok).toBe(false);
    expect(b.pending).toBe(true);
  });
});

describe("suggestedUnitFromPrice", () => {
  it("finds the mass unit the price belongs to, or nothing", () => {
    const base = { catalogUnit: "oz", catalogUnitCost: 0.03 };
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "lb",
        excelUnitCost: 0.03,
      })
    ).toBe("oz");
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "oz",
        excelUnitCost: 0.03,
      })
    ).toBeNull();
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "lb",
        excelUnitCost: 0.48,
      })
    ).toBeNull();
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "lb",
        excelUnitCost: 0.31,
      })
    ).toBeNull();
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "unit",
        excelUnitCost: 0.03,
      })
    ).toBeNull();
    expect(
      suggestedUnitFromPrice({
        ...base,
        writtenUnit: "lb",
        excelUnitCost: null,
      })
    ).toBeNull();
  });
});

describe("answering a unit question in Validar", () => {
  function state() {
    return memoryEditorState({
      ingredients: [{ id: "i-betabel", name: "Betabel", default_unit: "oz" }],
      entries: [entry("i-betabel", "oz", 0.03)],
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
          ingredient_id: "i-betabel",
          component_id: null,
          quantity: 16,
          unit: "lb",
        },
      ],
      link: {
        id: "l1",
        menu_item_id: "m1",
        evidence: {
          yield: { value: 1, unit: "porción", source: "excel" },
          lines: [
            {
              raw_name: "BETABEL",
              ingredient_match: "Betabel",
              qty: 16,
              unit: "lb",
              pending: true,
              flags: ["pendiente_unidad"],
              reasons: [],
              source_row: 4,
              excel_unit_cost: 0.03,
              unit_question: { written: "lb", suggested: "oz" },
            },
          ],
        },
      },
    });
  }
  const ctx = (s: ReturnType<typeof state>) => ({
    store: createMemoryEditorStore(s),
    companyId: "co-1",
    odooProductId: 7,
    locationId: null,
    userId: "u1",
  });

  it("shows the question and keeps the line pending until answered", async () => {
    const s = state();
    const r = await loadEditor(ctx(s));
    const l = r.ok ? r.state.lines[0] : null;
    expect(l?.unit_question).toEqual({ written: "lb", suggested: "oz" });
    expect(l?.pending).toBe(true);
    expect(l?.excel_unit_cost).toBe(0.03);
  });

  it("applies the chosen unit to the recipe and clears the question", async () => {
    const s = state();
    const r = await applyEdit(ctx(s), {
      action: "answer_unit",
      input_id: "in-seed",
      unit: "oz",
    });
    expect(r.ok).toBe(true);
    expect(s.inputs[0].unit).toBe("oz");
    const l = r.ok ? r.state.lines[0] : null;
    expect(l?.unit_question).toBeNull();
    expect(l?.pending).toBe(false);
    expect(l?.amount).toBeCloseTo(0.48, 6); // 16 oz × 0.03
    const ev = (s.link!.evidence.lines as Array<Record<string, unknown>>)[0];
    expect(ev.unit_question).toBeNull();
  });

  it("keeping the written unit is also an answer", async () => {
    const s = state();
    await applyEdit(ctx(s), {
      action: "answer_unit",
      input_id: "in-seed",
      unit: "lb",
    });
    expect(s.inputs[0].unit).toBe("lb");
    const ev = (s.link!.evidence.lines as Array<Record<string, unknown>>)[0];
    expect(ev.unit_question).toBeNull();
    expect(ev.pending).toBe(false);
  });
});

describe("suggestion path guards", () => {
  it("no longer uses the old Excel-priced line check, and the UI asks the unit question", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      "lib/restaurant/cost-workbook/recipe-suggestion.ts",
      "utf8"
    );
    expect(src).not.toContain("checkRecipeProposal(");
    expect(src).not.toContain("resolved_unit_cost");
    expect(src).toContain("prefillLines(");
    expect(src).toContain("prefillPreparations(");
    const ui = readFileSync(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx",
      "utf8"
    );
    // The wording lives in the Spanish dictionary; the editor reads it from there.
    expect(readFileSync("lib/i18n/es/menu-editor.ts", "utf8")).toContain(
      "pero su precio corresponde a"
    );
    expect(ui).toContain("d.lines.unitQuestion");
    expect(ui).toContain('action: "answer_unit"');
    expect(menuEditor.lines.inYourExcel).toContain("en tu Excel:");
    expect(ui).toContain("d.lines.inYourExcel");
  });
});
