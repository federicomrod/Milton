// R1-15i: En uso / Sin uso. Synthetic recipes.
import { describe, expect, it } from "vitest";
import {
  computeIngredientUsage,
  matchesUsage,
  usageCounts,
  usageState,
} from "@/lib/restaurant/ingredient-usage";
import type { CostingRecipeInput } from "@/lib/restaurant/costing";

const ing = (id: string): CostingRecipeInput => ({
  input_type: "ingredient",
  ingredient_id: id,
  component_id: null,
  quantity: 1,
  unit: "oz",
});
const comp = (id: string): CostingRecipeInput => ({
  input_type: "component",
  ingredient_id: null,
  component_id: id,
  quantity: 1,
  unit: "oz",
});
const v = (id: string, n: number, status = "approved") => ({
  id,
  version_number: n,
  status,
});

const usage = computeIngredientUsage({
  menuVersionsByMenuItemId: new Map([
    ["dishA", [v("a1", 1), v("a2", 2)]], // newest version is the active one
    ["dishB", [v("b1", 1, "in_review")]], // a draft someone is building still counts
  ]),
  menuInputsByVersionId: new Map([
    ["a1", [ing("OLD")]], // only in the superseded v1
    ["a2", [ing("RES"), comp("SALSA")]],
    ["b1", [ing("DRAFT")]],
  ]),
  componentVersionsByComponentId: new Map([
    ["SALSA", [v("s1", 1)]],
    ["NESTED", [v("n1", 1)]],
    ["ORPHAN", [v("o1", 1)]],
  ]),
  componentInputsByVersionId: new Map([
    ["s1", [ing("TOMATE"), comp("NESTED")]],
    ["n1", [ing("AJO")]],
    ["o1", [ing("UNUSED_PREP_ONLY")]], // a preparation no dish uses
  ]),
});

describe("computeIngredientUsage", () => {
  it("counts direct lines of the active version, drafts included", () => {
    expect(usage.inUse.has("RES")).toBe(true);
    expect(usage.inUse.has("DRAFT")).toBe(true);
  });
  it("counts ingredients reached through preparations, nested too", () => {
    expect(usage.inUse.has("TOMATE")).toBe(true);
    expect(usage.inUse.has("AJO")).toBe(true);
  });
  it("does not count a superseded version or a preparation nobody uses", () => {
    expect(usage.inUse.has("OLD")).toBe(false);
    expect(usage.inUse.has("UNUSED_PREP_ONLY")).toBe(false);
  });
  it("counts dishes per ingredient once each", () => {
    expect(usage.dishCount.get("RES")).toBe(1);
  });
  it("survives a loop between preparations", () => {
    const loop = computeIngredientUsage({
      menuVersionsByMenuItemId: new Map([["d", [v("d1", 1)]]]),
      menuInputsByVersionId: new Map([["d1", [comp("X")]]]),
      componentVersionsByComponentId: new Map([
        ["X", [v("x1", 1)]],
        ["Y", [v("y1", 1)]],
      ]),
      componentInputsByVersionId: new Map([
        ["x1", [comp("Y"), ing("I")]],
        ["y1", [comp("X")]],
      ]),
    });
    expect(loop.inUse.has("I")).toBe(true);
  });
});

describe("states and counts", () => {
  const archivedIds = new Set(["OLD", "RES"]);
  it("an archived ingredient that a recipe uses again is in use, not archived", () => {
    expect(usageState("RES", usage, archivedIds)).toEqual({
      inUse: true,
      archived: false,
    });
    expect(usageState("OLD", usage, archivedIds)).toEqual({
      inUse: false,
      archived: true,
    });
    expect(usageState("NEW", usage, archivedIds)).toEqual({
      inUse: false,
      archived: false,
    });
  });
  it("Falta precio counts only what is in use; unused never count; Sin precio is not 0", () => {
    const items = [
      { id: "1", price: null, inUse: true, archived: false },
      { id: "2", price: 0, inUse: true, archived: false }, // a confirmed $0 is a price
      { id: "3", price: null, inUse: false, archived: false }, // unused: never asked for a price
      { id: "4", price: null, inUse: false, archived: true },
    ];
    const c = usageCounts(items);
    expect(c).toEqual({
      en_uso: 2,
      sin_uso: 2,
      todos: 4,
      falta_precio: 1,
      archivable: 1,
      archived: 1,
    });
    expect(
      items.filter((i) => matchesUsage(i, "en_uso")).map((i) => i.id)
    ).toEqual(["1", "2"]);
    expect(
      items.filter((i) => matchesUsage(i, "sin_uso")).map((i) => i.id)
    ).toEqual(["3", "4"]);
    expect(items.filter((i) => matchesUsage(i, "todos"))).toHaveLength(4);
  });
});
