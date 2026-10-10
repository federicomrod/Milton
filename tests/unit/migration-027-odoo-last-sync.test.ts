import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/027_odoo_last_sync.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 027 — last_sync on restaurant_pos_connections", () => {
  it("adds the nullable jsonb column idempotently", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS last_sync jsonb NULL");
  });

  it("is purely additive: no UPDATE/DELETE/DROP/policy changes", () => {
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/CREATE POLICY/i);
    expect(statements).not.toMatch(/ALTER POLICY/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("contains the manual-apply note for staging first", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
  });

  it("does not set NOT NULL or a DEFAULT on last_sync", () => {
    expect(statements).not.toMatch(
      /ADD\s+COLUMN[^;]*\blast_sync\b[^;]*\bNOT\s+NULL\b/i
    );
    expect(statements).not.toMatch(
      /ADD\s+COLUMN[^;]*\blast_sync\b[^;]*\bDEFAULT\b/i
    );
  });
});
