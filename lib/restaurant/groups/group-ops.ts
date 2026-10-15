// lib/restaurant/groups/group-ops.ts
//
// R1-15c (Agrupaciones F2): every grouping action as a PURE function on the
// groups and memberships already in the browser. Each returns the next state
// (shown at once, optimistically), the `ops` to save in one transaction
// (migration 049, item_groups_apply) and the `undo` ops that put everything
// back ("Deshacer", or a rollback when the save fails).
//
// Rules the actions keep (agrupaciones-proposal.md):
//   * a member belongs to exactly ONE group per hierarchy: adding it to a
//     group takes it out of its previous explicit group;
//   * siblings do not repeat a name;
//   * a group never goes inside itself or its own descendants;
//   * nothing is deleted but the group a person dissolves: its members go
//     back to "sin agrupar" and its sub-groups move up one level;
//   * the Plato del menú auto groups can be nested and renamed but never
//     merged away or dissolved (they follow the menu dishes).
//
// The server never trusts these ops: RLS, the unique index and the triggers
// of 048 re-check everything.

import type {
  GroupDimension,
  GroupMemberType,
  GroupScope,
  StoredGroupMember,
  StoredItemGroup,
} from "./item-groups";

export interface GroupsState {
  groups: StoredItemGroup[];
  members: StoredGroupMember[];
}

export interface GroupOps {
  delete_member_ids: string[];
  delete_group_ids: string[];
  upsert_groups: StoredItemGroup[];
  upsert_members: StoredGroupMember[];
}

export interface OpResult {
  state: GroupsState;
  ops: GroupOps;
  undo: GroupOps;
  /** What happened, for the "Deshacer" toast. */
  label: string;
}

export class GroupOpError extends Error {}

export const EMPTY_OPS: GroupOps = {
  delete_member_ids: [],
  delete_group_ids: [],
  upsert_groups: [],
  upsert_members: [],
};

export function isEmptyOps(ops: GroupOps): boolean {
  return (
    ops.delete_member_ids.length === 0 &&
    ops.delete_group_ids.length === 0 &&
    ops.upsert_groups.length === 0 &&
    ops.upsert_members.length === 0
  );
}

/** What a hierarchy is: products are one; a dimension value is per dimension (and dish). */
export interface Hierarchy {
  scope: GroupScope;
  dimension?: GroupDimension | null;
  menu_dish_id?: string | null;
}

export interface ItemRef {
  type: GroupMemberType;
  ref: string;
}

/** A menu dish used as an item to group (its auto group is created if needed). */
export interface DishRef {
  menu_dish_id: string;
  name: string;
  restaurant_id: string | null;
}

type Uuid = () => string;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const sameHierarchy = (g: StoredItemGroup, h: Hierarchy) =>
  g.scope === h.scope &&
  (g.dimension ?? null) === (h.dimension ?? null) &&
  (g.scope !== "dimension_value" ||
    (g.menu_dish_id ?? null) === (h.menu_dish_id ?? null));

const memberKey = (m: { member_type: string; member_ref: string }) =>
  `${m.member_type}:${m.member_ref}`;
const itemKey = (i: ItemRef) => `${i.type}:${i.ref}`;

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export function applyOps(state: GroupsState, ops: GroupOps): GroupsState {
  const deletedGroups = new Set(ops.delete_group_ids);
  const deletedMembers = new Set(ops.delete_member_ids);
  const groups = new Map(state.groups.map((g) => [g.id, g]));
  for (const id of deletedGroups) groups.delete(id);
  for (const g of ops.upsert_groups) groups.set(g.id, g);
  const members = new Map(state.members.map((m) => [m.id, m]));
  for (const id of deletedMembers) members.delete(id);
  for (const m of ops.upsert_members) members.set(m.id, m);
  // A deleted group takes its members with it (the database cascades).
  for (const m of [...members.values()]) {
    if (!groups.has(m.group_id)) members.delete(m.id);
  }
  return { groups: [...groups.values()], members: [...members.values()] };
}

