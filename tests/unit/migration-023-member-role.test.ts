import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content-based regression check for migration 023 (not executed here).

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/023_membership_role_member.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 023", () => {
  it("drops the old company_memberships_role_check constraint", () => {
    expect(code).toContain(
      "DROP CONSTRAINT IF EXISTS company_memberships_role_check"
    );
  });
  it("re-creates the constraint with owner, admin, manager, analyst, viewer, and member", () => {
    expect(code).toContain("ADD CONSTRAINT company_memberships_role_check");
    expect(code).toContain("'owner'::text");
    expect(code).toContain("'admin'::text");
    expect(code).toContain("'manager'::text");
    expect(code).toContain("'analyst'::text");
    expect(code).toContain("'viewer'::text");
    expect(code).toContain("'member'::text");
  });
  it("is wrapped in a transaction", () => {
    expect(code).toMatch(/BEGIN\s*;/);
    expect(code).toMatch(/COMMIT\s*;/);
  });
  it("only alters company_memberships and does nothing else", () => {
    expect(code).not.toMatch(/CREATE TABLE/i);
    expect(code).not.toMatch(/DROP TABLE/i);
    expect(code).not.toMatch(/CREATE FUNCTION/i);
    expect(code).not.toMatch(/DROP FUNCTION/i);
    expect(code).not.toMatch(/INSERT INTO/i);
    expect(code).not.toMatch(/UPDATE/i);
    expect(code).not.toMatch(/DELETE FROM/i);
    const alters = [...code.matchAll(/ALTER TABLE ([\w.]+)/g)].map((m) => m[1]);
    for (const t of alters) {
      expect(t).toBe("public.company_memberships");
    }
  });
});
