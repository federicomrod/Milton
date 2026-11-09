// Real Postgres, several real connections. Shared-key locking, stale versions,
// deterministic order, no lost updates, no double totals.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";
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

let db: TestDb;
let admin: Client;
let w: World;
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const rest = (l: string) => ({ kind: "restaurant", locationId: l }) as const;

beforeAll(async () => {
  db = await startTestDb();
  admin = await db.connect();
  w = await seedWorld(admin);
});
afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

async function fresh() {
  const co = uuid();
  const loc = uuid();
  await admin.query("insert into public.companies (id,name) values ($1,'F')", [
    co,
  ]);
  await admin.query(
    "insert into public.restaurant_locations (id,company_id,name) values ($1,$2,'R')",
    [loc, co]
  );
  await admin.query(
    "insert into public.company_memberships values ($1,$2,'manager'),($1,$3,'admin')",
    [co, w.manager, w.admin]
  );
  return { co, loc };
}
async function conn() {
  return db.connect();
}
/** Opens a request-like transaction and leaves it OPEN after running `sql`. */
async function hold(c: Client, uid: string, sql: string, args: unknown[]) {
  await c.query("BEGIN");
  await c.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(`select ${sql}`, args);
  return {
    commit: () => c.query("COMMIT"),
    rollback: () => c.query("ROLLBACK"),
  };
}
async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const r = await admin.query(
      "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'"
    );
    if (r.rows[0].n >= n) return;
    await new Promise((r2) => setTimeout(r2, 25));
  }
  throw new Error("expected a command to be waiting on a domain lock");
}
const saveSql =
  "public.fixed_cost_save_totals($1::text,$2::uuid,$3::date,$4::uuid,$5::jsonb,$6::text)";

