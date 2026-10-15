import { describe, expect, it } from "vitest";
import {
  sharedSuggestion,
  suggestGroup,
  type SuggestTarget,
} from "@/lib/restaurant/groups/suggest";

const dish = (id: string, name: string): SuggestTarget => ({
  id,
  name,
  kind: "dish",
});
const group = (
  id: string,
  name: string,
  memberNames: string[] = []
): SuggestTarget => ({
  id,
  name,
  kind: "group",
  memberNames,
});

describe("suggestGroup (names only)", () => {
  const targets = [
    dish("d1", "Churrasco Típico"),
    dish("d2", "Parrilla Pinolera"),
    group("g1", "Lomo de aguja"),
    group("g2", "Refrescos", ["Coca-Cola 12 oz", "Sprite 12 oz"]),
  ];

  it("the same dish, whatever the size, side or accent", () => {
    for (const name of [
      "Churrasco Típico (6 oz.) (Puré, 3/4)",
      "CHURRASCO TIPICO (12 oz.) (Tostones) Eventos",
      "Churrasco Tipico 8oz",
    ]) {
      expect(suggestGroup(name, targets)).toMatchObject({
        target: { id: "d1" },
        reason: "plato",
      });
    }
  });

  it("every word of a group's name is in the item's name", () => {
    expect(suggestGroup("Lomo de aguja (Proveedor B)", targets)).toMatchObject({
      target: { id: "g1" },
      reason: "nombre",
    });
    // Fillers ("de") and accents do not matter.
    expect(suggestGroup("LOMO AGUJA AMERICANO", targets)).toMatchObject({
      target: { id: "g1" },
    });
  });

  it("the same base name as an item already grouped", () => {
    expect(suggestGroup("Coca-Cola 20 oz", targets)).toMatchObject({
      target: { id: "g2" },
      reason: "parecido",
    });
  });

  it("no clear answer, no suggestion", () => {
    expect(suggestGroup("Plato del Día Jueves", targets)).toBeNull();
    expect(suggestGroup("Varios Cocina", targets)).toBeNull();
    expect(suggestGroup("", targets)).toBeNull();
    // Two equally good groups: no guess.
    const two = [
      group("a", "Papas fritas"),
      group("b", "Papas fritas grandes"),
    ];
    expect(suggestGroup("Papas fritas grandes (Eventos)", two)).toMatchObject({
      target: { id: "b" },
    }); // more words wins
    const tie = [group("a", "Papas"), group("b", "Papas")];
    expect(suggestGroup("Papas con queso", tie)).toBeNull();
  });
});

describe("sharedSuggestion (the bulk button)", () => {
  const t1 = dish("d1", "Churrasco Típico");
  const t2 = dish("d2", "Puyazo");
  const map = new Map([
    ["a", { target: t1, reason: "plato" as const }],
    ["b", { target: t1, reason: "plato" as const }],
    ["c", { target: t2, reason: "plato" as const }],
    ["d", null],
  ]);
  it("one group when every selected row shares it", () => {
    expect(sharedSuggestion(map, ["a", "b"])?.id).toBe("d1");
  });
  it("none when they differ, when one has none, or when nothing is selected", () => {
    expect(sharedSuggestion(map, ["a", "c"])).toBeNull();
    expect(sharedSuggestion(map, ["a", "d"])).toBeNull();
    expect(sharedSuggestion(map, [])).toBeNull();
  });
});
