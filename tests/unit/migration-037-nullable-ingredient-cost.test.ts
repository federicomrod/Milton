import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/037_nullable_ingredient_unit_cost.sql"
  ),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 037 — nullable ingredient unit cost", () => {
  it("drops NOT NULL on current_unit_cost without dropping tables", () => {
    expect(sql).toContain("current_unit_cost");
    expect(sql).toContain("DROP NOT NULL");
    expect(sql).toContain("ALTER TABLE public.ingredients");
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP COLUMN\b/i);
  });
});
