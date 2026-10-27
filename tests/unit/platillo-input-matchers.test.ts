import { describe, expect, it } from "vitest";
import { mapColumnsHeuristic } from "@/lib/restaurant/cost-workbook/ai";
import { detectIntent } from "@/lib/restaurant/ask-milton-prompt";

describe("platillo as an input matcher, not UI copy", () => {
  it("maps a «Platillo» column header to recipe_name", () => {
    const mapping = mapColumnsHeuristic({
      tabType: "recipe",
      headers: ["Platillo", "Porciones"],
      sampleRows: [],
    });
    expect(mapping.recipe_name?.column).toBe("Platillo");
  });

  it("treats «¿cuánto cuesta el platillo X?» as a dish mention", () => {
    expect(detectIntent("¿cuánto cuesta el platillo X?")).toBe(
      "dish_food_cost"
    );
  });
});
