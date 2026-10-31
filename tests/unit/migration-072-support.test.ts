import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/072_support_multi_company.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 072: support access", () => {
  it("adds the support flag, additive and idempotent", () => {
    expect(code).toContain(
      "ADD COLUMN IF NOT EXISTS is_support boolean NOT NULL DEFAULT false"
    );
  });
  it("creates the audit table company-scoped, RLS on, read only for Milton admins", () => {
    expect(code).toContain(
      "CREATE TABLE IF NOT EXISTS public.support_account_opens"
    );
    expect(code).toContain(
      "company_id         uuid NOT NULL REFERENCES public.companies(id)"
    );
    expect(code).toContain("ENABLE ROW LEVEL SECURITY");
    expect(code).toContain("FOR SELECT USING (public.is_milton_admin())");
    // no policy lets a user write the audit
    expect(code).not.toMatch(
      /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/
    );
    expect(code).toContain(
      "GRANT SELECT ON TABLE public.support_account_opens TO authenticated"
    );
  });
  it("lifts the one-company rule only for Milton admins, keeping the rest of the function", () => {
    expect(code).toContain("RAISE EXCEPTION 'already_member_of_other_company'");
    expect(code).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1 FROM public\.milton_admins WHERE user_id = p_user_id\s*\)/
    );
    expect(code).toContain("SECURITY DEFINER");
    expect(code).toContain("SET search_path = public");
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.accept_workspace_invite\(text, uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.accept_workspace_invite\(text, uuid\) TO service_role/
    );
  });
  it("does not touch any policy or helper that decides access (no RLS bypass)", () => {
    expect(code).not.toMatch(/is_company_member|has_company_role/);
    expect(code).not.toMatch(/DROP POLICY|ALTER POLICY/);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i);
  });
  it("is one transaction", () => {
    expect(code).toMatch(/^BEGIN;/m);
    expect(code).toMatch(/^COMMIT;/m);
  });
});
