// Kitchen volume words (taza, cucharada, cucharadita): a FIXED factor, only for
// volume, always with a visible note. Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  convertVolumeWord,
  mapKitchenUnit,
  volumeWord,
} from "@/lib/restaurant/kitchen-units";
import { matchIngredients } from "@/lib/restaurant/telegram/kitchen-recipe-drafts";

describe("volumeWord", () => {
  it.each([
    ["taza", 240, "taza"],
    ["tazas", 240, "taza"],
    ["TAZA", 240, "taza"],
    ["cup", 240, "taza"],
    ["cucharada", 15, "cucharada"],
    ["cdas", 15, "cucharada"],
    ["tbsp", 15, "cucharada"],
    ["cucharadita", 5, "cucharadita"],
    ["Cucharaditas", 5, "cucharadita"],
    ["cdta", 5, "cucharadita"],
    ["tsp", 5, "cucharadita"],
  ])("%s", (word, ml, label) => {
    expect(volumeWord(word)).toEqual({ ml, label });
  });

  it("never reads a count, a weight or an unknown word as volume", () => {
    for (const w of [
      "libra",
      "onza",
      "g",
      "kg",
      "pza",
      "unidad",
      "pizca",
      "cucharadita rara",
      "",
      null,
      undefined,
    ])
      expect(volumeWord(w as string | null)).toBeNull();
  });
});

describe("convertVolumeWord", () => {
  it.each([
    [1, "taza", 240, "1 taza = 240 ml"],
    [2, "tazas", 480, "2 tazas = 480 ml"],
    [0.5, "taza", 120, "0.5 tazas = 120 ml"],
    [3, "cucharadas", 45, "3 cucharadas = 45 ml"],
    [1, "cucharadita", 5, "1 cucharadita = 5 ml"],
    [2, "tsp", 10, "2 cucharaditas = 10 ml"],
  ])("%s %s", (qty, word, ml, note) => {
    expect(convertVolumeWord(qty, word)).toEqual({
      quantity: ml,
      unit: "ml",
      note,
    });
  });

  it("returns null for other words and for no usable quantity", () => {
    expect(convertVolumeWord(2, "libra")).toBeNull();
    expect(convertVolumeWord(2, "g")).toBeNull();
    expect(convertVolumeWord(2, "pza")).toBeNull();
    expect(convertVolumeWord(2, "pizca")).toBeNull();
    expect(convertVolumeWord(null, "taza")).toBeNull();
    expect(convertVolumeWord(0, "taza")).toBeNull();
  });

  it("mapKitchenUnit never maps a volume word by itself (no silent ml)", () => {
    expect(mapKitchenUnit("taza")).toBeNull();
    expect(mapKitchenUnit("cucharada")).toBeNull();
    expect(mapKitchenUnit("cucharadita")).toBeNull();
    expect(mapKitchenUnit("libra")).toBe("lb");
    expect(mapKitchenUnit("onza")).toBe("oz");
  });
});

describe("matchIngredients keeps the written volume word", () => {
  const run = (unit: string | null, qty: number | null) =>
    matchIngredients(
      [{ name: "leche", estimated_quantity: qty, unit, confidence: "high" }],
      [],
      new Map(),
      null
    )[0];

  it("taza stays «taza» with its quantity; ml-less, never converted here", () => {
    expect(run("tazas", 2)).toMatchObject({ unit: "tazas", total_quantity: 2 });
    expect(run(" taza ", 1)).toMatchObject({ unit: "taza" });
  });

  it("other unmapped words still store null; mapped ones are unchanged", () => {
    expect(run("pizca", 1)?.unit).toBeNull();
    expect(run("libras", 1)?.unit).toBe("lb");
    expect(run("g", 5)?.unit).toBe("g");
  });
});
