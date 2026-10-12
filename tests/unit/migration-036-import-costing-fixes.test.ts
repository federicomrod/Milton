import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/036_import_costing_fixes.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 036 — import costing fixes", () => {
  it("adds variance, price dates, and version tables without dropping tables", () => {
    expect(sql).toContain("workbook_variance_amount");
    expect(sql).toContain("workbook_variance_pct");
    expect(sql).toContain("effective_date");
    expect(sql).toContain("date_source");
    expect(sql).toContain("dated_price_list");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.recipe_versions");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.component_recipe_versions"
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
  });

  it("maps date_source from ingredient_cost_entries.source_type", () => {
    expect(sql).toContain("CASE source_type");
    expect(sql).toContain("WHEN 'invoice_line' THEN 'invoice'");
    expect(sql).toContain("WHEN 'manual' THEN 'manual'");
    expect(sql).toContain("ELSE 'upload'");
    expect(sql).not.toMatch(
      /SET date_source = 'upload'\s+WHERE date_source IS NULL/
    );
  });

  it("approves only active recipes, reviews drafts, and skips archived", () => {
    expect(sql).toContain("WHEN r.status = 'active' THEN 'approved'");
    expect(sql).toContain("WHEN c.status = 'active' THEN 'approved'");
    expect(sql).toContain("ELSE 'in_review'");
    expect(sql).toContain("r.status IN ('active', 'draft')");
    expect(sql).toContain("c.status IN ('active', 'draft')");
    expect(sql).toContain("Archived recipes are skipped");
    expect(sql).not.toMatch(/r\.status = 'archived'/);
    expect(sql).not.toMatch(/c\.status = 'archived'/);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 035");
  });
});
