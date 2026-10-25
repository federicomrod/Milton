import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const file = "063_kitchen_staff_multi_location.sql";
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 063", () => {
  it("is the only 063 file", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("063_"))).toEqual([
      file,
    ]);
  });
  it("starts with the exception notice and says it is pasted by hand", () => {
    expect(
      sql.startsWith(
        "-- ⚠️ NEEDS FEDE'S EXPLICIT OK BEFORE PASTING: exception to additive-only migrations (replaces a UNIQUE constraint)"
      )
    ).toBe(true);
    expect(sql).toMatch(/BY HAND into the Supabase SQL Editor/);
    expect(sql).toMatch(/Staging first/);
  });
  it("looks the old unique up and drops it, then adds the new one once", () => {
    expect(code).toContain("pg_constraint");
    expect(code).toContain("DO $$");
    expect(code).toContain("DROP CONSTRAINT %I");
    expect(code).toContain("ARRAY['telegram_user_id']");
    expect(code).toMatch(
      /IF NOT EXISTS \([\s\S]*?kitchen_staff_telegram_user_location_key/
    );
    expect(code).toContain("UNIQUE (telegram_user_id, location_id)");
    expect(code).toMatch(
      /CREATE INDEX IF NOT EXISTS kitchen_staff_tg_user_active_idx[\s\S]*?WHERE is_active/
    );
  });
  it("creates both tables with RLS and no policies", () => {
    for (const t of ["kitchen_pending_items", "kitchen_routing_defaults"]) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
      expect(code).toContain(
        `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(code).not.toMatch(/CREATE POLICY/i);
    expect(code).toContain("UNIQUE (chat_id, telegram_message_id)");
    expect(code).toMatch(/nonce\s+text NOT NULL UNIQUE/);
  });
  it("has the rollback and check blocks (as comments)", () => {
    expect(sql).toMatch(/-- ROLLBACK/);
    expect(sql).toMatch(/HAVING count\(\*\) > 1/);
    expect(sql).toMatch(/-- CHECK AFTER PASTING \(READ-ONLY/);
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/pg_policies/);
  });
  it("drops no column and no table (outside comments)", () => {
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/DROP\s+COLUMN/i);
    expect(code).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });
});
