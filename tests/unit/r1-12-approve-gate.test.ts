// R1-12: approving reads its inputs while the POS link is being saved, but
// writes the approval only after the link step succeeded. Synthetic data.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { approveRecipeVersion } from "@/lib/restaurant/recipe-costing/approval-server";

const version = {
  id: "v1",
  recipe_id: "r1",
  menu_item_id: "m1",
  version_number: 1,
  status: "in_review",
  effective_date: null,
  source_type: "manual",
  notes: null,
};

const evidence = {
  yield: { value: 1, unit: "porción", source: "confirmed" },
  milton_cost: 4.5,
  lines: [
    {
      raw_name: "HARINA",
      ingredient_match: "Harina",
      qty: 2,
      unit: "oz",
      pending: false,
      flags: [],
      reasons: [],
      resolved: { kind: "ingredient", name: "Harina" },
      unit_cost: 0.1,
    },
  ],
};

function fakeDb() {
  const writes: unknown[] = [];
  const reads: string[] = [];
  const db = {
    from(table: string) {
      let isUpdate = false;
      let head = false;
      const b: Record<string, unknown> = {
        select: (_c?: string, opts?: { head?: boolean }) => {
          head = Boolean(opts?.head);
          return b;
        },
        update: (payload: unknown) => {
          isUpdate = true;
          writes.push({ table, payload });
          return b;
        },
        eq: () => b,
        then: (resolve: (v: unknown) => unknown) => {
          if (isUpdate) return resolve({ error: null });
          reads.push(table);
          if (head) return resolve({ count: 1, error: null });
          return resolve({
            data: [
              {
                id: "v1",
                status: "in_review",
                version_number: 1,
                effective_date: null,
              },
            ],
            error: null,
          });
        },
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, writes, reads };
}

const liveOk = async () => ({
  ok: true as const,
  version_id: "v1",
  lines: [
    {
      key: "l1",
      kind: "ingredient",
      raw_name: "HARINA",
      name: "Harina",
      unit: "oz",
      amount: 0.2,
      pending: false,
      flags: ["ok"],
    },
  ] as never,
});

const owner = { user_id: "u1", role: "owner", is_milton_staff: false };

describe("approveRecipeVersion with a gate", () => {
  it("writes the approval once the gate is ok, without re-reading the version or link", async () => {
    const { db, writes, reads } = fakeDb();
    const result = await approveRecipeVersion({
      supabase: db,
      companyId: "co",
      actor: owner,
      recipeVersionId: "v1",
      odooProductId: 7,
      yieldConfirmed: true,
      version: version as never,
      link: { evidence } as never,
      loadLiveLines: liveOk,
      gate: Promise.resolve({ ok: true }),
    });
    expect(result).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    // Only the line count and the sibling versions were read.
    expect(reads.sort()).toEqual(["recipe_version_inputs", "recipe_versions"]);
  });

  it("writes nothing when the link step failed", async () => {
    const { db, writes } = fakeDb();
    const result = await approveRecipeVersion({
      supabase: db,
      companyId: "co",
      actor: owner,
      recipeVersionId: "v1",
      odooProductId: 7,
      yieldConfirmed: true,
      version: version as never,
      link: { evidence } as never,
      loadLiveLines: liveOk,
      gate: Promise.resolve({
        ok: false,
        error: "No pude guardar el vínculo.",
      }),
    });
    expect(result).toEqual({ ok: false, error: "No pude guardar el vínculo." });
    expect(writes).toHaveLength(0);
  });

  it("still refuses a recipe that is already approved", async () => {
    const { db, writes } = fakeDb();
    const result = await approveRecipeVersion({
      supabase: db,
      companyId: "co",
      actor: owner,
      recipeVersionId: "v1",
      version: { ...version, status: "approved" } as never,
      gate: Promise.resolve({ ok: true }),
    });
    expect(result).toMatchObject({ ok: false });
    expect(writes).toHaveLength(0);
  });
});
