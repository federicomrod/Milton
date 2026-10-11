import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/031_cockpit_pos_rollup.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 031 — cockpit POS rollup", () => {
  it("adds only indexes and invoker functions", () => {
    expect(sql).toContain("idx_pos_sales_items_company_location_date");
    expect(sql).toContain("idx_pos_sales_items_company_id");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.pos_line_is_tip");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.cockpit_pos_rollup");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("'propina'");
    expect(sql).toContain("'sugerida'");
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);
  });

  it("is safe to re-run and must be pasted on staging", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 030");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.cockpit_pos_rollup");
  });
});
