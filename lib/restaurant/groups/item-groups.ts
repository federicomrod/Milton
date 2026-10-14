// lib/restaurant/groups/item-groups.ts
//
// R1-15b: groups (migration 048) as the app reads them. Company-scoped,
// through the caller's RLS-bound client. Until 048 is applied the table does
// not exist: `available` is false, nothing is grouped by a person and every
// number is what it was.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import type {
  TreeGroup,
  TreeLeaf,
  TreeMember,
} from "@/lib/restaurant/costing/rollup";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";

export type GroupScope =
  | "product"
  | "dimension_value"
  | "preparation"
  | "ingredient";
export type GroupDimension = "side" | "size" | "cooking_point" | "channel";
export type GroupMemberType =
  | "pos_product"
  | "group"
  | "dimension_value"
  | "preparation"
  | "ingredient";

export interface StoredItemGroup {
  id: string;
  restaurant_id: string | null;
  parent_id: string | null;
  name: string;
  scope: GroupScope;
  dimension: GroupDimension | null;
  menu_dish_id: string | null;
  source: "auto" | "ai_suggested" | "user";
  status: "suggested" | "confirmed";
  sort_order: number;
}

export interface StoredGroupMember {
  id: string;
  group_id: string;
  member_type: GroupMemberType;
  member_ref: string;
  restaurant_id: string | null;
}

export interface ItemGroupsLoad {
  /** False until migration 048: no groups, nothing hidden. */
  available: boolean;
  groups: StoredItemGroup[];
  members: StoredGroupMember[];
}

export const NO_ITEM_GROUPS: ItemGroupsLoad = {
  available: false,
  groups: [],
  members: [],
};

const SCOPES = new Set([
  "product",
  "dimension_value",
  "preparation",
  "ingredient",
]);
const MEMBER_TYPES = new Set([
  "pos_product",
  "group",
  "dimension_value",
  "preparation",
  "ingredient",
]);

function asGroup(row: Record<string, unknown>): StoredItemGroup | null {
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  if (typeof row.scope !== "string" || !SCOPES.has(row.scope)) return null;
  return {
    id: row.id,
    restaurant_id:
      typeof row.restaurant_id === "string" ? row.restaurant_id : null,
    parent_id: typeof row.parent_id === "string" ? row.parent_id : null,
    name: row.name,
    scope: row.scope as GroupScope,
    dimension:
      typeof row.dimension === "string"
        ? (row.dimension as GroupDimension)
        : null,
    menu_dish_id:
      typeof row.menu_dish_id === "string" ? row.menu_dish_id : null,
    source:
      row.source === "auto" || row.source === "ai_suggested"
        ? row.source
        : "user",
    status: row.status === "suggested" ? "suggested" : "confirmed",
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
  };
}

function asMember(row: Record<string, unknown>): StoredGroupMember | null {
  if (
    typeof row.id !== "string" ||
    typeof row.group_id !== "string" ||
    typeof row.member_ref !== "string" ||
    typeof row.member_type !== "string" ||
    !MEMBER_TYPES.has(row.member_type)
  ) {
    return null;
  }
  return {
    id: row.id,
    group_id: row.group_id,
    member_type: row.member_type as GroupMemberType,
    member_ref: row.member_ref,
    restaurant_id:
      typeof row.restaurant_id === "string" ? row.restaurant_id : null,
  };
}

/** When the tables are missing, do not pay a failed read on every load. */
let unavailableUntil = 0;
const UNAVAILABLE_MS = 60_000;

export function resetItemGroupsMemoForTests(): void {
  unavailableUntil = 0;
}

export async function loadItemGroups(
  supabase: SupabaseClient,
  companyId: string
): Promise<ItemGroupsLoad> {
  if (Date.now() < unavailableUntil) return NO_ITEM_GROUPS;
  const [groupsRes, membersRes] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("item_groups")
        .select(
          "id, restaurant_id, parent_id, name, scope, dimension, menu_dish_id, source, status, sort_order"
        )
        .eq("company_id", companyId)
    ),
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("group_members")
        .select("id, group_id, member_type, member_ref, restaurant_id")
        .eq("company_id", companyId)
    ),
  ]);
  if (groupsRes.error || membersRes.error) {
    // Before 048 the tables do not exist. Any other failure also degrades to
    // "no groups" (the numbers never depend on them), and is retried soon.
    unavailableUntil = Date.now() + UNAVAILABLE_MS;
    return NO_ITEM_GROUPS;
  }
  return {
    available: true,
    groups: groupsRes.rows
      .map(asGroup)
      .filter((g): g is StoredItemGroup => g !== null),
    members: membersRes.rows
      .map(asMember)
      .filter((m): m is StoredGroupMember => m !== null),
  };
}

/**
 * Create the missing auto group of each menu dish (insert-only; a person's
 * rename, nesting or move is never touched). Best effort: nothing breaks if
 * 048 is not applied.
 */
export async function syncAutoGroups(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ created: number } | null> {
  const { data, error } = await supabase.rpc("item_groups_sync_menu_dishes", {
    p_company_id: companyId,
  });
  if (error) return null;
  return { created: typeof data === "number" ? data : 0 };
}

// ---------------------------------------------------------------------------
// Into the roll-up tree
// ---------------------------------------------------------------------------

/** Product-hierarchy groups and explicit product memberships. */
export function productTreeInputs(load: ItemGroupsLoad): {
  groups: TreeGroup[];
  members: TreeMember[];
} {
  const groups = load.groups
    .filter((g) => g.scope === "product")
    .map(
      (g): TreeGroup => ({
        id: g.id,
        name: g.name,
        parent_id: g.parent_id,
        restaurant_id: g.restaurant_id,
        source: g.source,
        status: g.status,
        menu_dish_id: g.menu_dish_id,
        sort_order: g.sort_order,
      })
    );
  const ids = new Set(groups.map((g) => g.id));
  return {
    groups,
    members: load.members
      .filter((m) => m.member_type === "pos_product" && ids.has(m.group_id))
      .map((m) => ({ group_id: m.group_id, member_ref: m.member_ref })),
  };
}

/**
 * The leaf rows of the view: one per variant (a restaurant part when
 * restaurants are costed differently). The tree aggregates these; nothing
 * else is summed anywhere.
 */
export function leavesFromMenuDishes(
  dishes: readonly MenuDish[],
  /** Variants of excluded dishes (drinks…) are leaves too: they just have no dish. */
  excluded: readonly MenuDish[] = []
): TreeLeaf[] {
  const out: TreeLeaf[] = [];
  const add = (dish: MenuDish, inDish: boolean) => {
    for (const v of dish.variants) {
      out.push({
        key: v.key,
        ref: String(v.odoo_product_id),
        name: v.name,
        units: v.units,
        net_sales: v.net_sales,
        cost_total: v.cost_total,
        covered: v.covered,
        status: v.status,
        restaurant_ids:
          v.sales_scope?.sale_location_ids ??
          (v.sale_location_ids?.length ? v.sale_location_ids : null),
        menu_dish_id: inDish ? dish.id : null,
        menu_dish_name: inDish ? dish.name : null,
      });
    }
  };
  for (const d of dishes) add(d, true);
  for (const d of excluded) add(d, false);
  return out;
}
