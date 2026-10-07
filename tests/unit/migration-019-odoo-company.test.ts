import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content-based regression check for migration 019 (Odoo multi-company
// scope). Like migration 013's test, the SQL is not executed here.

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/019_odoo_company_scope.sql"),
  "utf8"
);
// Statements only — comments may legitimately use words like "default".
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 019 — odoo_company_ids", () => {
  it("adds the nullable integer[] column idempotently", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS odoo_company_ids integer[] NULL"
    );
  });

  it("is purely additive: no UPDATE/DELETE/DROP/policy changes, no NOT NULL or DEFAULT", () => {
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/CREATE POLICY/i);
    expect(statements).not.toMatch(/ALTER POLICY/i);
    expect(statements).not.toMatch(/NOT NULL/i);
    expect(statements).not.toMatch(/\bDEFAULT\b/i);
  });

  it("forbids an empty array via a CHECK constraint", () => {
    expect(statements).toContain(
      "CHECK (odoo_company_ids IS NULL OR cardinality(odoo_company_ids) >= 1)"
    );
  });

  it("contains the manual-apply note and the apply-before-deploy note", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toMatch(/applied BEFORE the code/);
  });
});
