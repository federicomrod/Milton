import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/026_company_onboarding_status.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 026", () => {
  it("adds onboarding_status idempotently with a not_started default", () => {
    expect(code).toContain(
      "ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'not_started'"
    );
  });

  it("backfills completed only for companies that already have a location", () => {
    expect(code).toMatch(
      /SET onboarding_status = 'completed'[\s\S]*restaurant_locations/
    );
    expect(code).toContain("IS DISTINCT FROM 'completed'");
  });

  it("is wrapped in a transaction and is additive", () => {
    expect(code).toMatch(/BEGIN\s*;/);
    expect(code).toMatch(/COMMIT\s*;/);
    expect(code).not.toMatch(/DROP TABLE/i);
    expect(code).not.toMatch(/DROP COLUMN/i);
    expect(code).not.toMatch(/created_by/);
  });

  it("includes a read-only check of status vs location", () => {
    expect(code).toMatch(/SELECT[\s\S]*onboarding_status[\s\S]*has_location/);
  });
});
