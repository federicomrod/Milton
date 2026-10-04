import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content-based regression check for migration 021 (not executed here).

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/021_kitchen_telegram.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 021", () => {
  it("creates the three tables", () => {
    for (const t of [
      "kitchen_join_tokens",
      "kitchen_staff",
      "kitchen_reports",
    ]) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
    }
  });

  it("stores only a token hash (unique) with a live-token partial unique index", () => {
    expect(code).toMatch(/token_hash\s+text NOT NULL UNIQUE/);
    expect(code).not.toMatch(/\btoken\s+text/);
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS kitchen_join_tokens_one_live_per_location[\s\S]*?\(location_id\)[\s\S]*?WHERE revoked_at IS NULL/
    );
    expect(code).not.toMatch(/expires_at/);
  });

  it("enforces one row per cook and idempotent Telegram retries", () => {
    expect(code).toContain("UNIQUE (telegram_user_id)");
    expect(code).toContain("UNIQUE (telegram_chat_id, telegram_message_id)");
  });

  it("stores no phone number or username", () => {
    expect(code).not.toMatch(/phone|username/i);
  });

  it("restricts role and report types", () => {
    expect(code).toContain("CHECK (role = 'kitchen')");
    expect(code).toContain(
      "CHECK (report_type IN ('running_out', '86', 'waste', 'unclassified'))"
    );
    expect(code).toContain("CHECK (media_kind IN ('photo', 'voice'))");
  });

  it("enables RLS on all three tables", () => {
    for (const t of [
      "kitchen_join_tokens",
      "kitchen_staff",
      "kitchen_reports",
    ]) {
      expect(code).toContain(
        `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`
      );
    }
  });

  it("has zero policies on kitchen_join_tokens and SELECT-only member policies elsewhere", () => {
    expect(code).not.toMatch(/ON public\.kitchen_join_tokens\s+FOR/);
    const policies = [
      ...code.matchAll(
        /CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+) USING \(([^)]*\)?)\)/g
      ),
    ];
    expect(policies.map((p) => p[2]).sort()).toEqual([
      "kitchen_reports",
      "kitchen_staff",
    ]);
    for (const p of policies) {
      expect(p[3]).toBe("SELECT");
      expect(p[4]).toContain("public.is_company_member(company_id)");
    }
    expect(code).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("is additive: no DROP, and leaves the manager Telegram tables alone", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toContain("restaurant_telegram_connections");
    expect(sql).not.toContain("restaurant_telegram_pairing_codes");
    for (const m of code.matchAll(/ALTER TABLE ([\w.]+)/g)) {
      expect(m[1]).toMatch(/^public\.kitchen_/);
    }
  });

  it("contains the manual-apply note", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
  });
});
