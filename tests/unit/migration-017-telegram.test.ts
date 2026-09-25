import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Telegram Daily Briefing v1 — migration 017 is unapplied, hand-edited SQL,
// not something we can execute against a real Postgres in this test suite
// (same rationale as tests/unit/migration-013-index.test.ts). This is a
// content-based regression check: it asserts the approved access-control
// shape stays fixed.

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/017_telegram_connections.sql"
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("migration 017 — restaurant_telegram_connections", () => {
  it("enforces one company = one chat and one chat = one company", () => {
    expect(sql).toContain(
      "CONSTRAINT restaurant_telegram_connections_company_uniq UNIQUE (company_id)"
    );
    expect(sql).toContain(
      "CONSTRAINT restaurant_telegram_connections_chat_uniq UNIQUE (chat_id)"
    );
  });

  it("enables RLS and defines only a SELECT policy — no INSERT/UPDATE/DELETE policy for any role", () => {
    const tableSection = sql.slice(
      sql.indexOf(
        "CREATE TABLE IF NOT EXISTS public.restaurant_telegram_connections"
      ),
      sql.indexOf(
        "CREATE TABLE IF NOT EXISTS public.restaurant_telegram_pairing_codes"
      )
    );
    expect(tableSection).toMatch(
      /ALTER TABLE public\.restaurant_telegram_connections ENABLE ROW LEVEL SECURITY/
    );
    const policyStatements =
      tableSection.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policyStatements.length).toBe(1);
    expect(policyStatements[0]).toContain("FOR SELECT");
    expect(policyStatements[0]).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });
});

describe("migration 017 — restaurant_telegram_pairing_codes is service-role only", () => {
  it("enables RLS on restaurant_telegram_pairing_codes", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.restaurant_telegram_pairing_codes ENABLE ROW LEVEL SECURITY/
    );
  });

  it("defines zero CREATE POLICY statements for restaurant_telegram_pairing_codes", () => {
    const pairingSection = sql.slice(
      sql.indexOf(
        "CREATE TABLE IF NOT EXISTS public.restaurant_telegram_pairing_codes"
      )
    );
    const policyStatements =
      pairingSection.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    for (const stmt of policyStatements) {
      expect(stmt).not.toContain("restaurant_telegram_pairing_codes");
    }
  });

  it("codes are single-use (UNIQUE) with an expiry and a consumed marker", () => {
    const tableMatch = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.restaurant_telegram_pairing_codes \(([\s\S]*?)\);/
    );
    expect(tableMatch).not.toBeNull();
    const columns = tableMatch![1];
    expect(columns).toMatch(/code\s+text NOT NULL UNIQUE/);
    expect(columns).toMatch(/expires_at\s+timestamptz NOT NULL/);
    expect(columns).toMatch(/consumed_at\s+timestamptz/);
  });
});
