// R1-15h: after a rename, every place that lists or searches groups uses the
// new name right away, a stale server copy cannot bring the old one back, and
// suggestions never mix restaurants. Synthetic.
import { describe, expect, it } from "vitest";
import {
  applyOps,
  confirmSuggestion,
  createGroup,
  createSuggestedGroups,
  groupPath,
  renameGroup,
  replayOps,
  type GroupsState,
} from "@/lib/restaurant/groups/group-ops";
import { buildGroupTree, type TreeLeaf } from "@/lib/restaurant/costing/rollup";
import { productTreeInputs } from "@/lib/restaurant/groups/item-groups";
import { searchTree } from "@/lib/restaurant/groups/search";
import { valueGroupsFor } from "@/lib/restaurant/menu-dishes/drill";
import { clusterSuggestions } from "@/lib/restaurant/groups/cluster-suggest";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const H = { scope: "product" as const };
const leaf = (ref: string, name: string, restaurant?: string): TreeLeaf => ({
  key: ref,
  ref,
  name,
  units: 1,
  net_sales: 10,
  cost_total: null,
  covered: false,
  status: "falta_precio",
  restaurant_ids: restaurant ? [restaurant] : null,
});
const empty: GroupsState = { groups: [], members: [] };

function setup() {
  const made = createGroup(empty, {
    name: "Bebidas con Licor",
    hierarchy: H,
    uuid,
    items: [
      { type: "pos_product", ref: "1" },
      { type: "pos_product", ref: "2" },
    ],
  });
  const renamed = renameGroup(made.state, made.state.groups[0].id, "Cocktails");
  return { made, renamed };
}
const names = (state: GroupsState) => state.groups.map((g) => g.name);

describe("a rename reaches every consumer", () => {
  it("the tree, the search, the picker path and the taken names all say Cocktails", () => {
    const { renamed } = setup();
    const tree = buildGroupTree({
      leaves: [leaf("1", "Mojito"), leaf("2", "Cuba Libre"), leaf("3", "Flan")],
      ...productTreeInputs({ available: true, ...renamed.state }),
    });
    expect(tree.top.some((x) => x.name === "Cocktails")).toBe(true);
    // Search finds the new name, not the old one.
    expect(searchTree(tree.top, "cocktails").nodes.map((x) => x.name)).toEqual([
      "Cocktails",
    ]);
    expect(searchTree(tree.top, "licor").nodes).toEqual([]);
    // Picker path and the names a suggestion must avoid.
    expect(groupPath(renamed.state, renamed.state.groups[0].id)).toBe(
      "Cocktails"
    );
    expect(names(renamed.state)).toEqual(["Cocktails"]);
    expect(
      clusterSuggestions(
        ["a", "b", "c"].map((r) => ({ ref: r, name: `Cocktails ${r}` })),
        { takenNames: new Set(names(renamed.state)) }
      )
    ).toEqual([]);
  });

  it("the Desglose header uses the group's current name (value groups too)", () => {
    const made = createGroup(empty, {
      name: "Papas",
      uuid,
      hierarchy: {
        scope: "dimension_value",
        dimension: "side",
        menu_dish_id: "d1",
      },
      items: [{ type: "dimension_value", ref: "Puré" }],
    });
    const renamed = renameGroup(
      made.state,
      made.state.groups[0].id,
      "Papas y puré"
    );
    const out = valueGroupsFor(
      renamed.state.groups,
      renamed.state.members,
      "side",
      "d1"
    );
    expect(out.map((g) => g.name)).toEqual(["Papas y puré"]);
  });

  it("a stale server copy cannot bring the old name back (replayed over)", () => {
    const { made, renamed } = setup();
    // The copy the browser got BEFORE the rename still says "Bebidas con Licor".
    const stale = made.state;
    const log = [made.ops, renamed.ops];
    expect(names(replayOps(stale, log))).toEqual(["Cocktails"]);
    // An empty (older still) copy gets the group back too.
    expect(names(replayOps(empty, log))).toEqual(["Cocktails"]);
    // A copy that already has the rename is unchanged by the replay.
    expect(names(replayOps(renamed.state, log))).toEqual(["Cocktails"]);
  });

  it("renaming a suggestion while accepting it stores the new name", () => {
    const made = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      uuid,
      clusters: [{ name: "Bebidas con Licor", refs: ["1", "2"] }],
    });
    const ok = confirmSuggestion(
      made.state,
      made.state.groups[0].id,
      "Cocktails"
    );
    expect(ok.state.groups[0].name).toBe("Cocktails");
    expect(ok.state.groups[0].status).toBe("confirmed");
    expect(applyOps(ok.state, ok.undo).groups[0].name).toBe(
      "Bebidas con Licor"
    );
  });
});

