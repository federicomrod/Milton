// R1-15k: duplicate ingredients and merge planning. Synthetic names.
import { describe, expect, it } from "vitest";
import {
  buildQueue,
  chooseSurvivor,
  findDuplicateSets,
  ingredientKey,
  pairKey,
  planMerge,
  setKeyOf,
  similarIngredients,
  unitFamily,
  validateAiSets,
  type DupItem,
  type MergeCandidate,
} from "@/lib/restaurant/ingredient-duplicates";

const it_ = (
  id: string,
  name: string,
  unit: string | null = "oz",
  archived = false
): DupItem => ({ id, name, unit, archived });

describe("names", () => {
  it("fillers, accents, case and punctuation do not matter", () => {
    expect(ingredientKey("Aceite de Oliva")).toBe(
      ingredientKey("ACEITE  OLIVA.")
    );
    expect(similarIngredients("Jalapeño", "JALAPENO")).toBe(1);
  });
  it("a typo is a duplicate; numbers must match; different things are not", () => {
    expect(
      similarIngredients("ACEITE DE OLIVA", "ACEITE DE OIVA")
    ).not.toBeNull();
    expect(
      similarIngredients("ACEITE DE OLIVA", "ACEITE OLIVIA")
    ).not.toBeNull();
    expect(
      similarIngredients("Coca Cola 600 ml", "Coca Cola 350 ml")
    ).toBeNull();
    expect(similarIngredients("Pollo pechuga", "Pollo muslo")).toBeNull();
    expect(similarIngredients("Sal", "Sol")).toBeNull();
  });
  it("unit families", () => {
    expect(unitFamily("oz")).toBe("weight");
    expect(unitFamily("litros")).toBe("volume");
    expect(unitFamily("unit")).toBe("count");
    expect(unitFamily("???")).toBe("unknown");
  });
});

describe("findDuplicateSets", () => {
  const items = [
    it_("1", "ACEITE DE OLIVA"),
    it_("2", "ACEITE DE OIVA"),
    it_("3", "ACEITE OLIVIA"),
    it_("4", "Lomo de aguja"),
    it_("5", "Lomo de aguja", "ml"),
    it_("6", "Tomate"),
    it_("7", "Tomates", "oz", true),
    it_("8", "Cebolla morada"),
    it_("9", "Cebolla morada "),
  ];
  it("finds the cluster of three and the exact pair; ignores different unit families and archived ones", () => {
    const sets = findDuplicateSets(items);
    expect(sets.map((s) => s.ids.sort())).toEqual(
      expect.arrayContaining([
        ["1", "2", "3"],
        ["8", "9"],
      ])
    );
    expect(sets.some((s) => s.ids.includes("5"))).toBe(false); // ml vs oz
    expect(sets.some((s) => s.ids.includes("7"))).toBe(false); // archived
  });
  it("«No son iguales» is never suggested again", () => {
    const sets = findDuplicateSets(items, new Set([pairKey("8", "9")]));
    expect(sets.some((s) => s.ids.includes("8"))).toBe(false);
  });
  it("a rejected pair inside a cluster splits it instead of re-suggesting the pair", () => {
    const sets = findDuplicateSets(
      items,
      new Set([pairKey("1", "2"), pairKey("1", "3")])
    );
    // 1 is no longer linked to 2 or 3; 2 and 3 may still link.
    expect(sets.some((s) => s.ids.includes("1"))).toBe(false);
  });
  it("two restaurants' same ingredient is one company ingredient: nothing here depends on restaurants", () => {
    expect(findDuplicateSets([it_("a", "Sal"), it_("b", "Azúcar")])).toEqual(
      []
    );
  });
});

