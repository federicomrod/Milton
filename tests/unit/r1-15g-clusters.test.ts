// R1-15g: Milton's group suggestions (name/category heuristics + AI validation). Synthetic.

import { describe, expect, it } from "vitest";
import {
  clusterSuggestions,
  leftOver,
  pluralName,
  type ClusterItem,
} from "@/lib/restaurant/groups/cluster-suggest";
import { validateAiClusters } from "@/lib/restaurant/groups/ai-clusters";

const item = (ref: string, name: string, category?: string): ClusterItem => ({
  ref,
  name,
  category,
});

describe("pluralName", () => {
  it("makes a group name from a word", () => {
    expect(pluralName("cerveza")).toBe("Cervezas");
    expect(pluralName("papas")).toBe("Papas");
    expect(pluralName("whisky")).toBe("Whisky");
    expect(pluralName("frozen")).toBe("Frozen");
  });
});

describe("clusterSuggestions", () => {
  const items = [
    item("1", "Cerveza Toña"),
    item("2", "Cerveza Pilsener"),
    item("3", "Cerveza Suprema"),
    item("4", "Agua Cristal"),
    item("5", "Agua Mineral"),
    item("6", "Postre del día", "Dulces"),
    item("7", "Flan", "Dulces"),
    item("8", "Tres leches", "Dulces"),
    item("9", "Varios cocina"),
    item("10", "Sopa de casa"),
    item("11", "Café negro"),
    item("12", "Ensalada mixta"),
  ];
  it("groups three or more items with the same first word", () => {
    const c = clusterSuggestions(items);
    const beer = c.find((x) => x.name === "Cervezas")!;
    expect(beer.reason).toBe("nombre");
    expect(beer.refs.sort()).toEqual(["1", "2", "3"]);
  });
  it("never suggests the same name twice", () => {
    const names = clusterSuggestions([
      ...["a", "b", "c"].map((r) => item(r, `Vino ${r}`)),
      ...["d", "e", "f", "g"].map((r) => item(r, `Tinto ${r}`, "Vinos")),
    ]).map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
  it("two items are not a cluster", () => {
    expect(clusterSuggestions(items).some((x) => x.name === "Aguas")).toBe(
      false
    );
  });
  it("groups by a shared category", () => {
    const c = clusterSuggestions(items).find((x) => x.name === "Dulces")!;
    expect(c.reason).toBe("categoria");
    expect(c.refs.sort()).toEqual(["6", "7", "8"]);
  });
  it("skips excluded items, taken names, and never suggests one item twice", () => {
    const c = clusterSuggestions(items, {
      exclude: new Set(["1"]),
      takenNames: new Set(["Dulces"]),
    });
    expect(c.some((x) => x.name === "Cervezas")).toBe(false);
    expect(c.some((x) => x.name === "Dulces")).toBe(false);
    const refs = clusterSuggestions(items).flatMap((x) => x.refs);
    expect(new Set(refs).size).toBe(refs.length);
  });
  it("a generic category is not a group, and a cluster holding most of the list is not either", () => {
    const generic = ["a", "b", "c", "d"].map((r) =>
      item(r, `Nombre${r}`, "Platos")
    );
    expect(clusterSuggestions(generic)).toEqual([]);
    const same = ["a", "b", "c", "d", "e"].map((r) => item(r, `Pollo ${r}`));
    expect(clusterSuggestions(same)).toEqual([]);
  });
  it("leftOver is what no cluster took", () => {
    const c = clusterSuggestions(items);
    const left = leftOver(items, c).map((i) => i.ref);
    expect(left).toContain("9");
    expect(left).not.toContain("1");
  });
});

describe("validateAiClusters", () => {
  const sent = [item("1", "A"), item("2", "B"), item("3", "C"), item("4", "D")];
  it("keeps valid groups only: known refs, once each, 2 or more", () => {
    const out = validateAiClusters(
      {
        groups: [
          { name: "Uno", refs: ["1", "2", "99"] },
          { name: "Repite", refs: ["2", "3"] },
          { name: "Solo", refs: ["4"] },
          { name: "", refs: ["3", "4"] },
          { name: "Dos", refs: ["3", "4", "3"] },
        ],
      },
      sent
    );
    expect(out.map((c) => [c.name, c.refs])).toEqual([
      ["Uno", ["1", "2"]],
      ["Dos", ["3", "4"]],
    ]);
  });
  it("drops names that already exist and garbage input", () => {
    expect(
      validateAiClusters(
        { groups: [{ name: "Bebidas", refs: ["1", "2"] }] },
        sent,
        new Set(["bebidas"])
      )
    ).toEqual([]);
    expect(validateAiClusters("nope", sent)).toEqual([]);
    expect(validateAiClusters({ groups: "x" }, sent)).toEqual([]);
  });
});

import {
  applyOps,
  confirmSuggestion,
  createGroup,
  createSuggestedGroups,
  ungroupGroup,
  type GroupsState,
} from "@/lib/restaurant/groups/group-ops";
import { buildGroupTree } from "@/lib/restaurant/costing/rollup";
import { productTreeInputs } from "@/lib/restaurant/groups/item-groups";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const empty: GroupsState = { groups: [], members: [] };
const H = { scope: "product" as const };

describe("stored suggestions", () => {
  it("are stored as ai_suggested/suggested and do not count as grouped", () => {
    const r = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      clusters: [{ name: "Cervezas", refs: ["1", "2", "3"] }],
      uuid,
    });
    const g = r.state.groups[0];
    expect(g.source).toBe("ai_suggested");
    expect(g.status).toBe("suggested");
    expect(r.state.members).toHaveLength(3);
    const tree = buildGroupTree({
      leaves: ["1", "2", "3"].map((ref) => ({
        key: ref,
        ref,
        name: ref,
        units: 1,
        net_sales: 10,
        cost_total: null,
        covered: false,
        status: "falta_precio" as const,
      })),
      ...productTreeInputs({ available: true, ...r.state }),
    });
    expect(tree.ungrouped).toHaveLength(3);
  });

  it("accepting confirms the group; undo goes back to a suggestion", () => {
    const made = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      clusters: [{ name: "Cervezas", refs: ["1", "2"] }],
      uuid,
    });
    const ok = confirmSuggestion(made.state, made.state.groups[0].id);
    expect(ok.state.groups[0].status).toBe("confirmed");
    expect(ok.state.groups[0].source).toBe("ai_suggested");
    expect(applyOps(ok.state, ok.undo).groups[0].status).toBe("suggested");
  });

  it("dismissing removes the suggestion and its members", () => {
    const made = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      clusters: [{ name: "Cervezas", refs: ["1", "2"] }],
      uuid,
    });
    const gone = ungroupGroup(made.state, made.state.groups[0].id);
    expect(gone.state.groups).toHaveLength(0);
    expect(gone.state.members).toHaveLength(0);
  });

  it("grouping an item by hand takes it out of a suggestion (one group per item)", () => {
    const made = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      clusters: [{ name: "Cervezas", refs: ["1", "2"] }],
      uuid,
    });
    const mine = createGroup(made.state, {
      name: "Mis bebidas",
      hierarchy: H,
      items: [{ type: "pos_product", ref: "1" }],
      uuid,
    });
    const owners = mine.state.members.filter((m) => m.member_ref === "1");
    expect(owners).toHaveLength(1);
    expect(owners[0].group_id).toBe(
      mine.state.groups.find((g) => g.name === "Mis bebidas")!.id
    );
  });

  it("skips a suggestion whose name already exists", () => {
    const base = createGroup(empty, { name: "Cervezas", hierarchy: H, uuid });
    const r = createSuggestedGroups(base.state, {
      hierarchy: H,
      itemType: "pos_product",
      clusters: [{ name: "cervezas", refs: ["1", "2"] }],
      uuid,
    });
    expect(r.state.groups).toHaveLength(1);
  });
});
