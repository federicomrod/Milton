import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content regression for migration 022 (SECURITY DEFINER hardening) and the
// guard query. The migration's real behavior is proven against a local
// Supabase stack (see the PR); these checks keep its shape from regressing.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

const migration = read("supabase/migrations/022_secdef_function_hardening.sql");
const code = strip(migration);
const guard = read("supabase/tests/secdef_guard.sql");
const guardCode = strip(guard);

describe("migration 022", () => {
  it("uses only REVOKE / GRANT / ALTER FUNCTION (never redefines a function)", () => {
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(code).not.toMatch(
      /\b(DROP|DELETE|INSERT|UPDATE|CREATE\s+TABLE|CREATE\s+POLICY)\b/i
    );
    expect(code).toMatch(/\bREVOKE\b/);
    expect(code).toMatch(/\bGRANT\b/);
    expect(code).toMatch(/ALTER FUNCTION/);
  });

  it("bootstrap_restaurant_user: revoked from PUBLIC, anon, authenticated; granted to service_role only", () => {
    expect(code).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.bootstrap_restaurant_user\(uuid, text\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bootstrap_restaurant_user\(uuid, text\)\s+TO service_role;/
    );
  });

  it("is_company_member: revoked from PUBLIC and anon; kept for authenticated + service_role", () => {
    expect(code).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.is_company_member\(uuid\)\s+FROM PUBLIC, anon;/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_company_member\(uuid\)\s+TO authenticated, service_role;/
    );
  });

  it("pins search_path on unpinned SECURITY DEFINER functions in public", () => {
    expect(code).toContain("p.prosecdef");
    expect(code).toContain("SET search_path = public, pg_temp");
  });

  it("explains itself and carries the manual-apply / approval note", () => {
    expect(migration).toContain("direct");
    expect(migration).toContain("manually into the Supabase SQL Editor");
    expect(migration).toMatch(/explicitly approves/);
  });
});

describe("secdef_guard.sql", () => {
  it("is a read-only catalog query", () => {
    expect(guardCode).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE)\b/i
    );
    expect(guardCode).toContain("aclexplode");
    expect(guardCode).toContain("has_function_privilege");
    expect(guardCode).toContain("prosecdef");
  });

  it("every allowlist entry has a non-empty one-line reason", () => {
    const block = guard.slice(
      guard.indexOf("WITH allowlist"),
      guard.indexOf("managed_schemas")
    );
    const rows = block.match(/\('public',[\s\S]*?\)\s*(?:,|\n\))/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      const strings = row.match(/'([^']*)'/g) ?? [];
      const reason = strings[strings.length - 1].replace(/'/g, "");
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("allowlist excuses authenticated only, never anon or PUBLIC", () => {
    const block = guard.slice(
      guard.indexOf("WITH allowlist"),
      guard.indexOf("managed_schemas")
    );
    expect(block).not.toMatch(/ARRAY\[[^\]]*'(anon|PUBLIC)'/);
  });
});
