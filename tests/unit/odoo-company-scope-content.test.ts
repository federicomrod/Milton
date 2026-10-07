import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Content regression for Odoo multi-company isolation: nothing may bypass
// lib/restaurant/odoo/scoped.ts, and the audit / GET paths stay read-only.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const ALLOWED = new Set([
  "lib/restaurant/odoo/client.ts",
  "lib/restaurant/odoo/scoped.ts",
]);
const FORBIDDEN = [
  "executeKw(",
  "unsafeExecuteKw",
  '"execute_kw"',
  "/xmlrpc/2/object",
];

describe("no Odoo RPC bypasses the scoped helper", () => {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))].map(
    (f) => relative(ROOT, f).split("\\").join("/")
  );

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("lib/restaurant/odoo/scoped.ts");
  });

  it("only client.ts and scoped.ts reference the raw RPC", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = read(f);
      for (const needle of FORBIDDEN) {
        // "scopedExecuteKw(" contains the substring "ExecuteKw(" with a
        // capital E, so a case-sensitive "executeKw(" match is exact.
        if (src.includes(needle)) offenders.push(`${f}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("client.ts no longer exports a function named executeKw", () => {
    const src = read("lib/restaurant/odoo/client.ts");
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+executeKw\b/);
    expect(src).toMatch(/export\s+async\s+function\s+unsafeExecuteKw\b/);
  });
});

describe("odoo-sync route", () => {
  const src = read("app/api/restaurant/pos/odoo-sync/route.ts");

  it("uses the scoped helper and the scope assertion", () => {
    expect(src).toContain("scopedExecuteKw");
    expect(src).toContain("assertOdooScope");
  });

  it("re-checks records for both pos.order and pos.order.line", () => {
    expect(src).toContain('assertRecordsInScope("pos.order", orders');
    expect(src).toContain('assertRecordsInScope("pos.order.line", lines');
  });

  it("checks the scope before decrypting the secret", () => {
    const scopeAt = src.indexOf("assertOdooScope(conn.odoo_company_ids)");
    const secretAt = src.indexOf("loadDecryptedOdooSecret(conn.id");
    expect(scopeAt).toBeGreaterThan(-1);
    expect(secretAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeLessThan(secretAt);
  });
});

describe("read-only paths", () => {
  it("the audit route performs no writes", () => {
    const src = read("app/api/restaurant/pos/odoo-audit/route.ts");
    for (const needle of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      '"create"',
      '"write"',
      '"unlink"',
    ]) {
      expect(src).not.toContain(needle);
    }
  });

  it("the odoo-companies GET handler performs no writes", () => {
    const src = read("app/api/restaurant/pos/odoo-companies/route.ts");
    const get = src.split("export async function POST")[0];
    expect(get).toContain("export async function GET");
    for (const needle of [".update(", ".insert(", ".upsert("]) {
      expect(get).not.toContain(needle);
    }
  });
});

describe("Milton company stays server-side", () => {
  it.each(["odoo-sync", "odoo-connection", "odoo-companies", "odoo-audit"])(
    "%s never reads body.company_id",
    (route) => {
      const src = read(`app/api/restaurant/pos/${route}/route.ts`);
      expect(src).not.toMatch(/body\.company_id/);
      expect(src).not.toMatch(/searchParams\.get\(["']company_id["']\)/);
    }
  );
});
