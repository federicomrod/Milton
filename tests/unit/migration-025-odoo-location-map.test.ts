import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content-based regression check for migration 025 (Odoo company → location
// mapping). Like migrations 013/019, the SQL is not executed here.

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/025_odoo_company_location_map.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 025 — odoo_company_id on restaurant_locations", () => {
  it("adds the nullable integer column idempotently", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS odoo_company_id integer NULL"
    );
  });

  it("is purely additive: no UPDATE/DELETE/DROP/ALTER COLUMN/policy changes", () => {
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/CREATE POLICY/i);
    expect(statements).not.toMatch(/ALTER POLICY/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("creates a unique index on (company_id, odoo_company_id) WHERE NOT NULL", () => {
    expect(statements).toContain("CREATE UNIQUE INDEX");
    expect(statements).toContain("restaurant_locations_odoo_company_uniq");
    expect(statements).toContain("(company_id, odoo_company_id)");
    expect(statements).toContain("WHERE odoo_company_id IS NOT NULL");
  });

  it("contains the manual-apply note and the production-backup note", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("production access (only after backup #21");
  });

  it("does not set NOT NULL constraint or DEFAULT value", () => {
    // Accept "NULL" keyword as explicit nullability, reject "NOT NULL" constraint
    expect(statements).not.toMatch(/\bNOT\s+NULL\b/i);
    expect(statements).not.toMatch(/\bDEFAULT\b/i);
  });
});