describe("restaurants are never mixed", () => {
  const items = [
    ...["1", "2", "3"].map((r) => ({
      ref: `a${r}`,
      name: `Cerveza ${r}`,
      restaurant: "R1",
    })),
    ...["1", "2", "3"].map((r) => ({
      ref: `b${r}`,
      name: `Cerveza ${r}`,
      restaurant: "R2",
    })),
    ...["x", "y", "z"].map((r) => ({
      ref: `s${r}`,
      name: `Vino ${r}`,
      restaurant: null,
    })),
  ];
  it("per-restaurant suggestions: each cluster holds one restaurant's products, tagged", () => {
    const out = clusterSuggestions(items, { perRestaurant: true });
    const beers = out.filter((c) => c.name === "Cervezas");
    expect(beers.map((c) => c.restaurantId).sort()).toEqual(["R1", "R2"]);
    for (const c of beers) {
      const owner = c.restaurantId === "R1" ? "a" : "b";
      expect(c.refs.every((r) => r.startsWith(owner))).toBe(true);
    }
    // Products sold in both / unknown form their own (shared) suggestion.
    expect(out.find((c) => c.name === "Vinos")?.restaurantId).toBeNull();
  });
  it("the same name may exist once per restaurant scope", () => {
    const out = clusterSuggestions(items, {
      perRestaurant: true,
      takenFor: (r) => new Set(r === "R1" ? ["Cervezas"] : []),
    });
    expect(
      out.filter((c) => c.name === "Cervezas").map((c) => c.restaurantId)
    ).toEqual(["R2"]);
  });
  it("a suggestion is stored with its restaurant and counts only for that restaurant's products", () => {
    const made = createSuggestedGroups(empty, {
      hierarchy: H,
      itemType: "pos_product",
      uuid,
      clusters: [{ name: "Cervezas", refs: ["a1", "a2"], restaurantId: "R1" }],
    });
    const ok = confirmSuggestion(made.state, made.state.groups[0].id);
    expect(ok.state.groups[0].restaurant_id).toBe("R1");
    const tree = buildGroupTree({
      leaves: [
        leaf("a1", "Cerveza 1", "R1"),
        leaf("a2", "Cerveza 2", "R1"),
        leaf("b1", "Cerveza 1", "R2"),
      ],
      ...productTreeInputs({ available: true, ...ok.state }),
    });
    const g = tree.top.find((x) => x.name === "Cervezas")!;
    expect(g.rollup.row_count).toBe(2);
    expect(tree.ungrouped.map((l) => l.ref)).toEqual(["b1"]);
  });
  it("a restaurant-only group of a restaurant not in view is not shown", () => {
    const made = createGroup(empty, {
      name: "Cervezas",
      hierarchy: H,
      uuid,
      restaurantId: "R2",
      items: [{ type: "pos_product", ref: "b1" }],
    });
    const tree = buildGroupTree({
      leaves: [leaf("a1", "Cerveza 1", "R1")],
      ...productTreeInputs({ available: true, ...made.state }),
    });
    expect(tree.top.some((x) => x.name === "Cervezas")).toBe(false);
  });
  it("the Plato del menú level is never hidden by the restaurant it was created for", () => {
    const tree = buildGroupTree({
      leaves: [
        {
          ...leaf("a1", "Bistec (6 oz)", "R1"),
          menu_dish_id: "d1",
          menu_dish_name: "Bistec",
        },
      ],
      groups: [
        {
          id: "g-auto",
          name: "Bistec",
          parent_id: null,
          restaurant_id: "R2",
          source: "auto",
          status: "confirmed",
          menu_dish_id: "d1",
        },
      ],
      members: [],
    });
    expect(tree.top.map((x) => x.name)).toEqual(["Bistec"]);
  });
});
