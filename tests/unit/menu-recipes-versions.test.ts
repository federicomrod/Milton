import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMenuRecipesData } from "@/lib/restaurant/menu-recipes-server";
import {
  isPendingRecipeCostStatus,
  pendingRecipesLabel,
} from "@/lib/restaurant/cost-workbook/copy";
import { createCappedSupabase, type MockRow } from "./helpers/capped-supabase";

const COMPANY_ID = "co-casa";

function makeClient(tables: Record<string, MockRow[]> = {}) {
  return createCappedSupabase({
    userId: "user-1",
    tables: {
      companies: [
        { id: COMPANY_ID, name: "Casa Prueba", preferred_language: "es" },
      ],
      restaurant_pos_connections: [],
      restaurant_locations: [
        { id: "loc-1", company_id: COMPANY_ID, country: "SV" },
      ],
      pos_sales_items: [],
      pos_item_mappings: [],
      menu_items: [],
      recipes: [],
      menu_recipe_inputs: [],
      prepared_components: [],
      component_recipes: [],
      component_recipe_inputs: [],
      ingredients: [],
      ingredient_cost_entries: [],
      suppliers: [],
      supplier_ingredients: [],
      recipe_versions: [],
      recipe_version_inputs: [],
      component_recipe_versions: [],
      component_recipe_version_inputs: [],
      ...tables,
    },
  }) as unknown as SupabaseClient;
}