describe("shared domain-key locking (draft locks alone would not pass)", () => {
  it("two DIFFERENT drafts on the same category serialize; the loser sees a stale version", async () => {
    const { co, loc } = await fresh();
    const c1 = await conn(),
      c2 = await conn(),
      c3 = await conn();
    try {
      const d1 = await makeDraft(admin, co, [
        line("a", "Luz", "servicios", 100, OCT, rest(loc)),
      ]);
      const d2 = await makeDraft(admin, co, [
        line("b", "Agua", "servicios", 200, OCT, rest(loc)),
      ]);
      const p1 = await api.preview(c3, w.manager, d1);
      const p2 = await api.preview(c3, w.manager, d2);
      const k = keyOf(loc, OCT, "servicios");
      expect(p1.keys[0].version).toBe(0);
      expect(p2.keys[0].version).toBe(0);
      const open = await hold(
        c1,
        w.manager,
        "public.fixed_cost_approve_upload($1::text,$2::uuid,$3::int,$4::jsonb,$5::text[],$6::jsonb,$7::text)",
        [
          uuid(),
          d1,
          p1.draft_version,
          JSON.stringify({ [k]: 0 }),
          null,
          "{}",
          "USD",
        ]
      );
      const second = api.approve(c2, w.admin, {
        draft: d2,
        dv: p2.draft_version,
        expected: { [k]: 0 },
      });
      second.catch(() => {});
      await waitForLockWaiters(1); // blocked on the SAME category key, not on the other draft
      await open.commit();
      await expect(second).rejects.toMatchObject({
        code: "FC409",
        message: "stale_version",
      });
      expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
        100
      );
      expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(
        1
      );
    } finally {
      await Promise.all([c1.end(), c2.end(), c3.end()]);
    }
  });

  it("a manual edit versus an upload on the same key: no lost update", async () => {
    const { co, loc } = await fresh();
    const c1 = await conn(),
      c2 = await conn(),
      c3 = await conn();
    try {
      const d = await makeDraft(admin, co, [
        line("a", "Luz", "servicios", 100, OCT, rest(loc)),
      ]);
      const p = await api.preview(c3, w.manager, d);
      const k = keyOf(loc, OCT, "servicios");
      const open = await hold(c1, w.admin, saveSql, [
        uuid(),
        co,
        OCT,
        loc,
        JSON.stringify([
          { category: "servicios", value: 77, expected_version: 0 },
        ]),
        "USD",
      ]);
      const up = api.approve(c2, w.manager, {
        draft: d,
        dv: p.draft_version,
        expected: { [k]: 0 },
      });
      up.catch(() => {});
      await waitForLockWaiters(1);
      await open.commit();
      await expect(up).rejects.toMatchObject({
        code: "FC409",
        message: "stale_version",
      });
      expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
        77
      );
    } finally {
      await Promise.all([c1.end(), c2.end(), c3.end()]);
    }
  });

  it("copy versus a concurrent change of the SOURCE: the copy takes one consistent committed snapshot", async () => {
    const { co, loc } = await fresh();
    const c1 = await conn(),
      c2 = await conn();
    try {
      await api.save(c1, w.manager, {
        company: co,
        month: OCT,
        loc,
        entries: [{ category: "alquiler", value: 1000, expected_version: 0 }],
      });
      const v = Number((await agg(admin, co, loc, OCT, "alquiler")).version);
      const open = await hold(c1, w.manager, saveSql, [
        uuid(),
        co,
        OCT,
        loc,
        JSON.stringify([
          {
            category: "alquiler",
            value: 1500,
            replace_items: true,
            expected_version: v,
          },
        ]),
        "USD",
      ]);
      const cp = api.copy(c2, w.manager, {
        company: co,
        loc,
        from: OCT,
        to: NOV,
        categories: ["alquiler"],
        expected: { [keyOf(loc, NOV, "alquiler")]: 0 },
      });
      cp.catch(() => {});
      await waitForLockWaiters(1); // the copy waits for the source key
      await open.commit();
      expect((await cp).status).toBe("applied");
      expect(Number((await agg(admin, co, loc, NOV, "alquiler")).amount)).toBe(
        1500
      ); // never the half-way 1000/mixed state
      const a = await agg(admin, co, loc, NOV, "alquiler");
      expect(a.copy_source.aggregate_version).toBe(
        (await agg(admin, co, loc, OCT, "alquiler")).version
      );
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});

describe("races without a held transaction", () => {
  it("concurrent creation of the same missing category: one wins, the other is stale, no unique violation", async () => {
    const { co, loc } = await fresh();
    const cs = await Promise.all([conn(), conn(), conn(), conn()]);
    try {
      const rs = await Promise.allSettled(
        cs.map((x, i) =>
          api.save(x, w.manager, {
            company: co,
            month: OCT,
            loc,
            entries: [
              { category: "otros", value: 10 + i, expected_version: 0 },
            ],
          })
        )
      );
      const ok = rs.filter((r) => r.status === "fulfilled");
      const bad = rs.filter(
        (r) => r.status === "rejected"
      ) as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(
        bad.every(
          (b) =>
            b.reason.code === "FC409" && b.reason.message === "stale_version"
        )
      ).toBe(true);
      expect(
        (
          await admin.query(
            "select count(*)::int n from public.restaurant_fixed_costs where company_id=$1",
            [co]
          )
        ).rows[0].n
      ).toBe(1);
      expect(await activeItems(admin, co, loc, OCT, "otros")).toHaveLength(1);
    } finally {
      await Promise.all(cs.map((x) => x.end()));
    }
  });

  it("multi-category commands in opposite order never deadlock", async () => {
    const { co, loc } = await fresh();
    const cs = await Promise.all([conn(), conn()]);
    try {
      for (let i = 0; i < 24; i++) {
        const month = `2027-${String((i % 12) + 1).padStart(2, "0")}-01`;
        const loc2 = i < 12 ? loc : null;
        const e = (cat: string, v: number) => ({
          category: cat,
          value: v,
          expected_version: 0,
        });
        const rs = await Promise.allSettled([
          api.save(cs[0], w.manager, {
            company: co,
            month,
            loc: loc2,
            entries: [e("servicios", 1), e("otros", 2), e("alquiler", 3)],
          }),
          api.save(cs[1], w.admin, {
            company: co,
            month,
            loc: loc2,
            entries: [e("alquiler", 4), e("otros", 5), e("servicios", 6)],
          }),
        ]);
        const codes = rs.map((r) =>
          r.status === "rejected" ? (r.reason as any).code : "ok"
        );
        expect(codes).not.toContain("40P01"); // deadlock detected
        expect(codes.filter((x) => x === "ok")).toHaveLength(1);
        expect(codes.filter((x) => x === "FC409")).toHaveLength(1);
      }
    } finally {
      await Promise.all(cs.map((x) => x.end()));
    }
  });

  it("a replace and a copy racing for the same destination key serialize with a stale loser", async () => {
    const { co, loc } = await fresh();
    const cs = await Promise.all([conn(), conn()]);
    await api.save(cs[0], w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "otros", value: 500, expected_version: 0 }],
    });
    try {
      const k = keyOf(loc, NOV, "otros");
      const rs = await Promise.allSettled([
        api.copy(cs[0], w.manager, {
          company: co,
          loc,
          from: OCT,
          to: NOV,
          categories: ["otros"],
          expected: { [k]: 0 },
        }),
        api.save(cs[1], w.admin, {
          company: co,
          month: NOV,
          loc,
          entries: [{ category: "otros", value: 9, expected_version: 0 }],
        }),
      ]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const a = await agg(admin, co, loc, NOV, "otros");
      expect([500, 9]).toContain(Number(a.amount));
      // aggregate always equals its items: the database enforces it at commit
      const s = await admin.query(
        "select coalesce(sum(amount_cents),0)::bigint n from public.fixed_cost_items where company_id=$1 and month=$2 and status='active'",
        [co, NOV]
      );
      expect(Number(s.rows[0].n)).toBe(Math.round(Number(a.amount) * 100));
    } finally {
      await Promise.all(cs.map((x) => x.end()));
    }
  });
});