describe("the queue", () => {
  const items = [
    it_("1", "A1"),
    it_("2", "A2"),
    it_("3", "B1"),
    it_("4", "B2"),
    it_("5", "C1"),
    it_("6", "C2"),
  ];
  const detected = [
    {
      key: setKeyOf(["1", "2"]),
      ids: ["1", "2"],
      score: 0.9,
      source: "name" as const,
    },
    {
      key: setKeyOf(["3", "4"]),
      ids: ["3", "4"],
      score: 0.95,
      source: "name" as const,
    },
    {
      key: setKeyOf(["5", "6"]),
      ids: ["5", "6"],
      score: 0.8,
      source: "name" as const,
    },
  ];
  const stored = (
    key: string,
    ids: string[],
    status: any,
    skippedAt: string | null = null
  ) => ({
    id: `s-${key}`,
    ids,
    key,
    source: "name" as const,
    score: 0.9,
    status,
    skippedAt,
  });
  it("pending by score, «Ahora no» moves to the end and stays pending, accepted and rejected leave", () => {
    const q = buildQueue({
      detected,
      items,
      notDuplicates: new Set(),
      stored: [
        stored(
          setKeyOf(["3", "4"]),
          ["3", "4"],
          "skipped",
          "2026-10-15T10:00:00Z"
        ),
        stored(setKeyOf(["5", "6"]), ["5", "6"], "rejected"),
      ],
    });
    expect(q.map((e) => e.key)).toEqual([
      setKeyOf(["1", "2"]),
      setKeyOf(["3", "4"]),
    ]);
    expect(q[1].skipped).toBe(true);
    expect(q[1].storedId).toBe(`s-${setKeyOf(["3", "4"])}`);
  });
  it("skipping twice puts the newest skip last", () => {
    const q = buildQueue({
      detected,
      items,
      notDuplicates: new Set(),
      stored: [
        stored(
          setKeyOf(["1", "2"]),
          ["1", "2"],
          "skipped",
          "2026-10-15T11:00:00Z"
        ),
        stored(
          setKeyOf(["3", "4"]),
          ["3", "4"],
          "skipped",
          "2026-10-15T10:00:00Z"
        ),
      ],
    });
    expect(q.map((e) => e.key)).toEqual([
      setKeyOf(["5", "6"]),
      setKeyOf(["3", "4"]),
      setKeyOf(["1", "2"]),
    ]);
  });
  it("drops a set with an archived member or a rejected pair", () => {
    const q = buildQueue({
      detected,
      stored: [],
      notDuplicates: new Set([pairKey("5", "6")]),
      items: items.map((i) => (i.id === "2" ? { ...i, archived: true } : i)),
    });
    expect(q.map((e) => e.key)).toEqual([setKeyOf(["3", "4"])]);
  });
});

describe("merge planning", () => {
  const c = (
    id: string,
    name: string,
    over: Partial<MergeCandidate> = {}
  ): MergeCandidate => ({
    id,
    name,
    price: null,
    priceUnit: "oz",
    priceDate: null,
    priceSourced: false,
    priceEntryId: null,
    recipeCount: 0,
    lineCount: 0,
    ...over,
  });
  const cands = [
    c("1", "ACEITE DE OLIVA", {
      price: 0.42,
      priceDate: "2026-10-12",
      priceSourced: true,
      priceEntryId: "e1",
      recipeCount: 4,
      lineCount: 4,
    }),
    c("2", "ACEITE DE OIVA", {
      price: 0.38,
      priceDate: "2026-09-02",
      priceSourced: true,
      priceEntryId: "e2",
      recipeCount: 2,
      lineCount: 2,
    }),
    c("3", "ACEITE OLIVIA", { recipeCount: 1, lineCount: 1 }),
  ];
  it("survivor = sourced price, most recent date", () => {
    expect(chooseSurvivor(cands)).toBe("1");
    expect(chooseSurvivor([...cands].reverse())).toBe("1");
  });
  it("without any price: the one more recipes use, then the name", () => {
    expect(
      chooseSurvivor([
        c("a", "B", { recipeCount: 1 }),
        c("b", "A", { recipeCount: 3 }),
      ])
    ).toBe("b");
  });
  it("a price conflict is offered, never averaged; the survivor's own price is the default", () => {
    const p = planMerge(cands, "1");
    expect(p.priceConflict).toBe(true);
    expect(p.priceOptions.map((o) => o.price)).toEqual([0.42, 0.38]);
    expect(p.defaultEntryId).toBe("e1");
    expect(p.linesReassigned).toBe(3);
    expect(p.loserIds.sort()).toEqual(["2", "3"]);
  });
  it("changing the survivor changes the plan; a missing price is Sin precio, not 0", () => {
    const p = planMerge(cands, "3");
    expect(p.defaultEntryId).toBe("e1"); // the survivor has none: the newest priced one
    expect(p.priceOptions.every((o) => o.price !== 0)).toBe(true);
    expect(planMerge([c("1", "A"), c("2", "B")], "1").priceConflict).toBe(
      false
    );
    expect(
      planMerge([c("1", "A"), c("2", "B")], "1").defaultEntryId
    ).toBeNull();
  });
});

describe("AI suggestions are validated like the heuristics", () => {
  const sent = [
    it_("1", "A"),
    it_("2", "B"),
    it_("3", "C", "ml"),
    it_("4", "D"),
    it_("5", "E"),
  ];
  it("keeps known ids, once each, 2–6, one unit family, no rejected pair", () => {
    const out = validateAiSets(
      {
        sets: [
          { ids: ["1", "2", "99"] },
          { ids: ["2", "4"] },
          { ids: ["1", "3"] },
          { ids: ["4", "5"] },
          { ids: ["5"] },
        ],
      },
      sent,
      new Set([pairKey("4", "5")])
    );
    expect(out.map((s) => s.ids)).toEqual([["1", "2"]]);
    expect(out[0].source).toBe("ai");
  });
  it("garbage in, nothing out", () => {
    expect(validateAiSets("x", sent)).toEqual([]);
    expect(validateAiSets({ sets: "x" }, sent)).toEqual([]);
  });
});