describe("fetchMenuRecipesData — recipe versions", () => {
  it("marks an item with only an in_review version as pending, not costed", async () => {
    const supabase = makeClient({
      menu_items: [
        {
          id: "mi-1",
          company_id: COMPANY_ID,
          name: "DEDOS DE QUESO",
          category: "entradas",
          selling_price: 7.52,
          currency: "USD",
          status: "active",
          is_live: true,
        },
      ],
      recipes: [
        {
          id: "rec-1",
          company_id: COMPANY_ID,
          menu_item_id: "mi-1",
          status: "active",
          source_type: "import",
          workbook_cost_match: "match",
        },
      ],
      menu_recipe_inputs: [
        {
          id: "ri-1",
          company_id: COMPANY_ID,
          recipe_id: "rec-1",
          input_type: "ingredient",
          ingredient_id: "ing-1",
          component_id: null,
          quantity: 1,
          unit: "lb",
        },
      ],
      ingredients: [
        {
          id: "ing-1",
          company_id: COMPANY_ID,
          name: "QUESO GRATINADO",
          default_unit: "lb",
        },
      ],
      ingredient_cost_entries: [
        {
          id: "ce-1",
          company_id: COMPANY_ID,
          ingredient_id: "ing-1",
          supplier_id: null,
          source_type: "import",
          source_id: null,
          cost_date: "2026-04-01",
          created_at: "2026-04-01T00:00:00Z",
          quantity: 1,
          unit: "lb",
          total_cost: 2.4,
          unit_cost: 2.4,
          normalized_unit: "lb",
          normalized_unit_cost: 2.4,
          currency: "USD",
          notes: null,
        },
      ],
      recipe_versions: [
        {
          id: "rv-1",
          company_id: COMPANY_ID,
          recipe_id: "rec-1",
          menu_item_id: "mi-1",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          source_type: "import",
        },
      ],
      recipe_version_inputs: [
        {
          id: "rvi-1",
          company_id: COMPANY_ID,
          recipe_version_id: "rv-1",
          input_type: "ingredient",
          ingredient_id: "ing-1",
          component_id: null,
          quantity: 1,
          unit: "lb",
        },
      ],
    });

    const data = await fetchMenuRecipesData(supabase, COMPANY_ID, {
      posRows: [],
    });
    const dish = data.menuItems.find((row) => row.id === "mi-1");
    expect(dish?.cost.status).toBe("missing_recipe");
    expect(dish?.cost.cost).toBeNull();
    expect(isPendingRecipeCostStatus(dish!.cost.status)).toBe(true);
    expect(pendingRecipesLabel("es")).toBe("Pendiente de recetas");
  });

  it("a component with only an in_review version costs as soon as every line is priced (approval does not gate cost)", async () => {
    const supabase = makeClient({
      prepared_components: [
        {
          id: "comp-1",
          company_id: COMPANY_ID,
          name: "QUESO FRITO",
          category: "prep",
          output_unit: "unit",
          status: "active",
          notes: null,
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
        },
      ],
      component_recipes: [
        {
          id: "cr-1",
          company_id: COMPANY_ID,
          component_id: "comp-1",
          output_quantity: 1,
          output_unit: "unit",
          status: "active",
        },
      ],
      component_recipe_inputs: [
        {
          id: "cri-1",
          company_id: COMPANY_ID,
          component_recipe_id: "cr-1",
          input_type: "ingredient",
          ingredient_id: "ing-1",
          component_id: null,
          quantity: 1,
          unit: "oz",
        },
      ],
      ingredients: [
        {
          id: "ing-1",
          company_id: COMPANY_ID,
          name: "QUESO GRATINADO",
          default_unit: "oz",
        },
      ],
      ingredient_cost_entries: [
        {
          id: "ce-1",
          company_id: COMPANY_ID,
          ingredient_id: "ing-1",
          supplier_id: null,
          source_type: "import",
          source_id: null,
          cost_date: "2026-04-01",
          created_at: "2026-04-01T00:00:00Z",
          quantity: 1,
          unit: "oz",
          total_cost: 0.15,
          unit_cost: 0.15,
          normalized_unit: "oz",
          normalized_unit_cost: 0.15,
          currency: "USD",
          notes: null,
        },
      ],
      component_recipe_versions: [
        {
          id: "cv-1",
          company_id: COMPANY_ID,
          component_recipe_id: "cr-1",
          component_id: "comp-1",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          output_quantity: 1,
          output_unit: "unit",
          source_type: "import",
        },
      ],
      component_recipe_version_inputs: [
        {
          id: "cvi-1",
          company_id: COMPANY_ID,
          component_recipe_version_id: "cv-1",
          input_type: "ingredient",
          ingredient_id: "ing-1",
          component_id: null,
          quantity: 1,
          unit: "oz",
        },
      ],
    });

    const data = await fetchMenuRecipesData(supabase, COMPANY_ID, {
      posRows: [],
    });
    const component = data.components.find((row) => row.id === "comp-1");
    expect(component?.cost.status).toBe("complete");
    expect(component?.cost.cost_per_output_unit).toBeCloseTo(0.15, 10);
    expect(isPendingRecipeCostStatus(component!.cost.status)).toBe(false);
  });

  it("wires pending copy through menu, details, ingredients, and execute", () => {
    const menuServer = readFileSync(
      "lib/restaurant/menu-recipes-server.ts",
      "utf8"
    );
    expect(menuServer).toContain("fetchCostingRecipeVersions");
    expect(menuServer).toContain("recipe_versions");
    expect(menuServer).toContain("component_recipe_versions");

    const costingVersions = readFileSync(
      "lib/restaurant/costing-versions.ts",
      "utf8"
    );
    expect(costingVersions).toContain("recipe_versions");
    expect(costingVersions).toContain("component_recipe_versions");

    const profitability = readFileSync(
      "lib/restaurant/profitability-server.ts",
      "utf8"
    );
    expect(profitability).toContain("fetchCostingRecipeVersions");

    const ingredientsPage = readFileSync(
      "app/dashboard/restaurant/menu/ingredientes/page.tsx",
      "utf8"
    );
    expect(ingredientsPage).toContain("menu-recipes-server");
    expect(ingredientsPage).toContain("fetchIngredientLatestCosts");

    expect(pendingRecipesLabel("es")).toBe("Pendiente de recetas");
  });
});