/** The ops that put `before` back after `ops` were applied to it. */
function inverseOf(before: GroupsState, ops: GroupOps): GroupOps {
  const beforeGroups = new Map(before.groups.map((g) => [g.id, g]));
  const beforeMembers = new Map(before.members.map((m) => [m.id, m]));
  const upsert_groups: StoredItemGroup[] = [];
  const delete_group_ids: string[] = [];
  for (const g of ops.upsert_groups) {
    const old = beforeGroups.get(g.id);
    if (old) upsert_groups.push(old);
    else delete_group_ids.push(g.id);
  }
  for (const id of ops.delete_group_ids) {
    const old = beforeGroups.get(id);
    if (old) upsert_groups.push(old);
  }
  const upsert_members: StoredGroupMember[] = [];
  const delete_member_ids: string[] = [];
  for (const m of ops.upsert_members) {
    const old = beforeMembers.get(m.id);
    if (old) upsert_members.push(old);
    else delete_member_ids.push(m.id);
  }
  for (const id of ops.delete_member_ids) {
    const old = beforeMembers.get(id);
    if (old) upsert_members.push(old);
  }
  // Members that went away with a dissolved group come back with it.
  const gone = new Set(ops.delete_group_ids);
  for (const m of before.members) {
    if (gone.has(m.group_id) && !upsert_members.some((x) => x.id === m.id)) {
      upsert_members.push(m);
    }
  }
  return { upsert_groups, delete_group_ids, upsert_members, delete_member_ids };
}

function finish(before: GroupsState, ops: GroupOps, label: string): OpResult {
  return {
    state: applyOps(before, ops),
    ops,
    undo: inverseOf(before, ops),
    label,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new GroupOpError("Escribe un nombre para el grupo.");
  if (n.length > 80) throw new GroupOpError("El nombre es demasiado largo.");
  return n;
}

function assertNameFree(
  state: GroupsState,
  h: Hierarchy,
  restaurantId: string | null,
  parentId: string | null,
  name: string,
  exceptId?: string
): void {
  const clash = state.groups.find(
    (g) =>
      g.id !== exceptId &&
      sameHierarchy(g, h) &&
      (g.restaurant_id ?? null) === restaurantId &&
      (g.parent_id ?? null) === parentId &&
      norm(g.name) === norm(name)
  );
  if (clash) {
    throw new GroupOpError(`Ya hay un grupo llamado «${clash.name}» ahí.`);
  }
}

function descendantsOf(state: GroupsState, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string) => {
    for (const g of state.groups) {
      if (g.parent_id === parent && !out.has(g.id)) {
        out.add(g.id);
        walk(g.id);
      }
    }
  };
  walk(id);
  return out;
}

function groupById(state: GroupsState, id: string): StoredItemGroup {
  const g = state.groups.find((x) => x.id === id);
  if (!g) throw new GroupOpError("Ese grupo ya no existe.");
  return g;
}

/** The auto group of a menu dish, if stored. */
export function autoGroupOfDish(
  state: GroupsState,
  menuDishId: string
): StoredItemGroup | undefined {
  return state.groups.find(
    (g) =>
      g.source === "auto" &&
      g.scope === "product" &&
      g.menu_dish_id === menuDishId
  );
}

// ---------------------------------------------------------------------------
// Members into a group (shared by create and add)
// ---------------------------------------------------------------------------

