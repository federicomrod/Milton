import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/035_workbook_cost_match.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 035 — workbook cost match", () => {
  it("adds workbook comparison columns without dropping tables", () => {
    expect(sql).toContain("workbook_cost_total");
    expect(sql).toContain("workbook_cost_match");
    expect(sql).toContain("workbook_selling_price");
    expect(sql).toContain("workbook_unit_price");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 034");
  });
});
