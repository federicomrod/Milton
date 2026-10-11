import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/034_kitchen_attention_feed.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 034 — kitchen attention feed", () => {
  it("adds resolve columns and a DEFINER feed RPC", () => {
    expect(sql).toContain("resolved_at");
    expect(sql).toContain("resolved_by");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    expect(sql).toContain("kitchen_attention_feed");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("is_company_member(p_company_id)");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain("manually into the Supabase SQL Editor");
  });

  it("fails closed and never returns Telegram file ids", () => {
    expect(sql).toContain("'reports', '[]'::jsonb");
    expect(sql).not.toMatch(/telegram_file_id/);
    expect(sql).not.toMatch(/telegram_chat_id/);
    expect(sql).not.toMatch(/telegram_message_id/);
    expect(sql).toContain("p_location_id IS NOT NULL AND NOT EXISTS");
  });

  it("does not delete rows or drop tables", () => {
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(statements).not.toMatch(/\bDROP\s+POLICY\b/i);
  });

  it("grants the RPC to authenticated only", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.kitchen_attention_feed"
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.kitchen_attention_feed"
    );
    expect(sql).toContain("FROM PUBLIC, anon");
  });
});
