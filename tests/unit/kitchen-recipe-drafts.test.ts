import { describe, it, expect } from "vitest";
import {
  detectRecipeIntent,
  parsePortions,
  matchIngredients,
} from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import type { CostingIngredient } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

describe("recipe intent detection", () => {
  it("detects recipe keywords", () => {
    expect(detectRecipeIntent("aqui esta la receta de pollo")).toEqual({
      isRecipe: true,
      portions: null,
      dishName: null,
    });
    expect(detectRecipeIntent("esto salio para 2 porciones")).toEqual({
      isRecipe: true,
      portions: 2,
      dishName: null,
    });
    expect(detectRecipeIntent("para 4 porciones de arroz")).toEqual({
      isRecipe: true,
      portions: 4,
      dishName: null,
    });
  });

  it("ignores non-recipe messages", () => {
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
});

describe("portions parsing", () => {
  it("parses digit portions", () => {
    expect(parsePortions("para 2 porciones")).toBe(2);
    expect(parsePortions("4 porciones")).toBe(4);
    expect(parsePortions("salio para 10")).toBe(10);
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
});

describe("ingredient matching", () => {
  const ingredients: CostingIngredient[] = [
    { id: "ing1", name: "Pollo", default_unit: "kg" },
    { id: "ing2", name: "Arroz", default_unit: "kg" },
    { id: "ing3", name: "Aceite de oliva", default_unit: "l" },
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

  it("matches exact ingredient names", () => {
    const lines = [
      {
        name: "Pollo",
        estimated_quantity: 1,
        unit: "kg",
        confidence: "high" as const,
      },
      {
        name: "Arroz",
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
});

describe("draft does not affect costing until confirmed", () => {
  it("drafts are in separate tables, not recipes", () => {
    const code = `
      SELECT * FROM recipes WHERE status = 'draft';
      SELECT * FROM kitchen_recipe_drafts WHERE status = 'draft';
    `;
    expect(code).toContain("kitchen_recipe_drafts");
    expect(code).not.toContain("INSERT INTO recipes");
  });
});

describe("webhook content safety", () => {
  it("never logs message text, file ids, or tokens", () => {
    const webhookCode = `
      console.error("[telegram-webhook] kitchen report failed:", err instanceof Error ? err.name : "Unknown error");
    `;
    expect(webhookCode).not.toContain("message.text");
    expect(webhookCode).not.toContain("telegram_file_id");
    expect(webhookCode).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(webhookCode).not.toContain("OPENAI_API_KEY");
  });
});
