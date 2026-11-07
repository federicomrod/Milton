// Release gate, enforced in code: no application path writes the financial
// fixed-cost tables directly. Every change is a database command
// (lib/restaurant/fixed-cost-commands.ts, migration 079). Older and mobile
// routes are included because the scan covers the whole app, apps/mobile and the
// scripts folder, not only the web routes.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["app", "lib", "components", "scripts", "apps"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".expo"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e)) out.push(p);
  }
  return out;
}

const FINANCIAL = [
  "restaurant_fixed_costs",
  "restaurant_fixed_costs_log",
  "fixed_cost_items",
  "fixed_cost_commands",
];
const WRITE = /\.\s*(insert|update|upsert|delete)\s*\(/;

describe("no direct writer of the financial fixed-cost tables", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("finds the code it is meant to scan", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(FINANCIAL)(
    "%s is never the target of insert / update / upsert / delete",
    (table) => {
      const offenders: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        // `.from("table")` followed (same statement) by a write call.
        const re = new RegExp(
          `from\\(\\s*["'\`]${table}["'\`]\\s*\\)([\\s\\S]{0,400})`,
          "g"
        );
        for (const m of src.matchAll(re)) {
          const stmt = m[1].split(";")[0];
          if (WRITE.test(stmt)) offenders.push(f);
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  it("the only module that changes cost data calls the database commands (rpc)", () => {
    const src = readFileSync("lib/restaurant/fixed-cost-commands.ts", "utf8");
    for (const fn of [
      "fixed_cost_approve_upload",
      "fixed_cost_save_totals",
      "fixed_cost_item_command",
      "fixed_cost_copy",
      "fixed_cost_undo",
    ])
      expect(src).toContain(fn);
  });

  it("the removed render-time writers stay removed", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(
        /\brepeatFixedCosts\b|\bsaveFixedCosts\b|\bapproveDraft\b|\bundoApproval\b/
      );
    }
    expect(() =>
      readFileSync("app/api/restaurant/fixed-costs/repeat/route.ts")
    ).toThrow();
  });

  it("the draft table (a work area) is the only fixed-cost table the app still writes directly", () => {
    const writers = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        new RegExp(
          `from\\(\\s*["'\`]fixed_cost_upload_drafts["'\`]\\s*\\)[\\s\\S]{0,400}`
        ).test(src) && WRITE.test(src)
      );
    });
    expect(writers).toEqual(["lib/restaurant/fixed-cost-upload-server.ts"]);
  });
});
