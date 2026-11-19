import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/082_app_activity_tracking.sql"),
  "utf8"
);
// Statements only: comments and blank lines removed.
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("082 app activity tracking migration", () => {
  it("is additive: nothing is dropped, renamed or altered on existing tables", () => {
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|INDEX)\b/i);
    expect(code).not.toMatch(/\bRENAME\b/i);
    expect(code).not.toMatch(/\bALTER\s+TABLE\s+public\.(?!app_activity)/i);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_activity/);
    expect(code).toMatch(/CREATE SCHEMA IF NOT EXISTS reporting/);
  });

  it("app_activity has RLS on", () => {
    expect(code).toMatch(
      /ALTER TABLE public\.app_activity ENABLE ROW LEVEL SECURITY/
    );
  });

  it("app_activity: FK to auth.users with ON DELETE CASCADE", () => {
    expect(code).toMatch(
      /user_id\s+uuid\s+NOT NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON DELETE CASCADE/i
    );
  });

  const revokeAll = (table: string) =>
    new RegExp(
      `REVOKE ALL ON TABLE public\\.${table}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role;`
    );

  it("app_activity: REVOKE ALL from PUBLIC, anon, authenticated and service_role comes before its GRANT", () => {
    const table = "app_activity";
    const revoke = revokeAll(table).exec(code);
    expect(revoke, `REVOKE ALL for ${table}`).not.toBeNull();
    const grant = new RegExp(
      `GRANT [A-Z, ]+ ON TABLE public\\.${table}\\b`
    ).exec(code);
    expect(grant, `GRANT for ${table}`).not.toBeNull();
    expect(revoke!.index).toBeLessThan(grant!.index);
    // Exactly one REVOKE and one GRANT per table: nothing re-widens it later.
    expect(
      code.match(new RegExp(`REVOKE[^;]*public\\.${table}\\b`, "g"))
    ).toHaveLength(1);
    expect(
      code.match(new RegExp(`GRANT[^;]*public\\.${table}\\b`, "g"))
    ).toHaveLength(1);
  });

  it("app_activity: users manage own rows (RLS), service role too; anon nothing", () => {
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.app_activity\s+TO authenticated, service_role;/
    );
    expect(code).toMatch(/user_id = auth\.uid\(\)/);
  });

  it("reporting schema exists and service_role has USAGE", () => {
    expect(code).toMatch(/CREATE SCHEMA IF NOT EXISTS reporting/);
    expect(code).toMatch(/GRANT USAGE ON SCHEMA reporting TO service_role;/);
  });

  it("reporting.user_last_seen_report: service_role only, nothing for anon or authenticated", () => {
    expect(code).toMatch(
      /REVOKE ALL ON reporting\.user_last_seen_report FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).toMatch(
      /GRANT SELECT ON reporting\.user_last_seen_report TO service_role;/
    );
    const grants = code.match(/GRANT[^;]*user_last_seen_report[^;]*;/gi) ?? [];
    for (const g of grants) {
      expect(g).not.toMatch(/\b(authenticated|anon|PUBLIC)\b/);
    }
  });

  it("reporting.user_last_seen_report: no ORDER BY in the view definition", () => {
    // Extract the view definition
    const viewMatch = code.match(
      /CREATE OR REPLACE VIEW reporting\.user_last_seen_report AS\s+(SELECT[\s\S]+?);/i
    );
    expect(viewMatch, "view definition found").not.toBeNull();
    const viewDef = viewMatch![1];
    expect(viewDef).not.toMatch(/\bORDER BY\b/i);
  });

  it("no grant gives TRUNCATE, TRIGGER, REFERENCES or MAINTAIN, and none is GRANT ALL", () => {
    const grants = code.match(/\bGRANT\b[^;]*;/gi) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g).not.toMatch(/\b(TRUNCATE|TRIGGER|REFERENCES|MAINTAIN)\b/i);
      expect(g).not.toMatch(/GRANT\s+ALL/i);
    }
  });
});
