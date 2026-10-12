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
    expect(sql).toContain("date_source = 'upload'");
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 035");
  });
});
