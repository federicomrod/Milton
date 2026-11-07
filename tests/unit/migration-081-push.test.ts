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

  it("push_devices: a manager manages own rows; service role too; anon nothing", () => {
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.push_devices\s+TO authenticated, service_role/
    );
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.push_devices FROM anon/);
    expect(code).toMatch(/user_id = auth\.uid\(\)/);
  });

  it("push_sends: service role only, no policy, nothing for anon or authenticated", () => {
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.push_sends TO service_role;/
    );
    expect(code).toMatch(
      /REVOKE ALL ON TABLE public\.push_sends FROM anon, authenticated/
    );
    expect(code).not.toMatch(/CREATE POLICY \w+ ON public\.push_sends/);
    // Never granted to the app roles, in any statement.
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
