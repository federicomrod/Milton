import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Odoo Production Hardening v1 — migration 013 is unapplied, hand-edited
// SQL, not something we can execute against a real Postgres in this test
// suite. This is a content-based regression check: it asserts the fixed
// index definition stays fixed, and that restaurant_pos_secrets stays
// locked down. See the migration file's own comments for the full
// ON CONFLICT / NULL-uniqueness reasoning (scenario 9).

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/013_pos_sales_idempotency_and_connections.sql"
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("migration 013 — pos_sales_items idempotency index (scenario 9)", () => {
  it("defines pos_sales_items_source_line_uniq as a NORMAL (non-partial) unique index", () => {
    const match = sql.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_items_source_line_uniq[\s\S]*?;/
    );
    expect(match).not.toBeNull();
    const statement = match![0];
    expect(statement).toContain("(company_id, pos_source, external_line_id)");
    // The bug this migration fixes: a `WHERE external_line_id IS NOT NULL`
    // partial predicate here makes PostgREST's onConflict-based upsert
    // fail on every call, since it cannot express that predicate as an
    // ON CONFLICT target. This must never come back.
    expect(statement).not.toMatch(/WHERE/i);
  });

  it("does not touch the existing restaurant_pos_connections uniqueness rule", () => {
    expect(sql).toContain(
      "CONSTRAINT restaurant_pos_connections_uniq\n    UNIQUE (company_id, pos_source)"
    );
  });
});

describe("migration 013 — restaurant_pos_secrets is service-role only", () => {
  it("enables RLS on restaurant_pos_secrets", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.restaurant_pos_secrets ENABLE ROW LEVEL SECURITY/
    );
  });

  it("defines zero CREATE POLICY statements for restaurant_pos_secrets", () => {
    // Every restaurant_pos_connections policy explicitly names that
    // table; restaurant_pos_secrets must never appear in a CREATE POLICY
    // statement anywhere in this file.
    const policyStatements = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    for (const stmt of policyStatements) {
      expect(stmt).not.toContain("restaurant_pos_secrets");
    }
  });

  it("stores only encrypted material — no column suggests plaintext storage", () => {
    const tableMatch = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.restaurant_pos_secrets \(([\s\S]*?)\);/
    );
    expect(tableMatch).not.toBeNull();
    // Strip `-- comment` lines first — this check is about column
    // identifiers, not prose (the surrounding comments legitimately say
    // "never plaintext" to explain why).
    const columnsOnly = tableMatch![1]
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(columnsOnly).toContain("encrypted_secret");
    expect(columnsOnly).toContain("iv");
    expect(columnsOnly).toContain("auth_tag");
    expect(columnsOnly.toLowerCase()).not.toMatch(/\bpassword\b/);
    expect(columnsOnly.toLowerCase()).not.toMatch(/\bapi_key\b/);
    expect(columnsOnly.toLowerCase()).not.toMatch(/\bplaintext\b/);
  });

  it("scopes restaurant_pos_secrets by both connection_id and company_id, each with a FK", () => {
    const tableMatch = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.restaurant_pos_secrets \(([\s\S]*?)\);/
    );
    const columns = tableMatch![1];
    expect(columns).toMatch(
      /connection_id\s+uuid NOT NULL UNIQUE\s+REFERENCES public\.restaurant_pos_connections\(id\) ON DELETE CASCADE/
    );
    expect(columns).toMatch(
      /company_id\s+uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/
    );
  });
});
