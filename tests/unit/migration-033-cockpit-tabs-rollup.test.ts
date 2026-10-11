import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/033_cockpit_tabs_product_rollup.sql"
  ),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 033 — tab product rollup + faster executive RPC", () => {
  it("adds a DEFINER product rollup and rematerializes the executive one", () => {
    expect(sql).toContain("cockpit_pos_product_rollup");
    expect(sql).toContain("AS MATERIALIZED");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("is_company_member(p_company_id)");
    expect(sql).toContain("after 032");
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.cockpit_pos_rollup"
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.cockpit_pos_product_rollup"
    );
    expect(sql).not.toMatch(/to_char\(psi\.sale_date, 'YYYY-MM-DD'\)\s*~/);
  });

  it("does not delete rows or drop tables", () => {
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(statements).not.toMatch(/\bDROP\s+POLICY\b/i);
  });

  it("grants the new RPC to authenticated only", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.cockpit_pos_product_rollup"
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.cockpit_pos_product_rollup"
    );
    expect(sql).toContain("FROM PUBLIC, anon");
  });
});
