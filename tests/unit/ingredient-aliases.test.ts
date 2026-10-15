// Per-company memory of confirmed ingredient names. Synthetic data only.
// (Remembering happens in the recipe editor: see recipe-editor.test.ts.)

import { describe, expect, it } from "vitest";
import { matchExistingIngredient } from "@/lib/restaurant/recipe-costing/ingredient-match";

describe("ingredient name memory", () => {
  it("a remembered alias counts as an exact match in the picker", () => {
    const catalog = [
      { id: "i1", name: "Empanizador", default_unit: "lb" },
      { id: "i2", name: "Harina", default_unit: "lb" },
    ];
    expect(matchExistingIngredient("Empanizaor", catalog).kind).toBe(
      "possible"
    );
    const aliases = new Map([["empanizaor", "i1"]]);
    const hit = matchExistingIngredient("Empanizaor", catalog, aliases);
    expect(hit.kind).toBe("exact");
    if (hit.kind === "exact") expect(hit.ingredient.id).toBe("i1");
    // An alias pointing at a deleted ingredient is ignored.
    expect(
      matchExistingIngredient(
        "Empanizaor",
        catalog,
        new Map([["empanizaor", "gone"]])
      ).kind
    ).toBe("possible");
  });
});
