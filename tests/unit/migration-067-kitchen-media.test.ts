import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const file = "067_kitchen_media_storage.sql";
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 067", () => {
  it("is the only 067 file", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("067_"))).toEqual([
      file,
    ]);
  });
  it("creates a private bucket and never overwrites an existing one", () => {
    expect(code).toMatch(/INSERT INTO storage\.buckets/);
    expect(code).toMatch(/'kitchen-media',\s*'kitchen-media',\s*false/);
    expect(code).toContain("ON CONFLICT (id) DO NOTHING");
    expect(code).toContain("26214400");
  });
  it("enables RLS and uses is_company_member for both policies", () => {
    expect(code).toContain(
      "ALTER TABLE public.kitchen_media ENABLE ROW LEVEL SECURITY"
    );
    expect(code).toMatch(
      /kitchen_media_member_select[\s\S]*?public\.is_company_member\(company_id\)/
    );
    expect(code).toMatch(
      /ON storage\.objects[\s\S]*?bucket_id = 'kitchen-media'[\s\S]*?is_company_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/
    );
  });
  it("only has SELECT policies (writes are service role only)", () => {
    expect(code).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it("is additive: no DROP, no ALTER COLUMN, no NOT NULL added to existing tables", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/ALTER COLUMN/i);
    const alters = code.match(/ALTER TABLE[^;]*;/gi) ?? [];
    for (const a of alters) {
      expect(a).toContain("public.kitchen_media ENABLE ROW LEVEL SECURITY");
    }
  });
  it("has the partial unique index for retries", () => {
    expect(code).toMatch(
      /UNIQUE INDEX IF NOT EXISTS[\s\S]*?\(channel, source_ref\)\s*WHERE source_ref IS NOT NULL/
    );
  });
  it("does not reference the reserved 065 / 066 migrations", () => {
    expect(sql).not.toMatch(/\b06[56]_/);
  });
});
