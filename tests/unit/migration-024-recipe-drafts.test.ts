import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/024_kitchen_recipe_drafts.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 024", () => {
  it("creates the two tables", () => {
    for (const t of ["kitchen_recipe_drafts", "kitchen_recipe_draft_lines"]) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
    }
  });

  it("enforces telegram idempotency and status checks", () => {
    expect(code).toContain("UNIQUE (telegram_chat_id, telegram_message_id)");
    expect(code).toContain(
      "CHECK (status IN ('awaiting_portions', 'draft', 'confirmed', 'rejected'))"
    );
    expect(code).toContain("CHECK (confidence IN ('high', 'medium', 'low'))");
  });

  it("stores draft-specific fields", () => {
    expect(code).toMatch(/\bdish_name\s+text NOT NULL/);
    expect(code).toMatch(/\bportions\s+int NULL/);
    expect(code).toMatch(/\bper_portion_cost\s+numeric/);
    expect(code).toMatch(/\bconfirmed_by\s+uuid NULL/);
    expect(code).toMatch(/\bconfirmed_at\s+timestamptz NULL/);
    expect(code).toMatch(/\bconfirmed_recipe_id\s+uuid NULL/);
  });

  it("stores line details with matched ingredient and costing", () => {
    expect(code).toMatch(/\braw_name\s+text NOT NULL/);
    expect(code).toMatch(/\bingredient_id\s+uuid NULL/);
    expect(code).toMatch(/\btotal_quantity\s+numeric/);
    expect(code).toMatch(/\bper_portion_quantity\s+numeric/);
    expect(code).toMatch(/\bunit_cost_snapshot\s+numeric/);
    expect(code).toMatch(/\bline_cost\s+numeric/);
  });

  it("enables RLS on both tables", () => {
    for (const t of ["kitchen_recipe_drafts", "kitchen_recipe_draft_lines"]) {
      expect(code).toContain(
        `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`
      );
    }
  });

  it("has SELECT-only member policies (writes via service role or SECURITY DEFINER function)", () => {
    const policies = [
      ...code.matchAll(
        /CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+) USING \(([^)]*\)?)\)/g
      ),
    ];
    expect(policies.map((p) => p[2]).sort()).toEqual([
      "kitchen_recipe_draft_lines",
      "kitchen_recipe_drafts",
    ]);
    for (const p of policies) {
      expect(p[3]).toBe("SELECT");
      expect(p[4]).toContain("public.is_company_member(company_id)");
    }
  });

  it("is additive: no DROP", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
  });

  it("contains the manual-apply note", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("apply manually to Milton Staging first");
  });

  it("has a SECURITY DEFINER confirm function", () => {
    expect(code).toContain(
      "CREATE OR REPLACE FUNCTION public.confirm_kitchen_recipe_draft"
    );
    expect(code).toContain("SECURITY DEFINER");
    expect(code).toContain("SET search_path = public");
  });

  it("has updated_at triggers", () => {
    expect(code).toContain(
      "CREATE OR REPLACE FUNCTION public.set_updated_at()"
    );
    expect(code).toContain(
      "CREATE TRIGGER set_updated_at_kitchen_recipe_drafts"
    );
    expect(code).toContain(
      "CREATE TRIGGER set_updated_at_kitchen_recipe_draft_lines"
    );
  });
});
