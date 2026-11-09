// The all-or-nothing installation package, on a database in the STAGING STATE
// before 079 (064 + 073 only, with legacy rows). Real local Postgres.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";
import {
  agg,
  api,
  line,
  makeDraft,
  seedWorld,
  uuid,
  type World,
} from "./fixtures";

const ROOT = path.resolve(__dirname, "../..");
const PKG = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/install-packages/fixed-cost-079-install-package.sql"
  ),
  "utf8"
);

let db: TestDb;
let admin: Client;
let c: Client;
let w: World;
beforeAll(async () => {
  db = await startTestDb({ baselineOnly: true });
  admin = await db.connect();
  c = await db.connect();
  w = await seedWorld(admin);
  // Legacy rows exactly as staging has them: a total with no items, a log row, a draft.
  await admin.query(
    "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, amount, currency, source, status, repeats) values ($1,$2,'2026-10-01','servicios',4800,'USD','upload','confirmed',true)",
    [w.A, w.L1]
  );
  await admin.query(
    "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, pct_of_sales, currency, source, status, repeats) values ($1,$2,'2026-10-01','impuestos',13,'USD','upload','confirmed',false)",
    [w.A, w.L1]
  );
  await admin.query(
    "insert into public.restaurant_fixed_costs_log (company_id, month, category, action, new_value, source) values ($1,'2026-10-01','servicios','create','{\"amount\":4800}','upload')",
    [w.A]
  );
  await admin.query(
    "insert into public.fixed_cost_upload_drafts (company_id, file_name, parsed_lines, status) values ($1,'legacy.xlsx','[]'::jsonb,'approved')",
    [w.A]
  );
});
afterAll(async () => {
  await c?.end();
  await admin?.end();
  await db?.stop();
});

/**
 * Runs a script the way an operator's runner does. A failed script leaves the
 * session inside an aborted transaction (nothing was kept); ending it is a
 * ROLLBACK, which is what closing the SQL editor tab or psql does.
 */
async function run(sql: string) {
  try {
    return await admin.query(sql);
  } catch (e) {
    await admin.query("ROLLBACK");
    throw e;
  }
}

const state = async () =>
  (
    await admin.query(`select
      (select count(*)::int from pg_namespace where nspname='fixed_cost_private') as sch,
      (select count(*)::int from pg_class where relname in ('fixed_cost_items','fixed_cost_commands')) as tbl,
      (select count(*)::int from information_schema.columns where table_name='restaurant_fixed_costs' and column_name in ('version','detail_state','copy_source')) as col,
      (select count(*)::int from pg_proc where proname like 'fixed\\_cost\\_%' or proname like 'fc\\_%') as fn,
      (select md5(string_agg(to_jsonb(f)::text, ',' order by id)) from public.restaurant_fixed_costs f) as agg`)
  ).rows[0];

describe("the package is the reviewed migration, nothing else", () => {
  it("is up to date with 079 (generator --check)", () => {
    expect(() =>
      execFileSync(
        "node",
        ["scripts/build-fixed-cost-install-package.mjs", "--check"],
        { cwd: ROOT, stdio: "pipe" }
      )
    ).not.toThrow();
  });
  it("is one BEGIN ... COMMIT, contains 079 verbatim and neither 080 nor the 081 proposal", () => {
    const mig = fs.readFileSync(
      path.join(
        ROOT,
        "supabase/migrations/079_fixed_cost_items_and_commands.sql"
      ),
      "utf8"
    );
    expect(PKG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(PKG.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(PKG).toContain(mig.trimEnd());
    expect(PKG).not.toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.restaurant_fixed_costs /
    );
    expect(PKG).not.toContain("PROPOSAL");
  });
});

describe("all or nothing", () => {
  const before = { v: null as any };

  it("a missing prerequisite stops it before anything is created", async () => {
    const snap = await state();
    await admin.query(
      "drop policy restaurant_fixed_costs_writers_insert on public.restaurant_fixed_costs"
    );
    await expect(run(PKG)).rejects.toThrow(
      /preflight failed, prerequisites missing: .*073 writer policies/
    );
    await admin.query(
      "create policy restaurant_fixed_costs_writers_insert on public.restaurant_fixed_costs for insert with check (public.has_company_role(company_id, array['owner','admin','manager']))"
    );
    expect(await state()).toEqual(snap);
    before.v = snap;
  });

  it("a failure in the middle of the migration leaves no trace (no schema, table, column, function)", async () => {
    const broken = PKG.replace(
      "-- POSTFLIGHT",
      "SELECT 1/0; -- injected failure after the whole migration ran\n-- POSTFLIGHT"
    );
    await expect(run(broken)).rejects.toThrow(/division by zero/);
    expect(await state()).toEqual(before.v);
    expect(before.v).toMatchObject({ sch: 0, tbl: 0, col: 0, fn: 0 });
    const open = await admin.query("select txid_current_if_assigned() t");
    expect(open.rows[0].t).toBeNull(); // no transaction left open
  });

  it("a failed postflight check rolls everything back too", async () => {
    const broken = PKG.replace(
      "COMMIT;",
      "UPDATE public.restaurant_fixed_costs SET amount = amount + 1 WHERE category = 'servicios';\nCOMMIT;"
    )
      // run the corruption BEFORE postflight so the fingerprint check catches it
      .replace(
        "-- POSTFLIGHT\n-- ===========================================================================\nDO $post$",
        "-- POSTFLIGHT\n-- ===========================================================================\nUPDATE public.restaurant_fixed_costs SET amount = amount + 1 WHERE category = 'servicios';\nDO $post$"
      );
    await expect(run(broken)).rejects.toThrow(
      /existing fixed-cost rows differ/
    );
    expect(await state()).toEqual(before.v);
  });

  it("installs cleanly: legacy rows byte-identical, honest legacy totals, privileges as designed", async () => {
    await run(PKG);
    const after = await state();
    expect(after.sch).toBe(1);
    expect(after.tbl).toBe(2);
    expect(after.col).toBe(3);
    const a = await agg(admin, w.A, w.L1, "2026-10-01", "servicios");
    expect(Number(a.amount)).toBe(4800);
    expect(a.detail_state).toBe("legacy_total");
    expect(
      (
        await admin.query(
          "select count(*)::int n from public.restaurant_fixed_costs_log"
        )
      ).rows[0].n
    ).toBe(1);
    expect(
      (await admin.query("select count(*)::int n from public.fixed_cost_items"))
        .rows[0].n
    ).toBe(0);
  });

  it("running it again is refused by the preflight and changes nothing", async () => {
    const snap = await state();
    await expect(run(PKG)).rejects.toThrow(
      /preflight failed, 079 \(or part of it\) already exists/
    );
    expect(await state()).toEqual(snap);
  });

  it("after installation the commands work on the legacy data (add keeps the old total as a flagged base)", async () => {
    const d = await makeDraft(admin, w.A, [
      line("s", "Seguro", "servicios", 100, "2026-10-01", {
        kind: "restaurant",
        locationId: w.L1,
      }),
    ]);
    const p = await api.preview(c, w.manager, d);
    const key = p.keys[0].key;
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected: { [key]: p.keys[0].version },
      decisions: { s: "add" },
    });
    expect(r.status).toBe("applied");
    expect(
      Number((await agg(admin, w.A, w.L1, "2026-10-01", "servicios")).amount)
    ).toBe(4900);
    void uuid;
  });
});
