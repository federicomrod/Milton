// R1-15b: reading groups degrades to "none" until 048 is applied, and the
// migration is additive, company-scoped and closed to anon. Synthetic data.

import { readFileSync } from "fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadItemGroups,
  resetItemGroupsMemoForTests,
  productTreeInputs,
  syncAutoGroups,
} from "@/lib/restaurant/groups/item-groups";

function fakeDb(
  tables: Record<string, Array<Record<string, unknown>> | "missing">
) {
  return {
    from(table: string) {
      const rows = tables[table];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        range: async () =>
          rows === "missing" || rows === undefined
            ? {
                data: null,
                error: {
                  message: `relation "${table}" does not exist`,
                  code: "42P01",
                },
              }
            : { data: rows, error: null },
      };
      return b;
    },
    rpc: async (fn: string) =>
      tables.__rpc_missing === "missing"
        ? { data: null, error: { message: `function ${fn} does not exist` } }
        : { data: 2, error: null },
  } as unknown as SupabaseClient;
}

describe("loadItemGroups", () => {
  beforeEach(() => resetItemGroupsMemoForTests());

  it("before 048 (table missing): no groups, available false, nothing throws", async () => {
    const r = await loadItemGroups(
      fakeDb({ item_groups: "missing", group_members: "missing" }),
      "co-a"
    );
    expect(r).toEqual({ available: false, groups: [], members: [] });
  });

  it("reads groups and members and ignores malformed rows", async () => {
    const r = await loadItemGroups(
      fakeDb({
        item_groups: [
          {
            id: "g1",
            name: "Bebidas",
            scope: "product",
            source: "user",
            status: "confirmed",
            restaurant_id: null,
            parent_id: null,
            dimension: null,
            menu_dish_id: null,
            sort_order: 0,
          },
          {
            id: "g2",
            name: "Refrescos",
            scope: "product",
            source: "ai_suggested",
            status: "suggested",
            parent_id: "g1",
          },
          { id: "bad", name: "X", scope: "nonsense" },
        ],
        group_members: [
          {
            id: "m1",
            group_id: "g1",
            member_type: "pos_product",
            member_ref: "7001",
          },
          { id: "m2", group_id: "g1", member_type: "robot", member_ref: "1" },
        ],
      }),
      "co-b"
    );
    expect(r.available).toBe(true);
    expect(
      r.groups.map((g) => [g.id, g.source, g.status, g.parent_id])
    ).toEqual([
      ["g1", "user", "confirmed", null],
      ["g2", "ai_suggested", "suggested", "g1"],
    ]);
    expect(r.members.map((m) => m.member_ref)).toEqual(["7001"]);
  });
});

describe("tree inputs", () => {
  it("only product groups and explicit product members go to the tree", () => {
    const { groups, members } = productTreeInputs({
      available: true,
      groups: [
        {
          id: "g1",
          restaurant_id: null,
          parent_id: null,
          name: "Bebidas",
          scope: "product",
          dimension: null,
          menu_dish_id: null,
          source: "user",
          status: "confirmed",
          sort_order: 0,
        },
        {
          id: "g2",
          restaurant_id: null,
          parent_id: null,
          name: "Papas",
          scope: "dimension_value",
          dimension: "side",
          menu_dish_id: null,
          source: "user",
          status: "confirmed",
          sort_order: 0,
        },
      ],
      members: [
        {
          id: "m1",
          group_id: "g1",
          member_type: "pos_product",
          member_ref: "7001",
          restaurant_id: null,
        },
        {
          id: "m2",
          group_id: "g2",
          member_type: "dimension_value",
          member_ref: "Puré",
          restaurant_id: null,
        },
        {
          id: "m3",
          group_id: "g1",
          member_type: "ingredient",
          member_ref: "i",
          restaurant_id: null,
        },
      ],
    });
    expect(groups.map((g) => g.id)).toEqual(["g1"]);
    expect(members).toEqual([{ group_id: "g1", member_ref: "7001" }]);
  });
});

describe("syncAutoGroups", () => {
  it("is quiet when the function is missing", async () => {
    expect(
      await syncAutoGroups(fakeDb({ __rpc_missing: "missing" }), "co")
    ).toBeNull();
    expect(await syncAutoGroups(fakeDb({}), "co")).toEqual({ created: 2 });
  });
});

describe("migration 048", () => {
  const sql = readFileSync("supabase/migrations/048_item_groups.sql", "utf8");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("is additive: no drop of a table or column, no rename, no delete, no alter of existing tables", () => {
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/DROP\s+COLUMN/i);
    expect(code).not.toMatch(/RENAME/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(
      /ALTER\s+TABLE\s+public\.(?!item_groups|group_members)/i
    );
    expect(code).not.toMatch(/\bUPDATE\s+public\./i);
  });

  it("both tables are company-scoped with RLS through is_company_member, closed to anon", () => {
    for (const t of ["item_groups", "group_members"]) {
      expect(code).toContain(
        `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`
      );
      expect(code).toContain(`REVOKE ALL ON TABLE public.${t} FROM anon`);
    }
    expect(
      code.match(/public\.is_company_member\(company_id\)/g)?.length
    ).toBeGreaterThanOrEqual(4);
  });

  it("the sync function checks membership (42501), is insert-only and closed to anon/PUBLIC", () => {
    const fn = code.slice(
      code.indexOf("item_groups_sync_menu_dishes(p_company_id uuid)")
    );
    expect(fn).toContain("42501");
    expect(fn).toContain("INSERT INTO public.item_groups");
    expect(fn).not.toMatch(/\bUPDATE\b|\bDELETE\b/);
    expect(code).toContain(
      "REVOKE ALL ON FUNCTION public.item_groups_sync_menu_dishes(uuid) FROM PUBLIC"
    );
    expect(code).toContain(
      "REVOKE ALL ON FUNCTION public.item_groups_sync_menu_dishes(uuid) FROM anon"
    );
  });

  it("a member belongs to one group per hierarchy (unique index) and the hierarchy comes from the group", () => {
    expect(code).toContain("group_members_one_group_uniq");
    expect(code).toContain("group_members_from_group");
  });
});
