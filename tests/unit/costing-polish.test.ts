// Costing polish: inline prices, waiting preparations, no AI questions
// after an Excel import, one undo row per file, instant edits.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  SAVING_LINE_PREFIX,
  optimisticAddLine,
  optimisticLine,
  searchPickerOptions,
  type EditorLine,
} from "@/lib/restaurant/recipe-costing/editor";
import { groupBatchesByFile } from "@/lib/restaurant/recipe-costing/workspace";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function line(over: Partial<EditorLine>): EditorLine {
  return {
    key: "k",
    input_id: "in-1",
    kind: "ingredient",
    ingredient_id: "i",
    component_id: null,
    name: "Chimichurri",
    raw_name: "CHIMICHURRI",
    source_row: null,
    qty: 1,
    unit: "oz",
    unit_cost: 0.11,
    amount: 0.11,
    price: null,
    pending: false,
    flags: [],
    reasons: [],
    possible_match: null,
    evidence_index: null,
    unit_question: null,
    excel_unit_cost: null,
    ...over,
  } as EditorLine;
}

describe("instant edits (optimistic)", () => {
  const state = {
    lines: [
      line({}),
      line({
        key: "k2",
        input_id: "in-2",
        name: "Res",
        unit_cost: 0.5,
        qty: 6,
        amount: 3,
      }),
    ],
    total_cost: 3.11,
  };

  it("shows a new price and the new total before the server answers", () => {
    const next = optimisticLine(state, "in-1", { unit_cost: 0.2 });
    expect(next.lines[0]).toMatchObject({ unit_cost: 0.2, own_cost: true });
    expect(next.lines[0].amount).toBeCloseTo(0.2, 6);
    expect(next.total_cost).toBeCloseTo(3.2, 6);
  });

  it("shows a new quantity at the line's price", () => {
    const next = optimisticLine(state, "in-2", { qty: 8 });
    expect(next.lines[1].amount).toBeCloseTo(4, 6);
  });

  it("never invents a cost for a line it cannot cost", () => {
    const pending = {
      lines: [line({ unit_cost: null, amount: null, pending: true })],
      total_cost: null,
    };
    const next = optimisticLine(pending, "in-1", { qty: 3 });
    expect(next.lines[0].amount).toBeNull();
    expect(next.total_cost).toBeNull();
  });
});

describe("Sugerencias para deshacer: one row per file", () => {
  it("groups the price list, the recipe import and each suggestion run", () => {
    const rows = groupBatchesByFile([
      {
        id: "b5",
        filename: "Costos_prueba.xlsx",
        created_at: "2026-10-13T20:05",
        undone_at: null,
      },
      {
        id: "b4",
        filename: "Costos_prueba.xlsx · recetas",
        created_at: "2026-10-13T20:04",
        undone_at: null,
      },
      {
        id: "b3",
        filename: "Costos_prueba.xlsx",
        created_at: "2026-10-13T20:03",
        undone_at: null,
      },
      {
        id: "b2",
        filename: "Menú · ejemplo.com",
        created_at: "2026-10-13T20:02",
        undone_at: null,
      },
      {
        id: "b1",
        filename: "costos_prueba.xlsx",
        created_at: "2026-10-13T20:01",
        undone_at: null,
      },
    ]);
    expect(rows.map((r) => [r.filename, r.uploads, r.batch_ids])).toEqual([
      ["Costos_prueba.xlsx", 4, ["b5", "b4", "b3", "b1"]],
      ["Menú · ejemplo.com", 1, ["b2"]],
    ]);
  });
});

describe("source guards", () => {
  it("no AI suggestions once the file's recipes were imported", () => {
    const server = read("lib/restaurant/recipe-suggestion-server.ts");
    expect(server).toContain("row.is_recipe_import");
    const panel = read(
      "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
    );
    expect(panel).toContain(
      "if (recipeDishes > 0 || recipesImported) onRecipesImported?.();"
    );
  });

  it("a preparation without cost says what is missing and opens it", () => {
    const editor = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(editor).toContain("no tiene costo todavía: falta precio en");
    expect(editor).toContain("Abrir {line.name}");
    // Do-not-remove #6: inline price edit on the line (double-click).
    expect(editor).toContain('title="Doble clic para cambiar el precio"');
    const prep = read(
      "components/restaurant/recipes-costing/PreparacionesScreen.tsx"
    );
    expect(prep).toContain("← Volver al plato");
  });

  it("each save is timed in the logs", () => {
    const route = read("app/api/restaurant/recipes/editor/route.ts");
    expect(route).toContain("[recipes/editor] ${action.action} ${ms}ms");
  });
});

describe("+ Agregar ingrediente", () => {
  const options = [
    {
      kind: "component" as const,
      id: "c-convoy",
      name: "CONVOY",
      unit: "orden",
      unit_cost: 0.89,
      price_date: null,
      price_source: null,
    },
    {
      kind: "ingredient" as const,
      id: "i-queso",
      name: "Queso cremado",
      unit: "oz",
      unit_cost: 0.18,
      price_date: null,
      price_source: null,
    },
    {
      kind: "ingredient" as const,
      id: "i-frijol",
      name: "FRIJOL FRITO",
      unit: "oz",
      unit_cost: 0.045,
      price_date: null,
      price_source: null,
    },
    {
      kind: "component" as const,
      id: "c-frijoles",
      name: "FRIJOLES FRITOS",
      unit: "oz",
      unit_cost: null,
      price_date: null,
      price_source: null,
    },
  ];

  it("filters as the person types: words, accents and the file's longer names", () => {
    expect(
      searchPickerOptions(options, "convoy ensalada y caldo").map((o) => o.id)
    ).toEqual(["c-convoy"]);
    expect(searchPickerOptions(options, "QUESO").map((o) => o.id)).toEqual([
      "i-queso",
    ]);
    expect(searchPickerOptions(options, "crémado").map((o) => o.id)).toEqual([
      "i-queso",
    ]);
    expect(searchPickerOptions(options, "frij").map((o) => o.id)).toEqual([
      "i-frijol",
      "c-frijoles",
    ]);
    expect(searchPickerOptions(options, "")).toHaveLength(4);
  });

  it("shows the added line at once, costed only in the same unit", () => {
    const state = { lines: [] as EditorLine[], total_cost: null };
    const added = optimisticAddLine(state, options[0], 1, "orden");
    expect(added.lines[0]).toMatchObject({
      name: "CONVOY",
      qty: 1,
      amount: 0.89,
    });
    expect(added.lines[0].key.startsWith(SAVING_LINE_PREFIX)).toBe(true);
    const otherUnit = optimisticAddLine(state, options[1], 2, "lb");
    expect(otherUnit.lines[0].amount).toBeNull();
    expect(otherUnit.lines[0].pending).toBe(true);
  });

  it("the editor only loads preparation versions, never every dish's", () => {
    const store = read("lib/restaurant/recipe-costing/editor-store.ts");
    expect(store).toContain("componentsOnly: true");
  });
});
