// Migration 041: who approved which recipe version, and when.

import { readFileSync } from "fs";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  approvalRecord,
  updateWithApprovalAudit,
} from "@/lib/restaurant/recipe-costing/approval-audit";

vi.mock("@/lib/restaurant/recipe-costing/link-actions-server", () => ({
  loadPosProductLink: async () => ({
    evidence: {
      tab: "Platos",
      block_name: "Plato de prueba",
      milton_cost: 1.2,
      yield: { value: 1, unit: "porción", source: "excel" },
      lines: [
        {
          raw_name: "Harina",
          ingredient_match: "Harina",
          qty: 2,
          unit: "oz",
          unit_cost: 0.6,
          pending: false,
          flags: ["ok"],
          reasons: [],
        },
      ],
    },
  }),
}));

import { approveRecipeVersion } from "@/lib/restaurant/recipe-costing/approval-server";

/** recipe_versions + recipe_version_inputs, capturing the approval update. */
function fakeDb(opts: { before041?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];
  const version = {
    id: "v1",
    recipe_id: "r1",
    menu_item_id: "m1",
    version_number: 1,
    status: "in_review",
    effective_date: null,
    source_type: "import",
    notes: null,
  };
  const client = {
    from(table: string) {
      let payload: Record<string, unknown> | null = null;
      const b = {
        select: (_cols?: string, o?: { head?: boolean }) => {
          if (o?.head) {
            return {
              eq: () => ({
                eq: async () => ({ count: 1, error: null }),
              }),
            };
          }
          return b;
        },
        eq: () => b,
        update: (p: Record<string, unknown>) => {
          payload = p;
          return b;
        },
        maybeSingle: async () => ({ data: version, error: null }),
        then(resolve: (v: unknown) => void) {
          if (payload) {
            if (opts.before041 && "approved_by" in payload) {
              return resolve({
                error: {
                  message:
                    'column "approved_by" of relation "recipe_versions" does not exist',
                },
              });
            }
            updates.push(payload);
            return resolve({ error: null });
          }
          return resolve({
            data: table === "recipe_versions" ? [version] : [],
            error: null,
          });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

describe("approval audit (migration 041)", () => {
  it("an owner's approval records approved_by, approved_at and how", async () => {
    const db = fakeDb();
    const r = await approveRecipeVersion({
      supabase: db.client,
      companyId: "co",
      actor: { user_id: "owner-1", role: "owner", is_milton_staff: false },
      recipeVersionId: "v1",
      odooProductId: 7,
    });
    expect(r).toEqual({ ok: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      status: "approved",
      notes: "Aprobada",
      approved_by: "owner-1",
      approved_how: "en_pantalla",
    });
    expect(String(db.updates[0]!.approved_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("Milton staff keep the client-confirmation note and the record says how", async () => {
    const db = fakeDb();
    const r = await approveRecipeVersion({
      supabase: db.client,
      companyId: "co",
      actor: { user_id: "staff-1", role: null, is_milton_staff: true },
      recipeVersionId: "v1",
      odooProductId: 7,
      confirmedHow: "whatsapp",
    });
    expect(r).toEqual({ ok: true });
    expect(db.updates[0]).toMatchObject({
      approved_by: "staff-1",
      approved_how: "whatsapp",
    });
    expect(String(db.updates[0]!.notes)).toMatch(
      /El cliente confirmó por whatsapp/
    );
  });

  it("before 041 is applied the approval still goes through, without the columns", async () => {
    const db = fakeDb({ before041: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await approveRecipeVersion({
      supabase: db.client,
      companyId: "co",
      actor: { user_id: "owner-1", role: "owner", is_milton_staff: false },
      recipeVersionId: "v1",
      odooProductId: 7,
    });
    expect(r).toEqual({ ok: true });
    expect(db.updates).toEqual([
      expect.objectContaining({ status: "approved", notes: "Aprobada" }),
    ]);
    expect(db.updates[0]).not.toHaveProperty("approved_by");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("any other write error is not hidden", async () => {
    await expect(
      updateWithApprovalAudit(
        async () => ({ error: { message: "permission denied" } }),
        { status: "approved" },
        approvalRecord({ userId: "u" })
      )
    ).rejects.toThrow("permission denied");
  });
});

describe("migration 041", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/041_recipe_version_approval_audit.sql"
    ),
    "utf8"
  );
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("only adds nullable approval columns to the two version tables", () => {
    for (const table of ["recipe_versions", "component_recipe_versions"]) {
      for (const col of [
        "approved_by uuid NULL",
        "approved_at timestamptz NULL",
        "approved_how text NULL",
      ]) {
        expect(statements).toContain(col);
      }
      expect(statements).toContain(`ALTER TABLE public.${table}`);
    }
    expect(statements).not.toMatch(
      /\bDROP\b|\bUPDATE\b|\bDELETE\b|ALTER COLUMN|CONSTRAINT/i
    );
  });
});
