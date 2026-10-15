// R1-15c (Agrupaciones F2): every grouping action is a pure function with an
// exact undo. Synthetic fixtures only.

import { describe, expect, it } from "vitest";
import {
  GroupOpError,
  addToGroup,
  applyOps,
  createGroup,
  groupOfItem,
  groupPath,
  mergeGroups,
  moveGroup,
  removeFromGroups,
  renameGroup,
  ungroupGroup,
  type GroupsState,
  type OpResult,
} from "@/lib/restaurant/groups/group-ops";
import type {
  StoredGroupMember,
  StoredItemGroup,
} from "@/lib/restaurant/groups/item-groups";

let n = 0;
const uuid = () => `id-${++n}`;
const P = { scope: "product" as const };

const grp = (
  over: Partial<StoredItemGroup> & { id: string; name: string }
): StoredItemGroup => ({
  restaurant_id: null,
  parent_id: null,
  scope: "product",
  dimension: null,
  menu_dish_id: null,
  source: "user",
  status: "confirmed",
  sort_order: 0,
  ...over,
});
const mem = (id: string, group_id: string, ref: string): StoredGroupMember => ({
  id,
  group_id,
  member_type: "pos_product",
  member_ref: ref,
  restaurant_id: null,
});
const prod = (ref: string) => ({ type: "pos_product" as const, ref });

const sorted = (s: GroupsState) => ({
  groups: [...s.groups].sort((a, b) => (a.id < b.id ? -1 : 1)),
  members: [...s.members].sort((a, b) => (a.id < b.id ? -1 : 1)),
});

/** Doing it and then undoing it gives back exactly the state before. */
function roundTrip(before: GroupsState, r: OpResult) {
  expect(sorted(applyOps(r.state, r.undo))).toEqual(sorted(before));
}

const empty: GroupsState = { groups: [], members: [] };

describe("createGroup", () => {
  it("creates a group with members, takes them out of their old group, and undoes exactly", () => {
    const before: GroupsState = {
      groups: [grp({ id: "g-old", name: "Viejo" })],
      members: [mem("m1", "g-old", "100"), mem("m2", "g-old", "200")],
    };
    const r = createGroup(before, {
      name: " Refrescos ",
      hierarchy: P,
      items: [prod("100"), prod("300")],
      uuid,
    });
    const g = r.state.groups.find((x) => x.name === "Refrescos")!;
    expect(g.source).toBe("user");
    expect(
      r.state.members
        .filter((m) => m.group_id === g.id)
        .map((m) => m.member_ref)
        .sort()
    ).toEqual(["100", "300"]);
    // 100 left "Viejo": one group per hierarchy.
    expect(r.state.members.filter((m) => m.member_ref === "100")).toHaveLength(
      1
    );
    expect(
      r.state.members
        .filter((m) => m.group_id === "g-old")
        .map((m) => m.member_ref)
    ).toEqual(["200"]);
    roundTrip(before, r);
  });

  it("nests under a parent and refuses a clashing sibling name (case and spaces ignored)", () => {
    const s: GroupsState = {
      groups: [grp({ id: "b", name: "Bebidas" })],
      members: [],
    };
    const ok = createGroup(s, {
      name: "Refrescos",
      hierarchy: P,
      parentId: "b",
      uuid,
    });
    expect(
      groupPath(
        ok.state,
        ok.state.groups.find((x) => x.name === "Refrescos")!.id
      )
    ).toBe("Bebidas › Refrescos");
    expect(() =>
      createGroup(s, { name: "  BEBIDAS ", hierarchy: P, uuid })
    ).toThrow(GroupOpError);
    // The same name under another parent is fine.
    expect(() =>
      createGroup(ok.state, { name: "Refrescos", hierarchy: P, uuid })
    ).not.toThrow();
    expect(() => createGroup(s, { name: "   ", hierarchy: P, uuid })).toThrow(
      /nombre/
    );
  });

  it("a restaurant-only group is its own slot: a shared membership is not taken away", () => {
    const s: GroupsState = {
      groups: [grp({ id: "shared", name: "Compartido" })],
      members: [mem("m1", "shared", "100")],
    };
    const r = createGroup(s, {
      name: "Solo R1",
      hierarchy: P,
      restaurantId: "R1",
      items: [prod("100")],
      uuid,
    });
    expect(r.state.members.filter((m) => m.member_ref === "100")).toHaveLength(
      2
    );
    expect(groupOfItem(r.state, prod("100"), P, "R1")!.name).toBe("Solo R1");
    expect(groupOfItem(r.state, prod("100"), P, "R2")!.name).toBe("Compartido");
    roundTrip(s, r);
  });

  it("groups menu dishes (creating their auto group) under a new group, and refuses an unsaved dish", () => {
    const r = createGroup(empty, {
      name: "Parrilla",
      hierarchy: P,
      dishes: [
        { menu_dish_id: "d1", name: "Churrasco Típico", restaurant_id: null },
      ],
      uuid,
    });
    const auto = r.state.groups.find((g) => g.menu_dish_id === "d1")!;
    expect(auto.source).toBe("auto");
    expect(groupPath(r.state, auto.id)).toBe("Parrilla › Churrasco Típico");
    roundTrip(empty, r);
    expect(() =>
      createGroup(empty, {
        name: "X",
        hierarchy: P,
        dishes: [
          {
            menu_dish_id: "auto:churrasco",
            name: "Churrasco",
            restaurant_id: null,
          },
        ],
        uuid,
      })
    ).toThrow(/guarda la agrupación/i);
  });
});

