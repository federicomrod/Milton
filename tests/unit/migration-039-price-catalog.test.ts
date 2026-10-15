import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/039_price_catalog_and_aliases.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 039 — price catalog and aliases", () => {
  it("is additive: nullable columns and one new table, no drops or alters", () => {
    expect(statements).toContain(
      "ADD COLUMN IF NOT EXISTS chosen_cost_entry_id uuid NULL"
    );
    expect(statements).toContain(
      "ADD COLUMN IF NOT EXISTS chosen_by uuid NULL"
    );
    expect(statements).toContain(
      "ADD COLUMN IF NOT EXISTS chosen_at timestamptz NULL"
    );
    expect(statements).toContain(
      "CREATE TABLE IF NOT EXISTS public.ingredient_aliases"
    );
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
    expect(statements).not.toMatch(/\bUPDATE\s+public\./);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/);
  });

  it("clears the chosen entry if the entry is deleted (undo-safe)", () => {
    expect(statements).toContain(
      "REFERENCES public.ingredient_cost_entries(id) ON DELETE SET NULL"
    );
  });

  it("scopes aliases to one company with the same RLS rule as 038", () => {
    expect(statements).toContain(
      "company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE"
    );
    expect(statements).toContain("ingredient_aliases_company_key_uniq");
    expect(statements).toContain("ENABLE ROW LEVEL SECURITY");
    expect(statements).toContain("is_company_member(company_id)");
    expect(statements).toContain("ingredient_aliases_member");
    expect(statements).toContain(
      "GRANT ALL ON TABLE public.ingredient_aliases TO anon, authenticated, service_role"
    );
  });

  it("carries the staging-only header like 038 and no production apply", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("No production apply");
  });
});