function placeMembers(
  state: GroupsState,
  target: StoredItemGroup,
  items: readonly ItemRef[],
  uuid: Uuid
): GroupOps {
  const h: Hierarchy = {
    scope: target.scope,
    dimension: target.dimension,
    menu_dish_id: target.menu_dish_id,
  };
  const wanted = new Set(items.map(itemKey));
  const byId = new Map(state.groups.map((g) => [g.id, g]));
  const delete_member_ids: string[] = [];
  const upsert_members: StoredGroupMember[] = [];
  const kept = new Set<string>();
  for (const m of state.members) {
    if (!wanted.has(memberKey(m))) continue;
    const g = byId.get(m.group_id);
    if (!g || !sameHierarchy(g, h)) continue;
    // Same restaurant scope only: a shared membership and a restaurant one
    // are different slots.
    if ((g.restaurant_id ?? null) !== (target.restaurant_id ?? null)) continue;
    if (g.id === target.id) {
      kept.add(memberKey(m));
      continue; // already there
    }
    delete_member_ids.push(m.id);
  }
  for (const item of items) {
    if (kept.has(memberKey({ member_type: item.type, member_ref: item.ref }))) {
      continue;
    }
    upsert_members.push({
      id: uuid(),
      group_id: target.id,
      member_type: item.type,
      member_ref: item.ref,
      restaurant_id: target.restaurant_id,
    });
  }
  return { ...EMPTY_OPS, delete_member_ids, upsert_members };
}

function mergeOps(a: GroupOps, b: GroupOps): GroupOps {
  return {
    delete_member_ids: [...a.delete_member_ids, ...b.delete_member_ids],
    delete_group_ids: [...a.delete_group_ids, ...b.delete_group_ids],
    upsert_groups: [...a.upsert_groups, ...b.upsert_groups],
    upsert_members: [...a.upsert_members, ...b.upsert_members],
  };
}

