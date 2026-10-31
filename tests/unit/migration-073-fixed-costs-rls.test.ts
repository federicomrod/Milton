import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/auth/capabilities";

// Content checks for migration 073 (the SQL itself is exercised by
// supabase/tests/fixed_costs_rls.sql against a real database).
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/073_fixed_costs_write_roles.sql");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const TABLES = [
  "restaurant_fixed_costs",
  "restaurant_fixed_costs_log",
  "fixed_cost_upload_drafts",
];

describe("migration 073: fixed costs write roles", () => {
  it("allows exactly the roles the app allows for «costs.fixed»", () => {
    const inSql = [
      ...(/ARRAY\[''([a-z]+)'',''([a-z]+)'',''([a-z]+)''\]/.exec(code) ?? []),
    ].slice(1);
    expect(inSql.sort()).toEqual([...CAPABILITIES["costs.fixed"]].sort());
    expect(inSql.sort()).toEqual(["admin", "manager", "owner"]);
  });

  it("the helper uses the membership table and role column, is hardened like 022", () => {
    expect(code).toContain(
      "public.has_company_role(target_company_id uuid, roles text[])"
    );
    expect(code).toContain("FROM public.company_memberships cm");
    expect(code).toContain("cm.user_id = auth.uid()");
    expect(code).toContain("lower(btrim(cm.role)) = ANY (roles)");
    expect(code).toContain("SECURITY DEFINER");
    expect(code).toContain("SET search_path = public");
    expect(code).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.has_company_role\(uuid, text\[\]\) FROM PUBLIC, anon/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.has_company_role\(uuid, text\[\]\) TO authenticated, service_role/
    );
    // created only when missing; is_company_member is never redefined
    expect(code).toContain("IF NOT EXISTS");
    expect(code).not.toMatch(
      /CREATE (OR REPLACE )?FUNCTION public\.is_company_member/
    );
    expect(code).not.toMatch(/OR REPLACE/);
  });

  it("covers every table 064 made, swapping only the write policies", () => {
    const m064 = read("supabase/migrations/064_restaurant_fixed_costs.sql");
    for (const t of TABLES) expect(m064).toContain(t);
    for (const t of TABLES) expect(code).toContain(`'${t}'`);
    for (const op of ["insert", "update", "delete"]) {
      expect(code).toContain(`'_member_${op}'`);
      expect(code).toContain(`'_writers_${op}'`);
    }
    expect(code).toMatch(/DROP POLICY IF EXISTS %I/);
    // SELECT policies are not touched
    expect(code).not.toContain("_member_select");
    expect(code).not.toMatch(
      /DROP POLICY IF EXISTS %I ON public\.%I', t \|\| '_member_select/
    );
    expect(code).toContain("FOR INSERT WITH CHECK");
    expect(code).toContain("FOR UPDATE USING");
    expect(code).toContain("FOR DELETE USING");
  });

  it("keeps Milton staff members able to write, and nothing else changes", () => {
    expect(code).toContain(
      "public.is_company_member(company_id) AND public.is_milton_admin()"
    );
    expect(code).not.toMatch(
      /CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE public|DELETE FROM|GRANT ALL/i
    );
  });

  it("is one transaction, and says it is not additive", () => {
    expect(code).toMatch(/^BEGIN;/m);
    expect(code).toMatch(/^COMMIT;/m);
    expect(sql).toContain("NOT ADDITIVE");
  });

  it("the secdef guard allowlists the helper (authenticated only)", () => {
    const guard = read("supabase/tests/secdef_guard.sql");
    expect(guard).toMatch(
      /'has_company_role',\s+'uuid, text\[\]',\s+ARRAY\['authenticated'\]/
    );
  });

  it("the RLS script tests member read-only and manager/admin/owner write", () => {
    const rls = read("supabase/tests/fixed_costs_rls.sql");
    for (const who of ["member", "owner", "admin", "manager", "stranger"])
      expect(rls).toContain(`'${who}'`);
    expect(rls).toContain("ROLLBACK;");
  });
});
