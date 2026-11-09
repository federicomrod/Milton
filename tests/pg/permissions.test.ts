// Effective privileges under STAGING-LIKE DEFAULTS (tests/pg/bootstrap.sql grants
// new tables, sequences and functions to anon/authenticated/service_role the way
// the hosted preflight showed). Real local Postgres only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { asUser, startTestDb, type TestDb } from "./harness";
import {
  agg,
  api,
  line,
  makeDraft,
  seedWorld,
  uuid,
  type World,
} from "./fixtures";

let db: TestDb;
let admin: Client;
let c: Client;
let w: World;
beforeAll(async () => {
  db = await startTestDb({ enforce: true });
  admin = await db.connect();
  c = await db.connect();
  w = await seedWorld(admin);
});
afterAll(async () => {
  await c?.end();
  await admin?.end();
  await db?.stop();
});

const ROLES = ["anon", "authenticated", "service_role"] as const;
const SEQS = async () => {
  const id = (
    await admin.query(
      "select pg_get_serial_sequence('public.fixed_cost_items','seq') as s"
    )
  ).rows[0].s as string;
  return ["fixed_cost_private.fixed_cost_version_seq", id];
};

describe("sequences: no API role can read, advance or reset a version counter", () => {
  it("the staging-like default really would have granted them (the harness is not vacuous)", async () => {
    await admin.query("create sequence public.__probe_seq");
    const r = await admin.query(
      "select has_sequence_privilege('authenticated','public.__probe_seq','UPDATE') u, has_sequence_privilege('anon','public.__probe_seq','USAGE') n"
    );
    expect(r.rows[0]).toEqual({ u: true, n: true });
    await admin.query("drop sequence public.__probe_seq");
  });

  it.each(ROLES)("%s has no privilege on either new sequence", async (role) => {
    for (const seq of await SEQS())
      for (const priv of ["USAGE", "SELECT", "UPDATE"]) {
        const r = await admin.query(
          "select has_sequence_privilege($1,$2,$3) as ok",
          [role, seq, priv]
        );
        expect(r.rows[0].ok, `${role} ${priv} ${seq}`).toBe(false);
      }
  });

  it("a signed-in user cannot nextval or setval them (permission denied)", async () => {
    for (const seq of await SEQS()) {
      await expect(
        asUser(c, w.owner, (cl) => cl.query(`select nextval('${seq}')`))
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asUser(c, w.owner, (cl) => cl.query(`select setval('${seq}', 1)`))
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("the commands still work: the owner-run code uses the sequences", async () => {
    const co = uuid();
    const loc = uuid();
    await admin.query(
      "insert into public.companies (id,name) values ($1,'F')",
      [co]
    );
    await admin.query(
      "insert into public.restaurant_locations (id,company_id,name) values ($1,$2,'R')",
      [loc, co]
    );
    await admin.query(
      "insert into public.company_memberships values ($1,$2,'manager')",
      [co, w.manager]
    );
    const d = await makeDraft(admin, co, [
      line("a", "Luz", "servicios", 10, "2026-10-01", {
        kind: "restaurant",
        locationId: loc,
      }),
    ]);
    const p = await api.preview(c, w.manager, d);
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected: { [p.keys[0].key]: 0 },
    });
    expect(r.status).toBe("applied");
    expect(
      Number((await agg(admin, co, loc, "2026-10-01", "servicios")).version)
    ).toBeGreaterThanOrEqual(1000);
  });
});

describe("new tables and functions: only what is intended", () => {
  it("fixed_cost_items and fixed_cost_commands: anon nothing; authenticated SELECT only", async () => {
    for (const t of ["public.fixed_cost_items", "public.fixed_cost_commands"])
      for (const priv of [
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          const r = await admin.query(
            "select has_table_privilege($1,$2,$3) ok",
            [role, t, priv]
          );
          expect(r.rows[0].ok, `${role} ${priv} ${t}`).toBe(false);
        }
      }
    const sel = await admin.query(
      "select has_table_privilege('authenticated','public.fixed_cost_items','SELECT') a, has_table_privilege('anon','public.fixed_cost_items','SELECT') b"
    );
    expect(sel.rows[0]).toEqual({ a: true, b: false });
  });

  it("no SECURITY DEFINER function exists in the API schema; the privileged code is in the private schema", async () => {
    const pub = await admin.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (proname like 'fixed\\_cost\\_%' or proname like 'fc\\_%')"
    );
    expect(pub.rows).toEqual([]);
    const wrappers = await admin.query(
      "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'fixed\\_cost\\_%' and not prosecdef"
    );
    expect(wrappers.rows[0].n).toBe(7);
    const priv = await admin.query(
      "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fixed_cost_private' and prosecdef"
    );
    expect(priv.rows[0].n).toBeGreaterThan(7);
  });

  it("only authenticated has any access to the private schema; helpers are unreachable even to it", async () => {
    const s = await admin.query(
      "select has_schema_privilege('anon','fixed_cost_private','USAGE') a, has_schema_privilege('service_role','fixed_cost_private','USAGE') s, has_schema_privilege('authenticated','fixed_cost_private','USAGE') u"
    );
    expect(s.rows[0]).toEqual({ a: false, s: false, u: true });
    const exec = await admin.query(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='fixed_cost_private' and p.proname like 'fc\\_%'`);
    expect(exec.rows.length).toBeGreaterThan(10);
    expect(exec.rows.filter((r) => r.ok)).toEqual([]);
    await expect(
      asUser(c, null, (cl) =>
        cl.query(
          "select fixed_cost_private.fixed_cost_undo('x', gen_random_uuid())"
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a wrapper runs as the CALLER (invoker), so another user's identity cannot be borrowed", async () => {
    const r = await admin.query(
      "select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = 'fixed_cost_undo'"
    );
    expect(r.rows).toEqual([{ proname: "fixed_cost_undo", prosecdef: false }]);
  });
});

describe("event-trigger functions are not callable RPCs (guard classification)", () => {
  it("PostgreSQL refuses a direct call, and the guard does not flag it", async () => {
    await admin.query(`
      create function public.__evt() returns event_trigger language plpgsql security definer as $$ begin end $$;`);
    await expect(
      asUser(c, w.owner, (cl) => cl.query("select public.__evt()"))
    ).rejects.toThrow(/event trigger|trigger/i);
    const guard = fs.readFileSync(
      path.resolve(__dirname, "../../supabase/tests/secdef_guard.sql"),
      "utf8"
    );
    const rows = (await admin.query(guard)).rows;
    expect(rows.map((r) => r.func_name)).not.toContain("__evt");
    await admin.query("drop function public.__evt()");
  });
});

describe("existing-table ACL gap (found live) and the separate proposal", () => {
  it("KNOWN GAP after 080 alone: TRUNCATE and friends stay with anon/authenticated", async () => {
    for (const role of ["anon", "authenticated"])
      for (const t of [
        "restaurant_fixed_costs",
        "restaurant_fixed_costs_log",
      ]) {
        const r = await admin.query(
          "select has_table_privilege($1,$2,'TRUNCATE') ok",
          [role, `public.${t}`]
        );
        expect(r.rows[0].ok, `${role} ${t}`).toBe(true);
      }
  });

  it("the proposal closes it, keeps reads, keeps draft work and keeps every command working", async () => {
    await admin.query(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../supabase/proposals/081_existing_fixed_cost_table_acl.PROPOSAL.sql"
        ),
        "utf8"
      )
    );
    for (const t of [
      "restaurant_fixed_costs",
      "restaurant_fixed_costs_log",
      "fixed_cost_upload_drafts",
    ])
      for (const priv of ["TRUNCATE", "TRIGGER", "REFERENCES"])
        for (const role of ["anon", "authenticated"]) {
          const r = await admin.query(
            "select has_table_privilege($1,$2,$3) ok",
            [role, `public.${t}`, priv]
          );
          expect(r.rows[0].ok, `${role} ${priv} ${t}`).toBe(false);
        }
    const anon = await admin.query(
      "select has_table_privilege('anon','public.restaurant_fixed_costs','SELECT') ok"
    );
    expect(anon.rows[0].ok).toBe(false);
    const read = await asUser(
      c,
      w.member,
      async (cl) =>
        (
          await cl.query(
            "select count(*)::int n from public.restaurant_fixed_costs"
          )
        ).rows[0].n
    );
    expect(read).toBeGreaterThanOrEqual(0);
    // draft work still works for a writer; commands still work
    const co = uuid();
    const loc = uuid();
    await admin.query(
      "insert into public.companies (id,name) values ($1,'F')",
      [co]
    );
    await admin.query(
      "insert into public.restaurant_locations (id,company_id,name) values ($1,$2,'R')",
      [loc, co]
    );
    await admin.query(
      "insert into public.company_memberships values ($1,$2,'manager')",
      [co, w.manager]
    );
    const d = await makeDraft(admin, co, [
      line("a", "Luz", "servicios", 10, "2026-10-01", {
        kind: "restaurant",
        locationId: loc,
      }),
    ]);
    await asUser(c, w.manager, (cl) =>
      cl.query(
        "update public.fixed_cost_upload_drafts set file_name='renamed.xlsx' where id=$1",
        [d]
      )
    );
    const p = await api.preview(c, w.manager, d);
    expect(
      (
        await api.approve(c, w.manager, {
          draft: d,
          dv: p.draft_version,
          expected: { [p.keys[0].key]: 0 },
        })
      ).status
    ).toBe("applied");
    await expect(
      asUser(c, w.manager, (cl) =>
        cl.query("truncate public.restaurant_fixed_costs")
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});