describe("addToGroup, removeFromGroups", () => {
  const base: GroupsState = {
    groups: [grp({ id: "a", name: "A" }), grp({ id: "b", name: "B" })],
    members: [mem("m1", "a", "1"), mem("m2", "a", "2"), mem("m3", "b", "3")],
  };

  it("moves items between groups (one group per hierarchy) and undoes", () => {
    const r = addToGroup(base, {
      groupId: "b",
      items: [prod("1"), prod("3"), prod("9")],
      uuid,
    });
    expect(
      r.state.members
        .filter((m) => m.group_id === "b")
        .map((m) => m.member_ref)
        .sort()
    ).toEqual(["1", "3", "9"]);
    expect(r.state.members.filter((m) => m.member_ref === "1")).toHaveLength(1);
    roundTrip(base, r);
  });

  it("adding what is already there changes nothing", () => {
    const r = addToGroup(base, { groupId: "a", items: [prod("1")], uuid });
    expect(r.ops.upsert_members).toEqual([]);
    expect(r.ops.delete_member_ids).toEqual([]);
  });

  it("removing items makes them sin agrupar and undoes", () => {
    const r = removeFromGroups(base, { items: [prod("1"), prod("3")] });
    expect(r.state.members.map((m) => m.member_ref)).toEqual(["2"]);
    roundTrip(base, r);
  });

  it("a dish goes up to a group and comes out again", () => {
    const s = createGroup(empty, {
      name: "Parrilla",
      hierarchy: P,
      dishes: [{ menu_dish_id: "d1", name: "Plato", restaurant_id: null }],
      uuid,
    }).state;
    const out = removeFromGroups(s, {
      dishes: [{ menu_dish_id: "d1", name: "Plato", restaurant_id: null }],
    });
    expect(
      out.state.groups.find((g) => g.menu_dish_id === "d1")!.parent_id
    ).toBeNull();
    roundTrip(s, out);
  });
});

describe("renameGroup, moveGroup", () => {
  const s: GroupsState = {
    groups: [
      grp({ id: "a", name: "A" }),
      grp({ id: "b", name: "B", parent_id: "a" }),
      grp({ id: "c", name: "C", parent_id: "b" }),
      grp({ id: "d", name: "D" }),
    ],
    members: [],
  };
  it("renames, refuses a sibling clash, and undoes", () => {
    const r = renameGroup(s, "d", "Nuevo");
    expect(r.state.groups.find((g) => g.id === "d")!.name).toBe("Nuevo");
    roundTrip(s, r);
    expect(() => renameGroup(s, "d", "a")).toThrow(GroupOpError);
    expect(renameGroup(s, "d", "D").ops.upsert_groups).toEqual([]);
  });
  it("moves a group, and never inside itself or its descendants", () => {
    const r = moveGroup(s, "c", "d");
    expect(groupPath(r.state, "c")).toBe("D › C");
    roundTrip(s, r);
    expect(() => moveGroup(s, "a", "c")).toThrow(/dentro de sí mismo/);
    expect(() => moveGroup(s, "a", "a")).toThrow(/dentro de sí mismo/);
    expect(
      moveGroup(s, "c", null).state.groups.find((g) => g.id === "c")!.parent_id
    ).toBeNull();
  });
});

