import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { resolveAskMiltonIngredientUnitCost } from "@/lib/restaurant/ask-milton-context";
import { calculateRestaurantMenuItemCost } from "@/lib/restaurant/calculations";
import {
  isPendingRecipeCostStatus,
  pendingRecipesLabel,
} from "@/lib/restaurant/cost-workbook/copy";
import { positiveUnitCost } from "@/lib/restaurant/unit-cost";
import type { Ingredient, Recipe, RecipeIngredient } from "@/types/restaurant";

const NOW = "2026-04-01T00:00:00Z";

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "ing-1",
    company_id: "co-1",
    name: "HIERBA SECA",
    category: "dry",
    default_unit: "oz",
    current_unit_cost: null,
    currency: "USD",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

const RECIPE: Recipe = {
  id: "rec-1",
  menu_item_id: "mi-1",
  company_id: "co-1",
  version: 1,
  created_at: NOW,
  updated_at: NOW,
};

const LINE: RecipeIngredient = {
  id: "ri-1",
  recipe_id: "rec-1",
  ingredient_id: "ing-1",
  quantity: 2,
  unit: "oz",
  waste_factor: 0,
};

describe("positiveUnitCost", () => {
  it("keeps a real price and treats null / 0 / negative as pending", () => {
    expect(positiveUnitCost(0.18)).toBe(0.18);
    expect(positiveUnitCost(null)).toBeNull();
    expect(positiveUnitCost(undefined)).toBeNull();
    expect(positiveUnitCost(0)).toBeNull();
    expect(positiveUnitCost(-1)).toBeNull();
  });
});

describe("resolveAskMiltonIngredientUnitCost", () => {
  it("does not turn a null pending cache into $0", () => {
    const pending = resolveAskMiltonIngredientUnitCost(undefined, null, "es");
    expect(pending.current_unit_cost).toBeNull();
    expect(pending.pending_label).toBe("Pendiente de recetas");
    expect(pendingRecipesLabel("es")).toBe("Pendiente de recetas");
  });

  it("does not turn a legacy 0 cache into $0", () => {
    const pending = resolveAskMiltonIngredientUnitCost(undefined, 0, "es");
    expect(pending.current_unit_cost).toBeNull();
    expect(pending.pending_label).toBe("Pendiente de recetas");
  });

  it("prefers the cost-entry price when one exists", () => {
    const priced = resolveAskMiltonIngredientUnitCost(1.234, null, "es");
    expect(priced.current_unit_cost).toBe(1.23);
    expect(priced.pending_label).toBeNull();
  });
});

describe("calculateRestaurantMenuItemCost pending cache", () => {
  it("returns missing_ingredient_cost, not $0, when current_unit_cost is null", () => {
    const result = calculateRestaurantMenuItemCost(
      "mi-1",
      [RECIPE],
      [LINE],
      [ingredient({ current_unit_cost: null })],
      [],
      []
    );
    expect(result.cost).toBeNull();
    expect(result.status).toBe("missing_ingredient_cost");
    expect(isPendingRecipeCostStatus(result.status)).toBe(true);
  });

  it("still costs a dish when the cache has a real price", () => {
    const result = calculateRestaurantMenuItemCost(
      "mi-1",
      [RECIPE],
      [LINE],
      [ingredient({ current_unit_cost: 1.5 })],
      [],
      []
    );
    expect(result.status).toBe("complete");
    expect(result.cost).toBeCloseTo(3, 5);
  });
});

describe("isPendingRecipeCostStatus", () => {
  it("treats missing prices as Pendiente de recetas", () => {
    expect(isPendingRecipeCostStatus("no_cost_entries")).toBe(true);
    expect(isPendingRecipeCostStatus("missing_input_cost")).toBe(true);
    expect(isPendingRecipeCostStatus("missing_ingredient_cost")).toBe(true);
    expect(isPendingRecipeCostStatus("complete")).toBe(false);
  });
});

describe("new ingredients insert a null pending price, never $0", () => {
  const files = [
    "app/api/restaurant/ingredients/route.ts",
    "app/api/restaurant/invoices/[id]/lines/route.ts",
    "lib/restaurant/ask-milton-context.ts",
    "lib/restaurant/calculations.ts",
    "types/restaurant.ts",
  ];

  it.each(files)(
    "%s no longer writes or types current_unit_cost as a hard 0",
    (file) => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/current_unit_cost:\s*0\b/);
    }
  );

  it("Ask Milton keeps null and labels it pending", () => {
    const src = readFileSync("lib/restaurant/ask-milton-context.ts", "utf8");
    expect(src).toContain("current_unit_cost: number | null");
    expect(src).toContain("pending_label");
    expect(src).toContain("resolveAskMiltonIngredientUnitCost");
    expect(src).not.toMatch(/current_unit_cost \?\? 0/);
  });

  it("calculations.ts uses an explicit == null check", () => {
    const src = readFileSync("lib/restaurant/calculations.ts", "utf8");
    expect(src).toContain("ingredient.current_unit_cost == null");
  });

  it("ingredient create paths insert null", () => {
    expect(
      readFileSync("app/api/restaurant/ingredients/route.ts", "utf8")
    ).toContain("current_unit_cost: null");
    const invoices = readFileSync(
      "app/api/restaurant/invoices/[id]/lines/route.ts",
      "utf8"
    );
    expect(invoices.match(/current_unit_cost:\s*null/g)?.length).toBe(2);
    // A person's pick on an unclear price-list row lists it unpriced.
    expect(
      readFileSync("lib/restaurant/price-catalog/apply.ts", "utf8")
    ).toContain("currentUnitCost: null");
  });
});
