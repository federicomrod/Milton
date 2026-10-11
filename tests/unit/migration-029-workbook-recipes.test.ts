import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/029_workbook_recipes.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 029 — workbook recipes", () => {
  it("adds import source columns and allows sub_recipe maps", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS source_type");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS source_id");
    expect(sql).toContain("sub_recipe");
    expect(sql).toContain("cost_import_layout_maps_tab_type_check");
  });

  it("does not drop tables", () => {
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 028");
  });
});
