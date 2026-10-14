import { describe, expect, it } from "vitest";
import { searchTree, type SearchNode } from "@/lib/restaurant/groups/search";

const leaf = (id: string, name: string): SearchNode => ({
  id,
  kind: "leaf",
  name,
  children: [],
});
const grp = (id: string, name: string, children: SearchNode[]): SearchNode => ({
  id,
  kind: "group",
  name,
  children,
});

const tree = [
  grp("g1", "Bebidas", [
    grp("g2", "Limonadas", [
      leaf("1", "Limonada rosa"),
      leaf("2", "Limonada de coco"),
    ]),
    leaf("3", "Café"),
  ]),
  grp("g3", "Carnes", [leaf("4", "Churrasco"), leaf("5", "Lomo")]),
  leaf("6", "Flan"),
];

describe("searchTree", () => {
  it("empty query changes nothing", () => {
    const r = searchTree(tree, "  ");
    expect(r.nodes).toHaveLength(3);
    expect(r.open.size).toBe(0);
  });
  it("a group name shows the group open with all its members", () => {
    const r = searchTree(tree, "limonadas");
    expect(r.nodes.map((n) => n.id)).toEqual(["g1"]);
    expect(r.nodes[0].children.map((n) => n.id)).toEqual(["g2"]);
    expect(r.nodes[0].children[0].children).toHaveLength(2);
    expect(r.open.has("g2")).toBe(true);
    expect(r.open.has("g1")).toBe(true);
  });
  it("a product match keeps its group rows, open, and only the match", () => {
    const r = searchTree(tree, "churrasco");
    expect(r.nodes.map((n) => n.id)).toEqual(["g3"]);
    expect(r.nodes[0].children.map((n) => n.id)).toEqual(["4"]);
    expect(r.open.has("g3")).toBe(true);
  });
  it("ignores accents and case; an ungrouped match stays top level", () => {
    expect(searchTree(tree, "CAFE").nodes[0].children[0].id).toBe("3");
    expect(searchTree(tree, "flan").nodes.map((n) => n.id)).toEqual(["6"]);
  });
  it("finds by extra text (supplier)", () => {
    const r = searchTree(tree, "acme", (n) => (n.id === "5" ? "Acme" : null));
    expect(r.nodes[0].children.map((n) => n.id)).toEqual(["5"]);
  });
});
