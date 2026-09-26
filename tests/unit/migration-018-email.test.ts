import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Email Briefing Extension v1 — migration 018 is unapplied, hand-edited
// SQL, not something we can execute against a real Postgres in this test
// suite (same rationale as migration-013/017's content-regression tests).

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/018_briefing_email_delivery.sql"
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("migration 018 — briefing_email_* columns on companies", () => {
  it("is a purely additive ALTER TABLE on public.companies", () => {
    expect(sql).toMatch(/ALTER TABLE public\.companies/);
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("defines cadence with a safe default and no CHECK constraint", () => {
    const statement = sql.slice(sql.indexOf("ALTER TABLE public.companies"));
    expect(statement).toContain(
      "briefing_email_cadence text NOT NULL DEFAULT 'off'"
    );
    expect(statement).not.toMatch(/CHECK/);
  });

  it("defines a nullable recipient with no default value baked in", () => {
    expect(sql).toContain("briefing_email_recipient text NULL");
  });

  it("defines weekday defaulting to Monday (1)", () => {
    expect(sql).toContain("briefing_email_weekday smallint NOT NULL DEFAULT 1");
  });

  it("defines an explicit timezone column defaulting to UTC (never silently inferred)", () => {
    expect(sql).toContain(
      "briefing_email_timezone text NOT NULL DEFAULT 'UTC'"
    );
  });

  it("reserves a nullable last-sent marker for the future scheduler", () => {
    expect(sql).toContain("briefing_email_last_sent_at timestamptz NULL");
  });
});
