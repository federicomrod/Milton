import { describe, it, expect } from "vitest";
import {
  detectRecipeIntent,
  parsePortions,
  parsePortionsFromFollowUp,
  parseDishName,
  matchIngredients,
  validateExtractedRecipe,
} from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import { normalizeUnit } from "@/lib/restaurant/units";
import type { CostingIngredient } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

describe("recipe intent detection", () => {
  it("detects recipe keyword", () => {
    expect(detectRecipeIntent("aqui esta la receta de pollo")).toEqual({
      isRecipe: true,
      portions: null,
      dishName: null,
    });
  });

  it("detects portions with salió para", () => {
    expect(detectRecipeIntent("esto salió para 2 porciones")).toEqual({
      isRecipe: true,
      portions: 2,
      dishName: null,
    });
  });

  it("detects portions only", () => {
    expect(detectRecipeIntent("4 porciones de arroz")).toEqual({
      isRecipe: true,
      portions: 4,
      dishName: null,
    });
    expect(detectRecipeIntent("salió para 2")).toEqual({
      isRecipe: true,
      portions: 2,
      dishName: null,
    });
    expect(detectRecipeIntent("1 porción")).toEqual({
      isRecipe: true,
      portions: 1,
      dishName: null,
    });
  });

  it("normalizes accents before checking", () => {
    expect(detectRecipeIntent("salió para 3 porciones")).toEqual({
      isRecipe: true,
      portions: 3,
      dishName: null,
    });
  });

  it("report keywords take precedence over recipe", () => {
    expect(detectRecipeIntent("quedan 3 porciones de flan")).toEqual({
      isRecipe: false,
      portions: null,
      dishName: null,
    });
    expect(detectRecipeIntent("se acabo el pollo")).toEqual({
      isRecipe: false,
      portions: null,
      dishName: null,
    });
    expect(detectRecipeIntent("merma de 2kg")).toEqual({
      isRecipe: false,
      portions: null,
      dishName: null,
    });
  });

  it("ignores non-recipe messages", () => {
    expect(detectRecipeIntent("hola")).toEqual({
      isRecipe: false,
      portions: null,
      dishName: null,
    });
  });
});

describe("portions parsing", () => {
  it("parses digit portions", () => {
    expect(parsePortions("para 2 porciones")).toBe(2);
    expect(parsePortions("4 porciones")).toBe(4);
    expect(parsePortions("salio para 10")).toBe(10);
    expect(parsePortions("salió para 2")).toBe(2);
  });

  it("parses Spanish number words", () => {
    expect(parsePortions("dos porciones")).toBe(2);
    expect(parsePortions("cuatro porciones")).toBe(4);
    expect(parsePortions("una porcion")).toBe(1);
  });

  it("returns null when no portions found", () => {
    expect(parsePortions("receta de pollo")).toBeNull();
    expect(parsePortions("se acabo el arroz")).toBeNull();
  });

  it("avoids false positives", () => {
    expect(parsePortions("solo para 3 mesas")).toBeNull();
  });
});

describe("portions follow-up parsing", () => {
  it("parses bare numbers", () => {
    expect(parsePortionsFromFollowUp("2")).toBe(2);
    expect(parsePortionsFromFollowUp("  4  ")).toBe(4);
    expect(parsePortionsFromFollowUp("10.")).toBe(10);
  });

  it("parses number with porcion(es)", () => {
    expect(parsePortionsFromFollowUp("2 porciones")).toBe(2);
    expect(parsePortionsFromFollowUp("1 porcion")).toBe(1);
  });

  it("parses Spanish words", () => {
    expect(parsePortionsFromFollowUp("dos")).toBe(2);
    expect(parsePortionsFromFollowUp("cuatro porciones")).toBe(4);
  });

  it("normalizes accents", () => {
    expect(parsePortionsFromFollowUp("dos porción")).toBe(2);
  });

  it("rejects non-bare-number messages", () => {
    expect(parsePortionsFromFollowUp("solo para 3 mesas")).toBeNull();
    expect(parsePortionsFromFollowUp("quedan 3 porciones de flan")).toBeNull();
    expect(parsePortionsFromFollowUp("receta de 2 porciones")).toBeNull();
  });
});

describe("dish name parsing", () => {
  it("does not use the whole caption as the dish name", () => {
    const caption = "Esto salió para 2 porciones de pollo con arroz";
    expect(parseDishName(caption)).toBe("pollo con arroz");
    expect(parseDishName(caption)).not.toBe(caption);
  });

  it("parses a short receta de name", () => {
    expect(parseDishName("receta de flan")).toBe("flan");
  });
});

