import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const file = "068_kitchen_app_identity.sql";
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const EXCEPTION_TEXT =
  "NON-ADDITIVE EXCEPTION approved by Fede on 29 Oct 2026 (like 040 and 063): drops NOT NULL on the Telegram id columns so cooks can use the app without Telegram. No data is changed; existing rows and existing unique keys keep working for Telegram rows.";

describe("migration 068", () => {
  it("is the only 068 file", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("068_"))).toEqual([
      file,
    ]);
  });

  it("states the approved non-additive exception word for word in the header", () => {
    expect(sql).toContain(EXCEPTION_TEXT);
    const headerEnd = sql.indexOf("DO $$");
    expect(sql.indexOf(EXCEPTION_TEXT)).toBeLessThan(headerEnd);
  });

  it("enables RLS on both new tables and reads via is_company_member", () => {
    for (const table of ["kitchen_invites", "kitchen_devices"]) {
      expect(code).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(code).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_member_select ON public\\.${table}\\s+FOR SELECT USING \\(public\\.is_company_member\\(company_id\\)\\)`
        )
      );
    }
  });

  it("has no insert/update/delete policies (writes are service role only)", () => {
    expect(code).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("stores only hashes: no secret/token column without _hash", () => {
    const columns = [
      ...code.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz|boolean)/gm),
    ].map((m) => m[1]);
    expect(columns).toContain("secret_hash");
    expect(columns).toContain("token_hash");
    for (const c of columns) {
      if (/token|secret/.test(c)) expect(c).toMatch(/_hash$/);
    }
  });

  it("has no DROP TABLE / DROP COLUMN / DROP CONSTRAINT / DROP INDEX", () => {
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/DROP\s+COLUMN/i);
    expect(code).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(code).not.toMatch(/DROP\s+INDEX/i);
  });

  it("the only DROP NOT NULL statements are the six approved ones", () => {
    const drops = [
      ...code.matchAll(
        /ALTER TABLE public\.(\w+) ALTER COLUMN (\w+) DROP NOT NULL/g
      ),
    ].map((m) => `${m[1]}.${m[2]}`);
    expect(drops.sort()).toEqual(
      [
        "kitchen_staff.telegram_user_id",
        "kitchen_staff.chat_id",
        "kitchen_reports.telegram_chat_id",
        "kitchen_reports.telegram_message_id",
        "kitchen_recipe_drafts.telegram_chat_id",
        "kitchen_recipe_drafts.telegram_message_id",
      ].sort()
    );
    // Every DROP NOT NULL is guarded so re-running is safe.
    expect((code.match(/DROP NOT NULL/g) ?? []).length).toBe(6);
    expect((code.match(/is_nullable = 'NO'/g) ?? []).length).toBe(6);
  });

  it("no other ALTER COLUMN, and no new NOT NULL on an existing column", () => {
    const alterColumns = code.match(/ALTER COLUMN/g) ?? [];
    expect(alterColumns.length).toBe(6);
    expect(code).not.toMatch(/SET NOT NULL/i);
  });

  it("adds the new columns with safe defaults", () => {
    expect(code).toMatch(
      /ALTER TABLE public\.kitchen_staff\s+ADD COLUMN IF NOT EXISTS can_see_costs boolean NOT NULL DEFAULT false/
    );
    for (const t of ["kitchen_reports", "kitchen_recipe_drafts"]) {
      expect(code).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'telegram'\\s+CHECK \\(channel IN \\('telegram', 'app'\\)\\)`
        )
      );
      expect(code).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS client_ref text NULL`
        )
      );
    }
  });

  it("has the partial unique index for app retries on reports", () => {
    expect(code).toMatch(
      /UNIQUE INDEX IF NOT EXISTS kitchen_reports_staff_client_ref_key[\s\S]*?\(staff_id, client_ref\)\s*WHERE client_ref IS NOT NULL/
    );
  });

  it("invites and devices cascade from companies and have the required keys", () => {
    expect(code).toMatch(
      /kitchen_invites[\s\S]*?company_id\s+uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/
    );
    expect(code).toMatch(/secret_hash\s+text NOT NULL UNIQUE/);
    expect(code).toMatch(/token_hash\s+text NOT NULL UNIQUE/);
    expect(code).toMatch(
      /platform\s+text NULL CHECK \(platform IN \('ios', 'android'\)\)/
    );
    expect(code).toMatch(
      /kitchen_invites_company_location_created_idx[\s\S]*?\(company_id, location_id, created_at DESC\)/
    );
    expect(code).toMatch(
      /kitchen_devices_company_staff_idx[\s\S]*?\(company_id, staff_id\)/
    );
  });

  it("never touches company_memberships", () => {
    expect(code).not.toMatch(/company_memberships/);
  });

  it("does not reference the reserved 066 or the push migration 069", () => {
    expect(sql).not.toMatch(/\b06[69]\b/);
    expect(sql).not.toMatch(/push_devices|push_sends/);
  });
});
