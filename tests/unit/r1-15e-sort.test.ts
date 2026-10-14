// R1-15e: click-to-sort. Missing values last in both directions, never 0.

import { describe, expect, it } from "vitest";
import {
  nextSort,
  sortRows,
  sortTree,
  type SortState,
} from "@/lib/restaurant/table-sort";

describe("nextSort", () => {
  it("cycles descending → ascending → default", () => {
    let s: SortState | null = null;
    s = nextSort(s, "ventas");
    expect(s).toEqual({ key: "ventas", dir: "desc" });
    s = nextSort(s, "ventas");
    expect(s).toEqual({ key: "ventas", dir: "asc" });
    s = nextSort(s, "ventas");
    expect(s).toBeNull();
  });
  it("another column starts descending", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "b")).toEqual({
      key: "b",
      dir: "desc",
    });
  });
  it("on the default column the first click flips it", () => {
    const def: SortState = { key: "ventas", dir: "desc" };
    expect(nextSort(null, "ventas", def)).toEqual({
      key: "ventas",
      dir: "asc",
    });
    expect(nextSort({ key: "ventas", dir: "asc" }, "ventas", def)).toBeNull();
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "b", v: 5 as number | null },
    { n: "a", v: null },
    { n: "c", v: 9 },
    { n: "d", v: 0 },
  ];
  const val = (r: (typeof rows)[number], k: string) => (k === "n" ? r.n : r.v);
  it("puts missing values last both ways and keeps a real 0 as 0", () => {
    const desc = sortRows(rows, { key: "v", dir: "desc" }, val).map((r) => r.n);
    const asc = sortRows(rows, { key: "v", dir: "asc" }, val).map((r) => r.n);
    expect(desc).toEqual(["c", "b", "d", "a"]);
    expect(asc).toEqual(["d", "b", "c", "a"]);
  });
  it("null state keeps the order; equal values keep it too", () => {
    expect(sortRows(rows, null, val)).toEqual(rows);
    const same = [
      { n: "x", v: 1 },
      { n: "y", v: 1 },
    ];
    expect(
      sortRows(same, { key: "v", dir: "desc" }, val).map((r) => r.n)
    ).toEqual(["x", "y"]);
  });
  it("sorts text without caring about accents or case", () => {
    const t = [
      { n: "Árbol", v: 1 },
      { n: "azul", v: 1 },
      { n: "Zeta", v: 1 },
    ];
    expect(sortRows(t, { key: "n", dir: "asc" }, val).map((r) => r.n)).toEqual([
      "Árbol",
      "azul",
      "Zeta",
    ]);
  });
});

describe("sortTree", () => {
  type N = { id: string; v: number | null; children: N[] };
  it("sorts groups among themselves and children inside, never moving a child out", () => {
    const tree: N[] = [
      {
        id: "g1",
        v: 10,
        children: [
          { id: "a", v: 1, children: [] },
          { id: "b", v: 5, children: [] },
        ],
      },
      {
        id: "g2",
        v: 30,
        children: [
          { id: "c", v: null, children: [] },
          { id: "d", v: 2, children: [] },
        ],
      },
    ];
    const out = sortTree(tree, { key: "v", dir: "desc" }, (n) => n.v);
    expect(out.map((n) => n.id)).toEqual(["g2", "g1"]);
    expect(out[0].children.map((n) => n.id)).toEqual(["d", "c"]);
    expect(out[1].children.map((n) => n.id)).toEqual(["b", "a"]);
  });
});