describe("extracted recipe validation", () => {
  const valid = {
    dish_name: "Pollo",
    portions: 2,
    ingredients: [
      {
        name: "Pollo",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high",
      },
    ],
    overall_confidence: "high",
  };

  it("accepts integer portions", () => {
    expect(validateExtractedRecipe(valid)).toBe(true);
    expect(validateExtractedRecipe({ ...valid, portions: null })).toBe(true);
  });

  it("rejects non-integer portions", () => {
    expect(validateExtractedRecipe({ ...valid, portions: 2.5 })).toBe(false);
  });
});

describe("unit synonyms", () => {
  it("recognizes pzas", () => {
    expect(normalizeUnit("pzas")).toBe("unit");
  });
});

describe("ingredient matching", () => {
  const ingredients: CostingIngredient[] = [
    { id: "ing1", name: "Pollo", default_unit: "kg" },
    { id: "ing2", name: "Arroz", default_unit: "kg" },
    { id: "ing3", name: "Aceite de oliva", default_unit: "l" },
    { id: "ing4", name: "Sal", default_unit: "kg" },
  ];

  const costEntries: Map<string, IngredientCostEntry[]> = new Map([
    [
      "ing1",
      [
        {
          id: "c1",
          company_id: "comp1",
          ingredient_id: "ing1",
          supplier_id: null,
          source_type: "manual" as const,
          source_id: null,
          cost_date: "2026-10-01",
          quantity: 1,
          unit: "kg",
          total_cost: 80,
          unit_cost: 80,
          normalized_unit_cost: 80,
          normalized_unit: "kg",
          currency: "MXN",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    ],
    [
      "ing2",
      [
        {
          id: "c2",
          company_id: "comp1",
          ingredient_id: "ing2",
          supplier_id: null,
          source_type: "manual" as const,
          source_id: null,
          cost_date: "2026-10-01",
          quantity: 1,
          unit: "kg",
          total_cost: 30,
          unit_cost: 30,
          normalized_unit_cost: 30,
          normalized_unit: "kg",
          currency: "MXN",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    ],
  ]);

  it("matches exact ingredient names (case/accent insensitive)", () => {
    const lines = [
      {
        name: "Pollo",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
      {
        name: "ARROZ",
        estimated_quantity: 0.5,
        unit: "kg",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched).toHaveLength(2);
    expect(matched[0].ingredient_id).toBe("ing1");
    expect(matched[0].per_portion_quantity).toBe(0.5);
    expect(matched[1].ingredient_id).toBe("ing2");
    expect(matched[1].per_portion_quantity).toBe(0.25);
  });

  it("matches whole-word substrings with medium confidence", () => {
    const lines = [
      {
        name: "aceite",
        estimated_quantity: 0.1,
        unit: "l",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].ingredient_id).toBe("ing3");
    expect(matched[0].confidence).toBe("medium");
  });

  it("does not match short partial strings", () => {
    const lines = [
      {
        name: "salsa verde",
        estimated_quantity: 0.1,
        unit: "kg",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].ingredient_id).toBeNull();
    expect(matched[0].confidence).toBe("low");
  });

  it("flags unmatched ingredients as low confidence", () => {
    const lines = [
      {
        name: "Desconocido",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].ingredient_id).toBeNull();
    expect(matched[0].confidence).toBe("low");
  });

  it("calculates line cost from unit cost", () => {
    const lines = [
      {
        name: "Pollo",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].line_cost).toBe(80);
    expect(matched[0].unit_cost_snapshot).toBe(80);
    expect(matched[0].unit_cost_unit).toBe("kg");
  });

  it("flags missing cost as low confidence", () => {
    const lines = [
      {
        name: "Aceite de oliva",
        estimated_quantity: 0.1,
        unit: "l",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].ingredient_id).toBe("ing3");
    expect(matched[0].confidence).toBe("low");
    expect(matched[0].line_cost).toBeNull();
  });

  it("flags null line_cost as low confidence", () => {
    const lines = [
      {
        name: "Arroz",
        estimated_quantity: null,
        unit: null,
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched[0].confidence).toBe("low");
  });

  it("skips empty ingredient names", () => {
    const lines = [
      {
        name: "",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
      {
        name: "  ",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
    ];
    const matched = matchIngredients(lines, ingredients, costEntries, 2);
    expect(matched).toHaveLength(0);
  });
});
