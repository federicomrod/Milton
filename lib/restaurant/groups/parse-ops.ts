// lib/restaurant/groups/parse-ops.ts
//
// The ops of one grouping action, checked for shape and size before they go
// to the database (item_groups_apply). The database re-validates everything;
// this only refuses garbage early with a readable message.

import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { GroupOps } from "./group-ops";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = new Set([
  "product",
  "dimension_value",
  "preparation",
  "ingredient",
]);
const DIMENSIONS = new Set(["side", "size", "cooking_point", "channel"]);
const SOURCES = new Set(["auto", "ai_suggested", "user"]);
const STATUSES = new Set(["suggested", "confirmed"]);
const MEMBER_TYPES = new Set([
  "pos_product",
  "group",
  "dimension_value",
  "preparation",
  "ingredient",
]);
export const MAX_OPS = 2000;

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function parseGroupOps(
  raw: unknown,
  lang: PreferredLanguage = "es"
): { ok: true; ops: GroupOps } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  const p = getDictionary(lang).menu.groups.parse;
  if (!isObj(raw)) return bad(p.missingChanges);
  const list = (key: string): unknown[] | null => {
    const v = raw[key];
    if (v === undefined) return [];
    return Array.isArray(v) ? v : null;
  };
  const dm = list("delete_member_ids");
  const dg = list("delete_group_ids");
  const ug = list("upsert_groups");
  const um = list("upsert_members");
  if (!dm || !dg || !ug || !um) return bad(p.badFormat);
  if (dm.length + dg.length + ug.length + um.length > MAX_OPS) {
    return bad(p.tooMany);
  }
  if (![...dm, ...dg].every(isUuid)) return bad(p.badId);

  const upsert_groups = [];
  for (const g of ug) {
    if (!isObj(g) || !isUuid(g.id)) return bad(p.groupNoId);
    if (typeof g.name !== "string" || !g.name.trim() || g.name.length > 80) {
      return bad(p.groupName);
    }
    if (typeof g.scope !== "string" || !SCOPES.has(g.scope))
      return bad(p.groupType);
    if (
      g.dimension != null &&
      !(typeof g.dimension === "string" && DIMENSIONS.has(g.dimension))
    ) {
      return bad(p.dimension);
    }
    if (!SOURCES.has(String(g.source ?? "user"))) return bad(p.origin);
    if (!STATUSES.has(String(g.status ?? "confirmed"))) return bad(p.status);
    for (const k of ["parent_id", "restaurant_id", "menu_dish_id"] as const) {
      if (g[k] != null && !isUuid(g[k])) return bad(p.reference);
    }
    upsert_groups.push({
      id: g.id,
      name: g.name.trim(),
      scope: g.scope,
      dimension: (g.dimension as string | null) ?? null,
      parent_id: (g.parent_id as string | null) ?? null,
      restaurant_id: (g.restaurant_id as string | null) ?? null,
      menu_dish_id: (g.menu_dish_id as string | null) ?? null,
      source: String(g.source ?? "user"),
      status: String(g.status ?? "confirmed"),
      sort_order: Number.isInteger(g.sort_order) ? (g.sort_order as number) : 0,
    });
  }
  const upsert_members = [];
  for (const m of um) {
    if (!isObj(m) || !isUuid(m.id) || !isUuid(m.group_id))
      return bad(p.memberInvalid);
    if (typeof m.member_type !== "string" || !MEMBER_TYPES.has(m.member_type)) {
      return bad(p.memberType);
    }
    if (
      typeof m.member_ref !== "string" ||
      !m.member_ref.trim() ||
      m.member_ref.length > 200
    ) {
      return bad(p.memberRef);
    }
    upsert_members.push({
      id: m.id,
      group_id: m.group_id,
      member_type: m.member_type,
      member_ref: m.member_ref,
      restaurant_id: null,
    });
  }
  return {
    ok: true,
    ops: {
      delete_member_ids: dm as string[],
      delete_group_ids: dg as string[],
      upsert_groups: upsert_groups as unknown as GroupOps["upsert_groups"],
      upsert_members: upsert_members as unknown as GroupOps["upsert_members"],
    },
  };
}