describe("ungroupGroup, mergeGroups", () => {
  const s: GroupsState = {
    groups: [
      grp({ id: "top", name: "Bebidas" }),
      grp({ id: "ref", name: "Refrescos", parent_id: "top" }),
      grp({ id: "cola", name: "Colas", parent_id: "ref" }),
      grp({ id: "cer", name: "Cervezas", parent_id: "top" }),
      grp({ id: "auto", name: "Plato", source: "auto", menu_dish_id: "d1" }),
    ],
    members: [
      mem("m1", "ref", "1"),
      mem("m2", "ref", "2"),
      mem("m3", "cer", "3"),
      mem("m4", "cola", "4"),
    ],
  };

  it("dissolving a group frees its members and moves its sub-groups up, and undoes exactly", () => {
    const r = ungroupGroup(s, "ref");
    expect(r.state.groups.find((g) => g.id === "ref")).toBeUndefined();
    expect(r.state.groups.find((g) => g.id === "cola")!.parent_id).toBe("top");
    expect(r.state.members.map((m) => m.member_ref).sort()).toEqual(["3", "4"]);
    roundTrip(s, r);
  });

  it("an auto (Plato del menú) group is never dissolved or merged away", () => {
    expect(() => ungroupGroup(s, "auto")).toThrow(GroupOpError);
    expect(() => mergeGroups(s, ["ref", "auto"])).toThrow(GroupOpError);
  });

  it("combining keeps the first group with every member and sub-group of the others, and undoes", () => {
    const r = mergeGroups(s, ["cer", "ref"], "Bebidas frías");
    const keep = r.state.groups.find((g) => g.id === "cer")!;
    expect(keep.name).toBe("Bebidas frías");
    expect(r.state.groups.find((g) => g.id === "ref")).toBeUndefined();
    expect(
      r.state.members
        .filter((m) => m.group_id === "cer")
        .map((m) => m.member_ref)
        .sort()
    ).toEqual(["1", "2", "3"]);
    expect(r.state.groups.find((g) => g.id === "cola")!.parent_id).toBe("cer");
    // Nothing counted twice, nothing lost.
    expect(r.state.members).toHaveLength(s.members.length);
    roundTrip(s, r);
  });

  it("refuses to combine a group with one inside it, or two sub-groups with the same name", () => {
    expect(() => mergeGroups(s, ["top", "ref"])).toThrow(GroupOpError);
    const clash: GroupsState = {
      groups: [
        grp({ id: "x", name: "X" }),
        grp({ id: "y", name: "Y" }),
        grp({ id: "x1", name: "Mismo", parent_id: "x" }),
        grp({ id: "y1", name: "mismo", parent_id: "y" }),
      ],
      members: [],
    };
    expect(() => mergeGroups(clash, ["x", "y"])).toThrow(/Mismo|mismo/);
    expect(() => mergeGroups(clash, ["x"])).toThrow(/al menos dos/);
  });
});

describe("a sequence of actions, then every undo in reverse, gives back the start", () => {
  it("create → add → rename → merge → move → ungroup → undo all", () => {
    const start: GroupsState = {
      groups: [grp({ id: "g0", name: "Base" })],
      members: [mem("m0", "g0", "10")],
    };
    const steps: OpResult[] = [];
    let state = start;
    const run = (r: OpResult) => {
      steps.push(r);
      state = r.state;
    };
    run(
      createGroup(state, {
        name: "Uno",
        hierarchy: P,
        items: [prod("10"), prod("11")],
        uuid,
      })
    );
    const uno = state.groups.find((g) => g.name === "Uno")!.id;
    run(
      createGroup(state, {
        name: "Dos",
        hierarchy: P,
        items: [prod("12")],
        uuid,
      })
    );
    const dos = state.groups.find((g) => g.name === "Dos")!.id;
    run(addToGroup(state, { groupId: dos, items: [prod("11")], uuid }));
    run(renameGroup(state, dos, "Dos bis"));
    run(mergeGroups(state, [uno, dos]));
    run(moveGroup(state, uno, "g0"));
    run(ungroupGroup(state, uno));
    // Every product is in at most one group.
    const refs = state.members.map((m) => m.member_ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const r of [...steps].reverse()) state = applyOps(state, r.undo);
    expect(sorted(state)).toEqual(sorted(start));
  });
});

describe("other hierarchies", () => {
  it("preparations and ingredients are their own hierarchies; kinds do not mix", () => {
    const s: GroupsState = {
      groups: [grp({ id: "p", name: "Salsas", scope: "preparation" })],
      members: [],
    };
    const r = addToGroup(s, {
      groupId: "p",
      items: [{ type: "preparation", ref: "prep-1" }],
      uuid,
    });
    expect(r.state.members).toHaveLength(1);
    expect(() =>
      createGroup(s, {
        name: "Hijo",
        hierarchy: { scope: "ingredient" },
        parentId: "p",
        uuid,
      })
    ).toThrow(/mismo tipo/);
  });
});
