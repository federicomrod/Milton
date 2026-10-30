import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const file = "071_kitchen_report_app_result.sql";
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 071", () => {
  it("is the only 071 file", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("071_"))).toEqual([
      file,
    ]);
  });
  it("is additive: one nullable column, nothing dropped or changed", () => {
    expect(code).toMatch(
      /ALTER TABLE public\.kitchen_reports\s+ADD COLUMN IF NOT EXISTS app_result jsonb NULL/
    );
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/ALTER COLUMN/i);
    expect(code).not.toMatch(/NOT NULL/i);
    expect(code).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
    expect((code.match(/ALTER TABLE/g) ?? []).length).toBe(1);
  });
  it("adds no policy and touches no other table", () => {
    expect(code).not.toMatch(/POLICY/i);
    expect(code).not.toMatch(/CREATE TABLE/i);
    expect(code).not.toMatch(/company_memberships/);
  });
});
