import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/081_push_notifications.sql"),
  "utf8"
);
// Statements only: comments and blank lines removed.
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("081 push notifications migration", () => {
  it("is additive: nothing is dropped, renamed or altered on existing tables", () => {
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|INDEX)\b/i);
    expect(code).not.toMatch(/\bRENAME\b/i);
    expect(code).not.toMatch(/\bALTER\s+TABLE\s+public\.(?!push_)/i);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.push_devices/);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.push_sends/);
  });

  it("both tables have RLS on", () => {
    expect(code).toMatch(
      /ALTER TABLE public\.push_devices ENABLE ROW LEVEL SECURITY/
    );
    expect(code).toMatch(
      /ALTER TABLE public\.push_sends ENABLE ROW LEVEL SECURITY/
    );
  });

  // Staging's default privileges give anon, authenticated and service_role ALL
  // (incl. TRUNCATE, which bypasses RLS) on every new table, so each table must
  // REVOKE ALL from PUBLIC and all three roles BEFORE its narrower GRANT.
  const revokeAll = (table: string) =>
    new RegExp(
      `REVOKE ALL ON TABLE public\\.${table}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role;`
    );

  it.each(["push_devices", "push_sends"])(
    "%s: REVOKE ALL from PUBLIC, anon, authenticated and service_role comes before its GRANT",
    (table) => {
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
    }
  );

  it("push_devices: a manager manages own rows (RLS), service role too; anon nothing", () => {
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.push_devices\s+TO authenticated, service_role;/
    );
    expect(code).toMatch(/user_id = auth\.uid\(\)/);
  });

  it("push_sends: service role only, no policy, nothing for anon or authenticated", () => {
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.push_sends TO service_role;/
    );
    expect(code).not.toMatch(/CREATE POLICY \w+ ON public\.push_sends/);
    const grants = code.match(/GRANT[^;]*;/g) ?? [];
    for (const g of grants.filter((x) => /push_sends/.test(x))) {
      expect(g).not.toMatch(/\b(authenticated|anon|PUBLIC)\b/);
    }
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
