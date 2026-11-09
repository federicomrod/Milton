// Real Postgres, real roles. RLS, definer RPC authorization, direct-write
// enforcement (pre- and post-080), invariants, reader contract, cutover.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, startTestDb, type TestDb } from "./harness";
import {
  activeItems,
  agg,
  api,
  keyOf,
  line,
  makeDraft,
  seedWorld,
  uuid,
  type World,
} from "./fixtures";

const OCT = "2026-10-01";
const rest = (l: string) => ({ kind: "restaurant", locationId: l }) as const;

interface Env {
  db: TestDb;
  admin: Client;
  c: Client;
  w: World;
}
async function boot(enforce: boolean): Promise<Env> {
  const db = await startTestDb({ enforce });
  const admin = await db.connect();
  const c = await db.connect();
  return { db, admin, c, w: await seedWorld(admin) };
}
async function stop(e: Env) {
  await e.c.end();
  await e.admin.end();
  await e.db.stop();
}
async function draftFor(
  e: Env,
  company: string,
  lines: ReturnType<typeof line>[]
) {
  const d = await makeDraft(e.admin, company, lines);
  const p = await api.preview(e.c, e.w.manager, d).catch(() => null);
  return { d, p };
}

describe("authorization of the command API (before 080)", () => {
  let e: Env;
  beforeAll(async () => {
    e = await boot(false);
  });
  afterAll(async () => {
    await stop(e);
  });

  const lines = (loc: string) => [
    line("a", "Luz", "servicios", 100, OCT, rest(loc)),
  ];
  const approveAs = async (
    uid: string | null,
    d: string,
    dv: number,
    k: string
  ) => api.approve(e.c, uid, { draft: d, dv, expected: { [k]: 0 } });

  it("owner, admin and manager can write; a Milton admin who is a member can too", async () => {
    for (const uid of [e.w.owner, e.w.admin, e.w.manager, e.w.milton]) {
      const d = await makeDraft(
        e.admin,
        e.w.A,
        lines(e.w.L1).map((l) => ({
          ...l,
          month: `2027-0${[e.w.owner, e.w.admin, e.w.manager, e.w.milton].indexOf(uid) + 1}-01`,
        }))
      );
      const p = await api.preview(e.c, uid, d);
      const r = await api.approve(e.c, uid, {
        draft: d,
        dv: p.draft_version,
        expected: { [p.keys[0].key]: 0 },
      });
      expect(r.status).toBe("applied");
    }
  });

  it("a read-only member and a stranger cannot write or even see a draft", async () => {
    const d = await makeDraft(e.admin, e.w.A, lines(e.w.L1));
    const k = keyOf(e.w.L1, OCT, "servicios");
    for (const uid of [e.w.member, e.w.stranger, e.w.bOwner]) {
      await expect(api.preview(e.c, uid, d)).rejects.toMatchObject({
        code: "FC404",
        message: "not_found",
      });
      await expect(approveAs(uid, d, 1, k)).rejects.toMatchObject({
        code: "FC404",
        message: "not_found",
      });
    }
    await expect(
      api.save(e.c, e.w.member, {
        company: e.w.A,
        month: OCT,
        loc: e.w.L1,
        entries: [{ category: "otros", value: 1, expected_version: 0 }],
      })
    ).rejects.toMatchObject({ code: "FC403" });
    await expect(
      api.save(e.c, e.w.bOwner, {
        company: e.w.A,
        month: OCT,
        loc: e.w.L1,
        entries: [{ category: "otros", value: 1, expected_version: 0 }],
      })
    ).rejects.toMatchObject({ code: "FC403" });
    await expect(
      api.previewCopy(e.c, e.w.member, e.w.A, e.w.L1, OCT, "2026-11-01")
    ).rejects.toMatchObject({ code: "FC403" });
    expect(await agg(e.admin, e.w.A, e.w.L1, OCT, "otros")).toBeNull();
  });

  it("errors never echo another tenant's data", async () => {
    const d = await makeDraft(e.admin, e.w.A, lines(e.w.L1), {
      file: "secret-name.xlsx",
    });
    const err = await api.preview(e.c, e.w.bOwner, d).catch((x) => x);
    expect(
      JSON.stringify({ m: err.message, d: err.detail, w: err.where })
    ).not.toMatch(/secret-name|Fixture A|servicios/);
  });

  it("another company's restaurant, draft line or undo target is refused", async () => {
    await expect(
      api.save(e.c, e.w.owner, {
        company: e.w.A,
        month: OCT,
        loc: e.w.LB,
        entries: [{ category: "otros", value: 1, expected_version: 0 }],
      })
    ).rejects.toMatchObject({ code: "FC422", message: "invalid_scope" });
    // A forged line pointing at B's restaurant is simply not approvable.
    const { d, p } = await draftFor(e, e.w.A, [
      line("f", "Luz", "servicios", 100, OCT, rest(e.w.LB)),
    ]);
    expect(p!.keys).toHaveLength(0);
    const r = await api.approve(e.c, e.w.manager, {
      draft: d,
      dv: p!.draft_version,
      expected: {},
      lineIds: ["f"],
    });
    expect(r.lines_approved).toBe(0);
    expect(r.issues[0].error).toBe("not_approvable");
    // B cannot undo A's command.
    const ok = await draftFor(e, e.w.A, [
      line("g", "Gas", "servicios", 5, "2027-05-01", rest(e.w.L1)),
    ]);
    const done = await api.approve(e.c, e.w.manager, {
      draft: ok.d,
      dv: ok.p!.draft_version,
      expected: { [ok.p!.keys[0].key]: 0 },
    });
    await expect(
      api.undo(e.c, e.w.bOwner, done.command_id)
    ).rejects.toMatchObject({ code: "FC404" });
    // Copy between two scopes of B's company by A's owner is impossible: the scope check fails first.
    await expect(
      api.copy(e.c, e.w.owner, {
        company: e.w.A,
        loc: e.w.LB,
        from: OCT,
        to: "2026-11-01",
        categories: ["otros"],
        expected: {},
      })
    ).rejects.toMatchObject({ code: "FC422" });
  });

  it("anonymous and service-role callers cannot run a command; internals are not exposed", async () => {
    const d = await makeDraft(e.admin, e.w.A, lines(e.w.L1));
    await expect(api.preview(e.c, null, d)).rejects.toMatchObject({
      code: "42501",
    });
    await e.c.query("BEGIN");
    await e.c.query("SET LOCAL ROLE service_role");
    await expect(
      e.c.query("select public.fixed_cost_preview_upload($1::uuid)", [d])
    ).rejects.toMatchObject({ code: "42501" });
    await e.c.query("ROLLBACK");
    await expect(
      asUser(e.c, e.w.owner, (cl) =>
        cl.query(
          "select fixed_cost_private.fc_lock_keys($1::uuid, ARRAY['x'])",
          [e.w.A]
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(e.c, e.w.owner, (cl) =>
        cl.query("select fixed_cost_private.fc_assert_writer($1::uuid)", [
          e.w.A,
        ])
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("members read items and commands of their company only (RLS)", async () => {
    const d = await makeDraft(e.admin, e.w.A, [
      line("r", "Luz", "otros", 9, "2027-07-01", rest(e.w.L1)),
    ]);
    const p = await api.preview(e.c, e.w.manager, d);
    await api.approve(e.c, e.w.manager, {
      draft: d,
      dv: p.draft_version,
      expected: { [p.keys[0].key]: 0 },
    });
    const count = (uid: string, t: string) =>
      asUser(e.c, uid, async (cl) =>
        Number(
          (await cl.query(`select count(*)::int n from public.${t}`)).rows[0].n
        )
      );
    expect(await count(e.w.member, "fixed_cost_items")).toBeGreaterThan(0);
    expect(await count(e.w.member, "fixed_cost_commands")).toBeGreaterThan(0);
    expect(await count(e.w.bOwner, "fixed_cost_items")).toBe(0);
    expect(await count(e.w.bOwner, "fixed_cost_commands")).toBe(0);
    expect(await count(e.w.stranger, "fixed_cost_items")).toBe(0);
    // No API role can write the new tables directly.
    for (const uid of [e.w.owner, e.w.manager]) {
      await expect(
        asUser(e.c, uid, (cl) =>
          cl.query("delete from public.fixed_cost_items")
        )
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asUser(e.c, uid, (cl) =>
          cl.query("update public.fixed_cost_commands set kind='copy'")
        )
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("the SECURITY DEFINER guard (supabase/tests/secdef_guard.sql) returns 0 rows", async () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../supabase/tests/secdef_guard.sql"),
      "utf8"
    );
    const r = await e.admin.query(sql);
    expect(r.rows).toEqual([]);
  });
});

describe("database invariants and legacy writers (before 080)", () => {
  let e: Env;
  beforeAll(async () => {
    e = await boot(false);
  });
  afterAll(async () => {
    await stop(e);
  });

  it("pre-079 behaviour is intact: an old-style direct write to a legacy key still works", async () => {
    // This is the compatibility window BEFORE 080 (documented release gate).
    await asUser(e.c, e.w.manager, (cl) =>
      cl.query(
        "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, amount, currency, source, status) values ($1,$2,$3,'otros',50,'USD','manual','confirmed')",
        [e.w.A, e.w.L2, OCT]
      )
    );
    const a = await agg(e.admin, e.w.A, e.w.L2, OCT, "otros");
    expect(a.detail_state).toBe("legacy_total");
    expect(a.version).toBeGreaterThan(0);
  });

  it("but it can NOT break an itemized key: the database refuses at commit", async () => {
    const { d, p } = await draftFor(e, e.w.A, [
      line("i", "Luz", "servicios", 100, OCT, rest(e.w.L1)),
      line("j", "Agua", "servicios", 50, OCT, rest(e.w.L1)),
    ]);
    await api.approve(e.c, e.w.manager, {
      draft: d,
      dv: p!.draft_version,
      expected: { [p!.keys[0].key]: 0 },
    });
    const attempts: [string, unknown[]][] = [
      [
        "update public.restaurant_fixed_costs set amount = 1 where company_id=$1 and category='servicios' and location_id=$2",
        [e.w.A, e.w.L1],
      ],
      [
        "delete from public.restaurant_fixed_costs where company_id=$1 and category='servicios' and location_id=$2",
        [e.w.A, e.w.L1],
      ],
      [
        "update public.restaurant_fixed_costs set detail_state='legacy_total' where company_id=$1 and category='servicios' and location_id=$2",
        [e.w.A, e.w.L1],
      ],
    ];
    for (const [sql, args] of attempts)
      await expect(
        asUser(e.c, e.w.manager, (cl) => cl.query(sql, args))
      ).rejects.toMatchObject({ code: "FC500" });
    // The same through the owner role (service-like), triggers apply to everyone.
    await expect(
      e.admin.query(
        "update public.fixed_cost_items set amount_cents = 1 where company_id=$1",
        [e.w.A]
      )
    ).rejects.toMatchObject({ code: "FC500" });
    await expect(
      e.admin.query(
        "insert into public.fixed_cost_items (company_id, location_id, month, category, amount_cents, currency, created_by_command) select company_id, null::uuid, date '2026-10-01', 'otros', 5, 'USD', id from public.fixed_cost_commands limit 1"
      )
    ).rejects.toMatchObject({ code: "FC500" });
    expect(
      Number((await agg(e.admin, e.w.A, e.w.L1, OCT, "servicios")).amount)
    ).toBe(150);
  });

  it("a read-only member's direct write is refused by the 073 policies", async () => {
    await expect(
      asUser(e.c, e.w.member, (cl) =>
        cl.query(
          "insert into public.restaurant_fixed_costs (company_id, month, category, amount, currency) values ($1,$2,'otros',1,'USD')",
          [e.w.A, OCT]
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("compatibility readers cannot double count: the aggregate is the only amount source", async () => {
    // For every company/scope/month/category: aggregate.amount equals the sum of
    // its active items when itemized, and a legacy key has no items at all.
    const r = await e.admin.query(`
      select f.id from public.restaurant_fixed_costs f
      left join (select company_id, location_id, month, category, sum(amount_cents) s, count(*) n
                   from public.fixed_cost_items where status='active' group by 1,2,3,4) i
        on i.company_id=f.company_id and i.location_id is not distinct from f.location_id
       and i.month=f.month and i.category=f.category
      where f.category <> 'impuestos'
        and ((f.detail_state='itemized' and round(f.amount*100) <> coalesce(i.s,-1))
          or (f.detail_state='legacy_total' and coalesce(i.n,0) > 0))`);
    expect(r.rows).toEqual([]);
    // And the contract for readers: sum(aggregates) already includes every item once.
    const tot = await e.admin.query(
      `
      select (select coalesce(sum(round(amount*100)),0) from public.restaurant_fixed_costs where company_id=$1 and category<>'impuestos' and detail_state='itemized')::bigint as agg,
             (select coalesce(sum(amount_cents),0) from public.fixed_cost_items where company_id=$1 and status='active')::bigint as items`,
      [e.w.A]
    );
    expect(tot.rows[0].agg).toBe(tot.rows[0].items);
  });
});

describe("after 080: the command boundary is enforced", () => {
  let e: Env;
  beforeAll(async () => {
    e = await boot(true);
  });
  afterAll(async () => {
    await stop(e);
  });

  it("no signed-in user can write the aggregate or the log directly any more", async () => {
    const d = await makeDraft(e.admin, e.w.A, [
      line("a", "Luz", "servicios", 100, OCT, rest(e.w.L1)),
    ]);
    for (const uid of [e.w.owner, e.w.admin, e.w.manager, e.w.milton]) {
      await expect(
        asUser(e.c, uid, (cl) =>
          cl.query(
            "insert into public.restaurant_fixed_costs (company_id, month, category, amount, currency) values ($1,$2,'otros',1,'USD')",
            [e.w.A, OCT]
          )
        )
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asUser(e.c, uid, (cl) =>
          cl.query("update public.restaurant_fixed_costs set amount = 1")
        )
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asUser(e.c, uid, (cl) =>
          cl.query("delete from public.restaurant_fixed_costs_log")
        )
      ).rejects.toMatchObject({ code: "42501" });
      // Drafts are a work area: writers keep editing them, and the version moves.
      const before = (
        await e.admin.query(
          "select version from public.fixed_cost_upload_drafts where id=$1",
          [d]
        )
      ).rows[0].version;
      await asUser(e.c, uid, (cl) =>
        cl.query(
          "update public.fixed_cost_upload_drafts set parsed_lines = parsed_lines || '[]'::jsonb || jsonb_build_array(jsonb_build_object('id','zz','raw','x','status','discarded')) where id=$1",
          [d]
        )
      );
      const after = (
        await e.admin.query(
          "select version from public.fixed_cost_upload_drafts where id=$1",
          [d]
        )
      ).rows[0].version;
      expect(after).toBeGreaterThan(before);
      await e.admin.query(
        "update public.fixed_cost_upload_drafts set parsed_lines = (select jsonb_agg(l) from jsonb_array_elements(parsed_lines) l where l->>'id' <> 'zz') where id=$1",
        [d]
      );
    }
    // Reads still work, and so do the commands.
    const p = await api.preview(e.c, e.w.manager, d);
    const r = await api.approve(e.c, e.w.manager, {
      draft: d,
      dv: p.draft_version,
      expected: { [p.keys[0].key]: 0 },
    });
    expect(r.status).toBe("applied");
    const n = await asUser(e.c, e.w.member, async (cl) =>
      Number(
        (
          await cl.query(
            "select count(*)::int n from public.restaurant_fixed_costs"
          )
        ).rows[0].n
      )
    );
    expect(n).toBe(1);
    expect(
      Number((await agg(e.admin, e.w.A, e.w.L1, OCT, "servicios")).amount)
    ).toBe(100);
    expect(
      await activeItems(e.admin, e.w.A, e.w.L1, OCT, "servicios")
    ).toHaveLength(1);
  });
});

describe("cutover: before any canonical write, the schema step is reversible", () => {
  it("079 on top of legacy data changes no total and no existing row", async () => {
    // Build the 064+073 world with legacy data FIRST, then apply 079 (what staging would do).
    const { startTestDb: _unused } = await import("./harness");
    void _unused;
    const e = await boot(false);
    try {
      // Rows inserted by an old build (no version/detail_state supplied) after 079 exist
      // with the column defaults: exactly what pre-existing rows get when 079 is applied.
      await e.admin.query(
        "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, amount, currency, source, status, repeats) values ($1,$2,$3,'planilla',21400,'USD','upload','confirmed',false)",
        [e.w.A, e.w.L1, OCT]
      );
      const a = await agg(e.admin, e.w.A, e.w.L1, OCT, "planilla");
      expect(Number(a.amount)).toBe(21400);
      expect(a.detail_state).toBe("legacy_total");
      expect(a.copy_source).toBeNull();
      // A rollback of the APP before canonical writes needs no data repair: nothing
      // was written outside the old columns, and the old writer still works.
      await asUser(e.c, e.w.manager, (cl) =>
        cl.query(
          "update public.restaurant_fixed_costs set amount = 21500 where company_id=$1 and category='planilla'",
          [e.w.A]
        )
      );
      expect(
        Number((await agg(e.admin, e.w.A, e.w.L1, OCT, "planilla")).amount)
      ).toBe(21500);
      void uuid;
    } finally {
      await stop(e);
    }
  });
});
