// Premise 5: nothing becomes a trusted ingredient by being typed or
// imported as a recipe line. Synthetic names only — no client data.

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  matchExistingIngredient,
  type CatalogIngredientRef,
} from "@/lib/restaurant/recipe-costing/ingredient-match";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const catalog: CatalogIngredientRef[] = [
  { id: "i-emp", name: "EMPANIZADOR", default_unit: "lb" },
  { id: "i-queso", name: "Queso cremado", default_unit: "oz" },
  { id: "i-aceite-1", name: "Aceite", default_unit: "oz" },
  { id: "i-aceite-2", name: "ACEITE", default_unit: "oz" },
];

describe("matchExistingIngredient", () => {
  it("matches case, accents and spacing exactly", () => {
    const hit = matchExistingIngredient("  queso  CREMADO ", catalog);
    expect(hit.kind).toBe("exact");
    if (hit.kind === "exact") expect(hit.ingredient.id).toBe("i-queso");
  });

  it("offers a typo as a possible match, never as an exact one", () => {
    const hit = matchExistingIngredient("EMPANIZAOR", catalog);
    expect(hit.kind).toBe("possible");
    if (hit.kind === "possible") {
      expect(hit.ingredient.name).toBe("EMPANIZADOR");
    }
  });

  it("refuses to guess between two same-named ingredients", () => {
    expect(matchExistingIngredient("aceite", catalog).kind).toBe("ambiguous");
  });

  it("does not treat SQL wildcards as a match", () => {
    expect(matchExistingIngredient("%", catalog).kind).toBe("none");
    expect(matchExistingIngredient("_", catalog).kind).toBe("none");
    expect(matchExistingIngredient("", catalog).kind).toBe("none");
  });

  it("returns none for a genuinely unknown name", () => {
    expect(matchExistingIngredient("Hierba rara", catalog).kind).toBe("none");
  });
});

// ---- Every path that can add an ingredient is a person's explicit act ----

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("no silent ingredient creation (source guards)", () => {
  it("only known, explicit paths can add an ingredient", () => {
    const inserting = [...sourceFiles("lib"), ...sourceFiles("app")].filter(
      (file) =>
        /from\("ingredients"\)\s*\.insert/.test(read(file)) ||
        /\.createIngredients\(/.test(read(file))
    );
    expect(inserting.sort()).toEqual(
      [
        // The Ingredientes page and supplier invoices: a person adds it.
        "app/api/restaurant/ingredients/route.ts",
        "app/api/restaurant/invoices/[id]/lines/route.ts",
        // The repository itself (the methods below call it).
        "lib/restaurant/cost-workbook/repo.ts",
        // Price-list rows that were read clearly (PR 2).
        "lib/restaurant/cost-workbook/persist.ts",
        // A person's pick on an unclear price-list row (PR B).
        "lib/restaurant/price-catalog/apply.ts",
        // "Agregar ingrediente" in the recipe editor (explicit).
        "lib/restaurant/recipe-costing/editor-store.ts",
        // Recipe import from the cost file: only after the person sees the
        // preview and clicks "Importar"; one per name, never a duplicate.
        "lib/restaurant/recipe-import/server.ts",
      ].sort()
    );
  });

  it("the old importer, its review routes and the hand builders are gone", () => {
    for (const file of [
      "lib/restaurant/cost-workbook/import.ts",
      "lib/restaurant/cost-workbook/persist-recipes.ts",
      "lib/restaurant/recipe-costing/review-server.ts",
      "app/api/restaurant/costs/upload/route.ts",
      "app/api/restaurant/costs/review/route.ts",
      "app/api/restaurant/recipes/review/fix/route.ts",
      "app/api/restaurant/recipes/component/[id]/route.ts",
      "app/api/restaurant/recipes/menu-item/[id]/route.ts",
      "components/restaurant/RecipeBuilder.tsx",
      "components/restaurant/ComponentRecipeBuilder.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(false);
    }
  });
});
