import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/028_cost_workbook_import.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 028 — cost workbook import", () => {
  it("creates batches, layout maps, and review items", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.cost_import_batches"
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.cost_import_layout_maps"
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.cost_import_review_items"
    );
    expect(sql).toContain("undo_snapshot");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS undo_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb"
    );
  });

  it("does not alter ingredient_cost_entries or drop anything", () => {
    expect(statements).not.toMatch(
      /ALTER TABLE public\.ingredient_cost_entries/i
    );
    expect(statements).not.toMatch(/\bDROP\b/i);
  });

  it("scopes new tables with is_company_member RLS", () => {
    expect(sql).toContain("is_company_member(company_id)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
  });
});
