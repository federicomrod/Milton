// Migration 078 is additive, company-scoped, and keeps the PIN hash out of
// reach of the web: the pins table has RLS on and NO policy, and nothing in
// the web code selects pin_hash.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const file = "078_kitchen_stay_signed_in.sql";
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 078", () => {
  it("is the only 078 file", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("078_"))).toEqual([
      file,
    ]);
  });
  it("is additive: nothing dropped, renamed, truncated or made stricter", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bRENAME\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/SET\s+NOT\s+NULL/i);
    for (const alter of code.match(/ALTER TABLE[\s\S]*?;/gi) ?? []) {
      expect(alter).toMatch(
        /ADD COLUMN IF NOT EXISTS|ENABLE ROW LEVEL SECURITY/i
      );
    }
    expect(code).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.kitchen_staff_pins/
    );
    expect(code).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.kitchen_pin_attempts/
    );
  });
  it("RLS is on for both new tables; the pins table has no policy; attempts read via is_company_member", () => {
    for (const t of ["kitchen_staff_pins", "kitchen_pin_attempts"]) {
      expect(code).toContain(
        `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(code).not.toMatch(/CREATE POLICY[^;]*kitchen_staff_pins/);
    expect(code).toMatch(
      /CREATE POLICY kitchen_pin_attempts_member_select[\s\S]*is_company_member\(company_id\)/
    );
    expect(code).toMatch(
      /kitchen_staff_pins[\s\S]*company_id\s+uuid NOT NULL REFERENCES public\.companies/
    );
  });
});

function files(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (n === "node_modules" || n === ".next" || n === "tests") return [];
    return statSync(p).isDirectory()
      ? files(p)
      : /\.(ts|tsx)$/.test(n)
        ? [p]
        : [];
  });
}

describe("pin_hash never reaches the web or an API", () => {
  it("only the pin store reads it, and nothing returns it", () => {
    const roots = ["app", "components", "lib"].map((r) =>
      join(process.cwd(), r)
    );
    const hits = roots
      .flatMap(files)
      .filter((f) =>
        readFileSync(f, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .includes("pin_hash")
      )
      .map((f) => f.slice(process.cwd().length + 1));
    expect(hits.sort()).toEqual(["lib/restaurant/kitchen/pin-store.ts"]);
  });
});
