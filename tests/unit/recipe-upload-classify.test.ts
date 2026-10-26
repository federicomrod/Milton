import { describe, it, expect, vi } from "vitest";
import {
  classifyRecipeKind,
  portionsFromYieldText,
  isPreparationTab,
} from "@/lib/restaurant/recipe-upload/classify";
import { UPLOAD_EXTRACTION_PROMPT } from "@/lib/restaurant/recipe-upload/extract";
import { validateUploadResponse } from "@/lib/restaurant/recipe-upload/validate";

describe("classifyRecipeKind", () => {
  const table: Array<
    [string, Parameters<typeof classifyRecipeKind>[0], string, number | null]
  > = [
    [
      "platos with a parenthetical, the model said preparación",
      {
        yieldText: "Rendimiento: 4 platos (1 pescado por plato)",
        modelKind: "preparacion",
      },
      "plato",
      4,
    ],
    [
      "yield text without label",
      { yieldText: "4 platos (1 pescado por plato)", modelKind: "preparacion" },
      "plato",
      4,
    ],
    [
      "Porciones: 6",
      { yieldText: "Porciones: 6", modelKind: "preparacion" },
      "plato",
      6,
    ],
    ["bare 6", { yieldText: "6", modelKind: "plato" }, "plato", 6],
    ["personas", { yieldText: "8 personas" }, "plato", 8],
    [
      "panes",
      { yieldText: "Rinde: 12 panes", modelKind: "preparacion" },
      "plato",
      12,
    ],
    ["unidades", { yieldText: "Rinde: 10 unidades" }, "plato", 10],
    [
      "litro",
      { yieldText: "Rinde: 1 litro", modelKind: "plato" },
      "preparacion",
      null,
    ],
    ["tazas", { yieldText: "Rinde: 2 tazas" }, "preparacion", null],
    ["kg", { yieldText: "Rinde: 3 kg" }, "preparacion", null],
    ["galones", { yieldText: "2 galones" }, "preparacion", null],
    ["libras", { yieldText: "5 libras" }, "preparacion", null],
    [
      "Salsas tab + litro",
      { yieldText: "Rinde: 1 litro", tabLabel: "Salsas" },
      "preparacion",
      null,
    ],
    [
      "Salsas tab, no yield",
      { tabLabel: "Salsas", modelKind: "plato" },
      "preparacion",
      null,
    ],
    ["Bases (parte 2)", { tabLabel: "Bases (parte 2)" }, "preparacion", null],
    ["Preparaciones", { tabLabel: "Preparaciones" }, "preparacion", null],
    [
      "Salsas tab, 8 porciones wins",
      {
        yieldText: "Rendimiento: 8 porciones",
        tabLabel: "Salsas",
        modelKind: "preparacion",
      },
      "plato",
      8,
    ],
    [
      "Salsas tab, count of units stays preparación",
      { yieldText: "Rinde: 12 panes", tabLabel: "Salsas" },
      "preparacion",
      null,
    ],
    [
      "Platos fuertes tab",
      { tabLabel: "Platos fuertes", modelKind: "plato" },
      "plato",
      null,
    ],
    [
      "pastel portion size not whole → null",
      { yieldText: "Rinde: 20 pasteles (porción = 3 unidades)" },
      "plato",
      null,
    ],
    [
      "pastel portion size whole",
      { yieldText: "Rinde: 24 pasteles (porción = 3 unidades)" },
      "plato",
      8,
    ],
    [
      "no info: keep model's kind",
      { modelKind: "preparacion" },
      "preparacion",
      null,
    ],
    ["no info: default plato", {}, "plato", null],
  ];
  it.each(table)("%s", (_n, input, kind, portions) => {
    expect(classifyRecipeKind(input)).toEqual({ kind, portions });
  });

  it("a dish whose ingredient is a preparation stays plato (ingredients are not an input)", () => {
    expect(
      classifyRecipeKind({
        tabLabel: "Platos fuertes",
        yieldText: "Porciones: 4",
        modelKind: "plato",
      })
    ).toEqual({ kind: "plato", portions: 4 });
    const v = validateUploadResponse(
      {
        recipes: [
          {
            dish_name: "Tacos",
            kind: "plato",
            portions: null,
            yield_text: null,
            ingredients: [
              {
                name: "chimol",
                estimated_quantity: 1,
                unit: "taza",
                confidence: "high",
              },
              {
                name: "ver Salsas: chimol",
                estimated_quantity: null,
                unit: null,
                confidence: "low",
              },
            ],
            overall_confidence: "high",
          },
        ],
      },
      null,
      "Platos fuertes"
    );
    expect(v.recipes[0].kind).toBe("plato");
  });

  it("portionsFromYieldText / isPreparationTab", () => {
    expect(
      portionsFromYieldText("Rendimiento: 4 platos (1 pescado por plato)")
    ).toBe(4);
    expect(portionsFromYieldText("1 litro")).toBeNull();
    expect(portionsFromYieldText(null)).toBeNull();
    expect(isPreparationTab("Salsa")).toBe(true);
    expect(isPreparationTab("Platos fuertes")).toBe(false);
  });

  it("validate overrides the model: Pescado → plato 4", () => {
    const v = validateUploadResponse(
      {
        recipes: [
          {
            dish_name: "Pescado frito entero",
            kind: "preparacion",
            portions: null,
            yield_text: "4 platos (1 pescado por plato)",
            ingredients: [
              {
                name: "Pescado entero",
                estimated_quantity: 4,
                unit: "unidad",
                confidence: "high",
              },
            ],
            overall_confidence: "high",
          },
        ],
      },
      "Pescado frito entero\nRendimiento: 4 platos (1 pescado por plato)\nPescado entero 4",
      "Platos fuertes"
    );
    expect(v.recipes[0]).toMatchObject({ kind: "plato", portions: 4 });
  });

  it("the prompt states the rules", () => {
    expect(UPLOAD_EXTRACTION_PROMPT).toContain(
      "«Salsas», «Preparaciones» o «Bases»"
    );
    expect(UPLOAD_EXTRACTION_PROMPT).toContain(
      "un plato NO es una preparación"
    );
    expect(UPLOAD_EXTRACTION_PROMPT).toContain("galón");
  });
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

describe("createRecipeDraft totals", () => {
  const make = async (lines: Array<number | null>) => {
    const { createRecipeDraft } =
      await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");
    let draftRow: Record<string, unknown> = {};
    let lineRows: Array<Record<string, unknown>> = [];
    const admin = {
      from: (t: string) => ({
        insert: (row: never) => {
          if (t === "kitchen_recipe_drafts") {
            draftRow = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: "d1" }, error: null }),
              }),
            };
          }
          lineRows = row;
          return Promise.resolve({ error: null });
        },
      }),
    };
    await createRecipeDraft(
      {
        companyId: "c",
        locationId: "l",
        staffId: "s",
        kitchenReportId: null,
        chatId: 1,
        messageId: 1,
        dishName: "Sopa",
        portions: 2,
        lines: lines.map((c, i) => ({
          raw_name: `x${i}`,
          ingredient_id: "i",
          ingredient_name: "x",
          total_quantity: 1,
          unit: "kg",
          per_portion_quantity: 0.5,
          confidence: "high" as const,
          unit_cost_snapshot: c,
          unit_cost_unit: "kg",
          line_cost: c,
        })),
        overallConfidence: "high",
        currency: "USD",
      },
      admin as never
    );
    return { draftRow, lineRows };
  };

  it("all lines costed → total and per portion", async () => {
    const { draftRow } = await make([4, 2]);
    expect(draftRow).toMatchObject({ total_cost: 6, per_portion_cost: 3 });
  });
  it("a missing or 0 line → line_cost null and total null", async () => {
    const { draftRow, lineRows } = await make([4, 0]);
    expect(draftRow).toMatchObject({
      total_cost: null,
      per_portion_cost: null,
    });
    expect(lineRows[1].line_cost).toBeNull();
    const b = await make([4, null]);
    expect(b.draftRow.total_cost).toBeNull();
  });
});

describe("matchIngredients with a price of 0", () => {
  it("Sal priced 0 gets no line_cost and no snapshot", async () => {
    const { matchIngredients } =
      await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");
    const ingredients = [
      { id: "i-sal", name: "Sal", default_unit: "lb" },
    ] as never;
    const costs = new Map([
      [
        "i-sal",
        [
          {
            id: "e1",
            ingredient_id: "i-sal",
            source_type: "manual",
            cost_date: "2026-10-01",
            unit_cost: 0,
            normalized_unit_cost: 0,
            normalized_unit: "lb",
            unit: "lb",
            currency: "USD",
            created_at: "2026-10-01T00:00:00Z",
          },
        ],
      ],
    ]) as never;
    const [m] = matchIngredients(
      [{ name: "Sal", estimated_quantity: 1, unit: "lb", confidence: "high" }],
      ingredients,
      costs,
      2
    );
    expect(m.ingredient_id).toBe("i-sal");
    expect(m.line_cost).toBeNull();
    expect(m.unit_cost_snapshot).toBeNull();
  });
});
