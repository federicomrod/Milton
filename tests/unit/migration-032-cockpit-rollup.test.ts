import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/032_cockpit_pos_rollup_rls.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 032 — date-safe rollup + RLS-friendly POS policy", () => {
  it("fixes sale_date date/text and checks membership once", () => {
    expect(sql).toContain("to_char(psi.sale_date, 'YYYY-MM-DD')");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("is_company_member(p_company_id)");
    expect(sql).toContain("CASE types date and text");
    expect(sql).toContain("after 031");
    expect(sql).toContain("manually into the Supabase SQL Editor");
  });

  it("rewrites pos_sales_items RLS without deleting rows", () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Members can access POS sales items"'
    );
    expect(sql).toContain("WHERE cm.user_id = (SELECT auth.uid())");
    expect(sql).toContain('CREATE POLICY "Members can access POS sales items"');
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });
});
