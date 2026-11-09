// #407 · one loss factor per ingredient line, across nested preparations.
// Demo names only.
import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  coveredByMeasuredPrep,
  factorsForTree,
  missingYield,
  type PrepNode,
  type TreeRecipe,
} from "@/lib/restaurant/nested-yield";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";

const BUFFER = 5;
const prep = (
  id: string,
  measured: boolean,
  ...children: string[]
): PrepNode => ({
  id,
  measured,
  children,
});
const graph = (...nodes: PrepNode[]) => new Map(nodes.map((n) => [n.id, n]));
const ing = (name: string, amount: number | null, loss: number | null = null) =>
  ({ name, amount, kind: "ingredient", ownYieldLossPct: loss }) as const;
const sub = (name: string, prepId: string, amount: number | null = 10) =>
  ({ name, amount, kind: "component", ownYieldLossPct: null, prepId }) as const;

const run = (root: TreeRecipe, recipes: TreeRecipe[], nodes: PrepNode[]) =>
  factorsForTree(
    root,
    new Map(recipes.map((r) => [r.prepId!, r])),
    graph(...nodes),
    BUFFER
  );
const factorOf = (rs: ReturnType<typeof run>, name: string) =>
  rs.find((r) => r.name === name)!;

describe("nested yield rule (#407)", () => {
  it("2 levels: an ingredient under a measured prep gets no factor", () => {
    const rs = run(
      { prepId: null, lines: [sub("Salsa demo", "salsa")] },
      [{ prepId: "salsa", lines: [ing("Tomate demo", 100)] }],
      [prep("salsa", true)]
    );
    expect(factorOf(rs, "Tomate demo")).toMatchObject({
      factor: "measured_prep",
      effective: 100,
    });
  });

  it("2 levels below a measured prep (plato > base > salsa): no factor", () => {
    const rs = run(
      { prepId: null, lines: [sub("Base demo", "base")] },
      [
        { prepId: "base", lines: [sub("Salsa demo", "salsa")] },
        { prepId: "salsa", lines: [ing("Tomate demo", 100)] },
      ],
      [prep("base", true, "salsa"), prep("salsa", false)]
    );
    expect(factorOf(rs, "Tomate demo").factor).toBe("measured_prep");
    expect(factorOf(rs, "Tomate demo").effective).toBe(100);
  });

  it("3 levels: measured only at the top still covers the bottom", () => {
    const rs = run(
      { prepId: null, lines: [sub("A", "a")] },
      [
        { prepId: "a", lines: [sub("B", "b")] },
        { prepId: "b", lines: [sub("C", "c")] },
        { prepId: "c", lines: [ing("Cebolla demo", 40)] },
      ],
      [prep("a", true, "b"), prep("b", false, "c"), prep("c", false)]
    );
    expect(factorOf(rs, "Cebolla demo")).toMatchObject({
      factor: "measured_prep",
      effective: 40,
    });
  });

  it("3 levels with no measured prep anywhere: buffer once", () => {
    const rs = run(
      { prepId: null, lines: [sub("A", "a")] },
      [
        { prepId: "a", lines: [sub("B", "b")] },
        { prepId: "b", lines: [sub("C", "c")] },
        { prepId: "c", lines: [ing("Cebolla demo", 40)] },
      ],
      [prep("a", false, "b"), prep("b", false, "c"), prep("c", false)]
    );
    expect(factorOf(rs, "Cebolla demo")).toMatchObject({
      factor: "kitchen_buffer",
      effective: 42,
    });
  });

  it("own yield inside a measured prep wins, applied once", () => {
    const rs = run(
      { prepId: null, lines: [sub("Salsa demo", "salsa")] },
      [
        {
          prepId: "salsa",
          lines: [ing("Tomate demo", 65, 35), ing("Sal demo", 5)],
        },
      ],
      [prep("salsa", true)]
    );
    expect(factorOf(rs, "Tomate demo")).toMatchObject({
      factor: "own_yield",
      effective: 100,
    });
    expect(factorOf(rs, "Sal demo").factor).toBe("measured_prep");
  });

  it("a prep with an assumed yield inside a plato: its lines take the buffer", () => {
    const rs = run(
      { prepId: null, lines: [sub("Aderezo demo", "ader")] },
      [{ prepId: "ader", lines: [ing("Mayonesa demo", 20)] }],
      [prep("ader", false)]
    );
    expect(factorOf(rs, "Mayonesa demo")).toMatchObject({
      factor: "kitchen_buffer",
      effective: 21,
    });
    expect(missingYield(graph(prep("ader", false)).get("ader")!)).toBe(true);
  });

  it("plato lines get only the buffer; the prep line itself none", () => {
    const rs = run(
      {
        prepId: null,
        lines: [
          ing("Pan demo", 30),
          ing("Carne demo", 70, 20),
          sub("Salsa demo", "salsa", 12),
        ],
      },
      [{ prepId: "salsa", lines: [ing("Tomate demo", 10)] }],
      [prep("salsa", true)]
    );
    expect(factorOf(rs, "Pan demo")).toMatchObject({
      factor: "kitchen_buffer",
      effective: 31.5,
    });
    expect(factorOf(rs, "Carne demo")).toMatchObject({
      factor: "own_yield",
      effective: 87.5,
    });
    expect(rs.find((r) => r.name === "Salsa demo")).toBeUndefined();
  });

  it("a missing or non-positive price is null, never $0", () => {
    const rs = run(
      {
        prepId: null,
        lines: [ing("Sin precio demo", null), sub("Salsa demo", "salsa")],
      },
      [{ prepId: "salsa", lines: [ing("Tomate demo", null)] }],
      [prep("salsa", true)]
    );
    for (const r of rs) {
      expect(r.effective).toBeNull();
      expect(r.raw).toBeNull();
    }
  });

  it("no line carries two factors: effective is one of raw, raw/(1-l), raw*(1+b)", () => {
    const nodes = [
      prep("a", true, "b"),
      prep("b", false, "c"),
      prep("c", true),
    ];
    for (const own of [null, 10, 35]) {
      const rs = run(
        { prepId: null, lines: [sub("A", "a")] },
        [
          { prepId: "a", lines: [sub("B", "b")] },
          { prepId: "b", lines: [sub("C", "c")] },
          { prepId: "c", lines: [ing("X demo", 50, own)] },
        ],
        nodes
      );
      const x = factorOf(rs, "X demo");
      const options = [50, own === null ? 50 : 50 / (1 - own / 100), 50 * 1.05];
      expect(options.some((o) => Math.abs(o - x.effective!) < 1e-9)).toBe(true);
      expect(x.effective).toBe(own === null ? 50 : 50 / (1 - own / 100));
    }
  });

  it("graph helpers: ancestors at any depth, measured covers below", () => {
    const g = graph(
      prep("a", true, "b"),
      prep("b", false, "c"),
      prep("c", false)
    );
    expect([...ancestorsOf("c", g)].sort()).toEqual(["a", "b"]);
    expect(coveredByMeasuredPrep("c", g)).toBe(true);
    expect(coveredByMeasuredPrep("a", graph(prep("a", false)))).toBe(false);
  });

  it("a single own-yield factor is cost ÷ (1 − loss)", () => {
    const r = effectiveLineCost({
      amount: 2.5,
      kind: "ingredient",
      ownYieldLossPct: 26.25,
      insideMeasuredPrep: true,
      bufferPct: 5,
    });
    expect(r.factor).toBe("own_yield");
    expect(r.effective).toBeCloseTo(2.5 / (1 - 0.2625), 9);
  });
});
