import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/030_pos_sales_items_is_tip.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 030 — pos_sales_items.is_tip", () => {
  it("adds a nullable is_tip column and a partial index", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS is_tip boolean NULL");
    expect(sql).toContain("idx_pos_sales_items_company_is_tip");
    expect(sql).toContain("WHERE is_tip IS TRUE");
  });

  it("backfills exact Propina / tip names without dropping rows", () => {
    expect(sql).toContain("SET is_tip = true");
    expect(sql).toContain("'propina'");
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("Re-sync: NOT required");
  });
});