/** Put menu dishes (their auto groups) under `parentId`, creating the auto group if it is not stored. */
function nestDishes(
  state: GroupsState,
  dishes: readonly DishRef[],
  parentId: string | null,
  uuid: Uuid
): GroupOps {
  const upsert_groups: StoredItemGroup[] = [];
  for (const d of dishes) {
    if (d.menu_dish_id.startsWith("auto:")) {
      throw new GroupOpError(
        "Primero guarda la agrupación de Milton para poder agrupar ese plato."
      );
    }
    const existing = autoGroupOfDish(state, d.menu_dish_id);
    if (existing) {
      if ((existing.parent_id ?? null) !== parentId) {
        upsert_groups.push({ ...existing, parent_id: parentId });
      }
    } else {
      upsert_groups.push({
        id: uuid(),
        restaurant_id: d.restaurant_id,
        parent_id: parentId,
        name: d.name,
        scope: "product",
        dimension: null,
        menu_dish_id: d.menu_dish_id,
        source: "auto",
        status: "confirmed",
        sort_order: 0,
      });
    }
  }
  return { ...EMPTY_OPS, upsert_groups };
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

export function createGroup(
  state: GroupsState,
  input: {
    name: string;
    hierarchy: Hierarchy;
    parentId?: string | null;
    restaurantId?: string | null;
    items?: readonly ItemRef[];
    dishes?: readonly DishRef[];
    source?: "user" | "ai_suggested";
    status?: "suggested" | "confirmed";
    uuid: Uuid;
  }
): OpResult {
  const name = cleanName(input.name);
  const parentId = input.parentId ?? null;
  const restaurantId = input.restaurantId ?? null;
  if (parentId) {
    const parent = groupById(state, parentId);
    if (!sameHierarchy(parent, input.hierarchy)) {
      throw new GroupOpError("Un grupo va dentro de un grupo del mismo tipo.");
    }
  }
  assertNameFree(state, input.hierarchy, restaurantId, parentId, name);
  const group: StoredItemGroup = {
    id: input.uuid(),
    restaurant_id: restaurantId,
    parent_id: parentId,
    name,
    scope: input.hierarchy.scope,
    dimension: input.hierarchy.dimension ?? null,
    menu_dish_id: input.hierarchy.menu_dish_id ?? null,
    source: input.source ?? "user",
    status: input.status ?? "confirmed",
    sort_order: 0,
  };
  const withGroup = applyOps(state, { ...EMPTY_OPS, upsert_groups: [group] });
  let ops: GroupOps = { ...EMPTY_OPS, upsert_groups: [group] };
  if (input.items?.length) {
    ops = mergeOps(
      ops,
      placeMembers(withGroup, group, input.items, input.uuid)
    );
  }
  if (input.dishes?.length) {
    ops = mergeOps(
      ops,
      nestDishes(withGroup, input.dishes, group.id, input.uuid)
    );
  }
  const count = (input.items?.length ?? 0) + (input.dishes?.length ?? 0);
  return finish(
    state,
    ops,
    count > 0 ? `Grupo «${name}» creado con ${count}` : `Grupo «${name}» creado`
  );
}

export function addToGroup(
  state: GroupsState,
  input: {
    groupId: string;
    items?: readonly ItemRef[];
    dishes?: readonly DishRef[];
    uuid: Uuid;
  }
): OpResult {
  const group = groupById(state, input.groupId);
  let ops: GroupOps = { ...EMPTY_OPS };
  if (input.items?.length) {
    ops = mergeOps(ops, placeMembers(state, group, input.items, input.uuid));
  }
  if (input.dishes?.length) {
    for (const d of input.dishes) {
      const auto = autoGroupOfDish(state, d.menu_dish_id);
      if (
        auto &&
        (auto.id === group.id || descendantsOf(state, auto.id).has(group.id))
      ) {
        throw new GroupOpError("Un grupo no puede ir dentro de sí mismo.");
      }
    }
    ops = mergeOps(ops, nestDishes(state, input.dishes, group.id, input.uuid));
  }
  const count = (input.items?.length ?? 0) + (input.dishes?.length ?? 0);
  return finish(
    state,
    ops,
    `${count} añadido${count === 1 ? "" : "s"} a «${group.name}»`
  );
}

/** Take items out of their explicit groups (they become sin agrupar), and dishes out of a user group. */
export function removeFromGroups(
  state: GroupsState,
  input: { items?: readonly ItemRef[]; dishes?: readonly DishRef[] }
): OpResult {
  const wanted = new Set((input.items ?? []).map(itemKey));
  const delete_member_ids = state.members
    .filter((m) => wanted.has(memberKey(m)))
    .map((m) => m.id);
  const upsert_groups: StoredItemGroup[] = [];
  for (const d of input.dishes ?? []) {
    const auto = autoGroupOfDish(state, d.menu_dish_id);
    if (auto && auto.parent_id)
      upsert_groups.push({ ...auto, parent_id: null });
  }
  const count = (input.items?.length ?? 0) + (input.dishes?.length ?? 0);
  return finish(
    state,
    { ...EMPTY_OPS, delete_member_ids, upsert_groups },
    `${count} sin agrupar`
  );
}

/**
 * Milton's AI suggestions, stored (source ai_suggested, status suggested) so
 * they survive a reload without asking the AI again. They never count as
 * grouped: the tree and every count ignore a group that is not confirmed.
 * One action, so one «Deshacer». Names that clash are skipped.
 */
export function createSuggestedGroups(
  state: GroupsState,
  input: {
    hierarchy: Hierarchy;
    clusters: ReadonlyArray<{
      name: string;
      refs: readonly string[];
      /** One restaurant's own suggestion (never mixes restaurants); null = shared. */
      restaurantId?: string | null;
    }>;
    itemType: GroupMemberType;
    uuid: Uuid;
  }
): OpResult {
  let working = state;
  let ops: GroupOps = { ...EMPTY_OPS };
  let made = 0;
  for (const c of input.clusters) {
    let result: OpResult;
    try {
      result = createGroup(working, {
        name: c.name,
        hierarchy: input.hierarchy,
        restaurantId: c.restaurantId ?? null,
        items: c.refs.map((ref) => ({ type: input.itemType, ref })),
        source: "ai_suggested",
        status: "suggested",
        uuid: input.uuid,
      });
    } catch (err) {
      if (err instanceof GroupOpError) continue;
      throw err;
    }
    working = result.state;
    ops = mergeOps(ops, result.ops);
    made++;
  }
  return finish(
    state,
    ops,
    `${made} ${made === 1 ? "sugerencia" : "sugerencias"} de Milton`
  );
}

/** Accept a suggestion: the group becomes real (still marked as Milton's). */
export function confirmSuggestion(
  state: GroupsState,
  groupId: string,
  /** The person may rename the suggestion before accepting it. */
  newName?: string
): OpResult {
  const found = groupById(state, groupId);
  const group =
    newName !== undefined && newName.trim() !== found.name
      ? { ...found, name: cleanName(newName) }
      : found;
  if (group.status === "confirmed") {
    return finish(
      state,
      { ...EMPTY_OPS },
      `«${group.name}» ya estaba agrupado`
    );
  }
  assertNameFree(
    state,
    {
      scope: group.scope,
      dimension: group.dimension,
      menu_dish_id: group.menu_dish_id,
    },
    group.restaurant_id ?? null,
    group.parent_id ?? null,
    group.name,
    group.id
  );
  return finish(
    state,
    {
      ...EMPTY_OPS,
      upsert_groups: [{ ...group, status: "confirmed" }],
    },
    `Grupo «${group.name}» agrupado por Milton`
  );
}

export function renameGroup(
  state: GroupsState,
  groupId: string,
  name: string
): OpResult {
  const group = groupById(state, groupId);
  const next = cleanName(name);
  if (next === group.name)
    return finish(state, { ...EMPTY_OPS }, "Sin cambios");
  assertNameFree(
    state,
    {
      scope: group.scope,
      dimension: group.dimension,
      menu_dish_id: group.menu_dish_id,
    },
    group.restaurant_id,
    group.parent_id,
    next,
    group.id
  );
  return finish(
    state,
    { ...EMPTY_OPS, upsert_groups: [{ ...group, name: next }] },
    `«${group.name}» ahora es «${next}»`
  );
}

export function moveGroup(
  state: GroupsState,
  groupId: string,
  parentId: string | null
): OpResult {
  const group = groupById(state, groupId);
  if (parentId) {
    const parent = groupById(state, parentId);
    if (
      parent.id === group.id ||
      descendantsOf(state, group.id).has(parent.id)
    ) {
      throw new GroupOpError("Un grupo no puede ir dentro de sí mismo.");
    }
    if (
      !sameHierarchy(parent, {
        scope: group.scope,
        dimension: group.dimension,
        menu_dish_id: group.menu_dish_id,
      }) &&
      !(parent.scope === group.scope && group.scope === "product")
    ) {
      throw new GroupOpError("Un grupo va dentro de un grupo del mismo tipo.");
    }
  }
  assertNameFree(
    state,
    {
      scope: group.scope,
      dimension: group.dimension,
      menu_dish_id: group.menu_dish_id,
    },
    group.restaurant_id,
    parentId,
    group.name,
    group.id
  );
  return finish(
    state,
    { ...EMPTY_OPS, upsert_groups: [{ ...group, parent_id: parentId }] },
    parentId ? `«${group.name}» movido` : `«${group.name}» al nivel superior`
  );
}

/** Dissolve a group: its members go back to sin agrupar, its sub-groups move up one level. */
export function ungroupGroup(state: GroupsState, groupId: string): OpResult {
  const group = groupById(state, groupId);
  if (group.source === "auto") {
    throw new GroupOpError(
      "Los platos del menú no se deshacen: usa «Mover» o «Excluir plato»."
    );
  }
  const upsert_groups = state.groups
    .filter((g) => g.parent_id === group.id)
    .map((g) => ({ ...g, parent_id: group.parent_id }));
  return finish(
    state,
    {
      ...EMPTY_OPS,
      upsert_groups,
      delete_group_ids: [group.id],
      delete_member_ids: state.members
        .filter((m) => m.group_id === group.id)
        .map((m) => m.id),
    },
    `Grupo «${group.name}» deshecho`
  );
}

/** Combinar: the first group keeps everything of the others; the others disappear. */
export function mergeGroups(
  state: GroupsState,
  groupIds: readonly string[],
  name?: string
): OpResult {
  const groups = groupIds.map((id) => groupById(state, id));
  if (groups.length < 2) throw new GroupOpError("Elige al menos dos grupos.");
  const keep = groups[0];
  const h: Hierarchy = {
    scope: keep.scope,
    dimension: keep.dimension,
    menu_dish_id: keep.menu_dish_id,
  };
  for (const g of groups) {
    if (g.source === "auto") {
      throw new GroupOpError("Un plato del menú no se combina con otro grupo.");
    }
    if (
      !sameHierarchy(g, h) ||
      (g.restaurant_id ?? null) !== (keep.restaurant_id ?? null)
    ) {
      throw new GroupOpError(
        "Solo se combinan grupos del mismo tipo y restaurante."
      );
    }
  }
  const losers = groups.slice(1);
  const loserIds = new Set(losers.map((g) => g.id));
  for (const l of losers) {
    if (
      descendantsOf(state, l.id).has(keep.id) ||
      descendantsOf(state, keep.id).has(l.id)
    ) {
      throw new GroupOpError(
        "No se pueden combinar un grupo y otro que está dentro de él."
      );
    }
  }
  const finalName = name ? cleanName(name) : keep.name;
  assertNameFree(
    state,
    h,
    keep.restaurant_id,
    keep.parent_id,
    finalName,
    keep.id
  );
  // Members move (same hierarchy, so the one-group rule holds). A member in
  // two merged groups cannot exist (one per hierarchy), nothing to dedupe.
  const upsert_members = state.members
    .filter((m) => loserIds.has(m.group_id))
    .map((m) => ({ ...m, group_id: keep.id }));
  // Sub-groups of the others move into the kept one.
  const moved = state.groups
    .filter(
      (g) => g.parent_id && loserIds.has(g.parent_id) && !loserIds.has(g.id)
    )
    .map((g) => ({ ...g, parent_id: keep.id }));
  // Sibling names inside the kept group must stay unique.
  const names = new Set(
    state.groups.filter((g) => g.parent_id === keep.id).map((g) => norm(g.name))
  );
  for (const g of moved) {
    if (names.has(norm(g.name))) {
      throw new GroupOpError(
        `Los dos grupos tienen un subgrupo «${g.name}». Renombra uno antes.`
      );
    }
    names.add(norm(g.name));
  }
  const upsert_groups = [
    ...(finalName !== keep.name ? [{ ...keep, name: finalName }] : []),
    ...moved,
  ];
  return finish(
    state,
    {
      ...EMPTY_OPS,
      upsert_groups,
      upsert_members,
      delete_group_ids: losers.map((g) => g.id),
      // The losers' member rows are replaced by the moved copies.
      delete_member_ids: [],
    },
    `${groups.length} grupos combinados en «${finalName}»`
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A server copy of the groups with this session's own changes put back on
 * top. The copy can be older than a save (a cached tab, a read that started
 * before it): replaying the changes keeps a rename or a new group from
 * flickering back, and is harmless when the copy is already newer (every op
 * is an upsert or a delete by id).
 */
export function replayOps(
  base: GroupsState,
  log: ReadonlyArray<GroupOps>
): GroupsState {
  return log.reduce((state, ops) => applyOps(state, ops), base);
}

/** "Bebidas › Refrescos" for a group. */
export function groupPath(state: GroupsState, groupId: string): string {
  const byId = new Map(state.groups.map((g) => [g.id, g]));
  const names: string[] = [];
  let cursor = byId.get(groupId);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return names.join(" › ");
}

/** The explicit group of an item in a hierarchy (restaurant's own before shared). */
export function groupOfItem(
  state: GroupsState,
  item: ItemRef,
  h: Hierarchy,
  restaurantId: string | null = null
): StoredItemGroup | null {
  const byId = new Map(state.groups.map((g) => [g.id, g]));
  const picks = state.members
    .filter((m) => m.member_type === item.type && m.member_ref === item.ref)
    .map((m) => byId.get(m.group_id))
    .filter(
      (g): g is StoredItemGroup =>
        !!g &&
        g.status === "confirmed" &&
        sameHierarchy(g, h) &&
        (!g.restaurant_id || g.restaurant_id === restaurantId)
    )
    .sort(
      (a, b) =>
        Number(!!b.restaurant_id) - Number(!!a.restaurant_id) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  return picks[0] ?? null;
}
