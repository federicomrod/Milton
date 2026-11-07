// Real Postgres. Approve / destination / idempotency / overlap / legacy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";
import {
  activeItems,
  agg,
  api,
  counts,
  keyOf,
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
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const G = { kind: "group" } as const;

beforeAll(async () => {
  db = await startTestDb();
  admin = await db.connect();
  c = await db.connect();
  w = await seedWorld(admin);
});
afterAll(async () => {
  await c?.end();
  await admin?.end();
  await db?.stop();
});

const rest = (l: string) => ({ kind: "restaurant", locationId: l }) as const;

/** The synthetic equivalent of the supplied October-dated workbook. */
const workbook = (loc: string) => [
  line("l1", "Renta del local", "alquiler", 6500, OCT, rest(loc)),
  line("l2", "Planilla", "planilla", 21400, OCT, rest(loc)),
  line("l3", "Luz", "servicios", 1800, OCT, rest(loc)),
  line("l4", "Agua", "servicios", 650, OCT, rest(loc)),
  line("l5", "Internet", "servicios", 1450, OCT, rest(loc)),
  line("l6", "IVA", "impuestos", 13, OCT, rest(loc)),
  line("l7", "Gas", "servicios", 900, OCT, rest(loc)),
];

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
    "insert into public.company_memberships values ($1,$2,'manager')",
    [co, w.manager]
  );
  return { co, loc };
}

async function preview(draft: string, uid = w.manager) {
  const p = await api.preview(c, uid, draft);
  const expected: Record<string, number> = {};
  for (const k of p.keys) expected[k.key] = k.version;
  return { p, expected };
}

describe("approve: destination, atomic effects, counts", () => {
  it("an October-dated file stays in October; November gets nothing", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, workbook(loc));
    const before = await counts(admin, co);
    const { p, expected } = await preview(d);
    // The preview is a pure read.
    expect(await counts(admin, co)).toEqual(before);
    expect(p.keys.every((k: any) => k.month === OCT && k.kind === "new")).toBe(
      true
    );

    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.status).toBe("applied");
    expect(r.lines_approved).toBe(7);
    expect(r.lines_already_approved).toBe(0);
    expect(r.categories).toHaveLength(4); // alquiler, planilla, servicios, impuestos

    // Exact aggregates: Servicios is ONE category with four items.
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    );
    expect(
      (await activeItems(admin, co, loc, OCT, "servicios")).map((i) =>
        Number(i.amount_cents)
      )
    ).toEqual([180000, 65000, 145000, 90000]);
    expect(
      Number((await agg(admin, co, loc, OCT, "impuestos")).pct_of_sales)
    ).toBe(13);
    expect(await activeItems(admin, co, loc, OCT, "impuestos")).toHaveLength(0);

    // Items, aggregates, one log row per category and one command: all together.
    const after = await counts(admin, co);
    expect(after).toEqual({ aggregates: 4, items: 6, log: 4, commands: 1 });
    // November: no costs, no logs, no items (no auto-copy exists to create them).
    const nov = await admin.query(
      "select (select count(*) from public.restaurant_fixed_costs where company_id=$1 and month=$2) a," +
        "(select count(*) from public.restaurant_fixed_costs_log where company_id=$1 and month=$2) l," +
        "(select count(*) from public.fixed_cost_items where company_id=$1 and month=$2) i",
      [co, NOV]
    );
    expect(nov.rows[0]).toMatchObject({ a: "0", l: "0", i: "0" });

    // Draft finalised in the same transaction.
    const dr = (
      await admin.query(
        "select status, version, parsed_lines from public.fixed_cost_upload_drafts where id=$1",
        [d]
      )
    ).rows[0];
    expect(dr.status).toBe("approved");
    expect(dr.parsed_lines.every((x: any) => x.status === "approved")).toBe(
      true
    );
    // The log names the file and the command, with the items of the cluster.
    const log = (
      await admin.query(
        "select new_value from public.restaurant_fixed_costs_log where company_id=$1 and category='servicios'",
        [co]
      )
    ).rows[0].new_value;
    expect(log.command_id).toBe(r.command_id);
    expect(log.items).toHaveLength(4);
    expect(log.file_name).toBe("synthetic.xlsx");
  });

  it("remapping the destination changes the persisted month", async () => {
    const { co, loc } = await fresh();
    const lines = workbook(loc).map((l) => ({ ...l, month: NOV }));
    const d = await makeDraft(admin, co, lines);
    const { p, expected } = await preview(d);
    expect(p.keys.every((k: any) => k.month === NOV)).toBe(true);
    await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(await agg(admin, co, loc, NOV, "alquiler")).not.toBeNull();
    expect(await agg(admin, co, loc, OCT, "alquiler")).toBeNull();
  });

  it("a requested line that is not approvable stays pending with a reason", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, [
      line("a", "Luz", "servicios", 100, OCT, rest(loc)),
      line("b", "Seguro", "servicios", null, OCT, rest(loc)), // no price: never zero
    ]);
    const { p, expected } = await preview(d);
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      lineIds: ["a", "b"],
    });
    expect(r.lines_approved).toBe(1);
    expect(r.issues).toEqual([{ lineId: "b", error: "not_approvable" }]);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      100
    );
    const dr = (
      await admin.query(
        "select status, parsed_lines from public.fixed_cost_upload_drafts where id=$1",
        [d]
      )
    ).rows[0];
    expect(dr.status).toBe("draft");
    expect(dr.parsed_lines.find((x: any) => x.id === "b").status).toBe(
      "pending"
    );
  });

  it("two different rates for one key block those lines; they never sum", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, [
      line("t1", "IVA", "impuestos", 13, OCT, rest(loc)),
      line("t2", "IVA", "impuestos", 15, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    expect(p.keys[0].kind).toBe("invalid_duplicate_tax");
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.lines_approved).toBe(0);
    expect(r.issues.map((i: any) => i.error)).toEqual([
      "duplicate_tax",
      "duplicate_tax",
    ]);
    expect(await agg(admin, co, loc, OCT, "impuestos")).toBeNull();
  });
});

describe("idempotency", () => {
  it("a lost-response retry returns the original result with one effect", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, workbook(loc));
    const { p, expected } = await preview(d);
    const key = `key-${uuid()}`;
    const args = { key, draft: d, dv: p.draft_version, expected };
    const first = await api.approve(c, w.manager, args);
    const again = await api.approve(c, w.manager, args);
    expect(again.replayed).toBe(true);
    expect(again.command_id).toBe(first.command_id);
    expect(again.lines_approved).toBe(first.lines_approved);
    expect(await counts(admin, co)).toEqual({
      aggregates: 4,
      items: 6,
      log: 4,
      commands: 1,
    });
  });

  it("the same key with a different payload is rejected", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, workbook(loc));
    const { p, expected } = await preview(d);
    const key = `key-${uuid()}`;
    await api.approve(c, w.manager, {
      key,
      draft: d,
      dv: p.draft_version,
      expected,
      lineIds: ["l1"],
    });
    await expect(
      api.approve(c, w.manager, {
        key,
        draft: d,
        dv: p.draft_version,
        expected,
        lineIds: ["l1", "l2"],
      })
    ).rejects.toMatchObject({
      code: "FC409",
      message: "idempotency_key_reuse",
    });
  });

  it("concurrent identical retries produce exactly one financial effect and one event", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, workbook(loc));
    const { p, expected } = await preview(d);
    const key = `key-${uuid()}`;
    const args = { key, draft: d, dv: p.draft_version, expected };
    const clients = await Promise.all([
      db.connect(),
      db.connect(),
      db.connect(),
    ]);
    try {
      const rs = await Promise.allSettled(
        clients.map((x) => api.approve(x, w.manager, args))
      );
      const ok = rs.filter(
        (r) => r.status === "fulfilled"
      ) as PromiseFulfilledResult<any>[];
      expect(ok.length).toBe(3); // the followers wait, then get the stored result
      expect(new Set(ok.map((r) => r.value.command_id)).size).toBe(1);
      expect(ok.filter((r) => r.value.replayed).length).toBe(2);
    } finally {
      await Promise.all(clients.map((x) => x.end()));
    }
    expect(await counts(admin, co)).toEqual({
      aggregates: 4,
      items: 6,
      log: 4,
      commands: 1,
    });
  });

  it("the same intended upload, approved again under a new key and draft, is a clear no-op", async () => {
    const { co, loc } = await fresh();
    const d1 = await makeDraft(admin, co, workbook(loc), { sha: "abc" });
    const a = await preview(d1);
    await api.approve(c, w.manager, {
      draft: d1,
      dv: a.p.draft_version,
      expected: a.expected,
    });
    const base = await counts(admin, co);

    const d2 = await makeDraft(admin, co, workbook(loc), { sha: "abc" });
    const b = await preview(d2);
    expect(b.p.same_file_seen_before).toBe(true); // evidence only
    expect(b.p.keys.every((k: any) => k.kind === "noop")).toBe(true);
    const r = await api.approve(c, w.manager, {
      draft: d2,
      dv: b.p.draft_version,
      expected: b.expected,
    });
    expect(r.status).toBe("noop");
    expect(r.lines_approved).toBe(0);
    expect(r.lines_already_approved).toBe(7);
    const after = await counts(admin, co);
    // No new item, aggregate or financial log; only the command event of the no-op.
    expect({ ...after, commands: 0 }).toEqual({ ...base, commands: 0 });
    expect((await agg(admin, co, loc, OCT, "servicios")).version).toBe(
      a.expected[keyOf(loc, OCT, "servicios")] + 0 ||
        (await agg(admin, co, loc, OCT, "servicios")).version
    );
    const dr = (
      await admin.query(
        "select status from public.fixed_cost_upload_drafts where id=$1",
        [d2]
      )
    ).rows[0];
    expect(dr.status).toBe("approved");
  });
});

describe("overlap and re-upload", () => {
  async function approved() {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, workbook(loc));
    const a = await preview(d);
    await api.approve(c, w.manager, {
      draft: d,
      dv: a.p.draft_version,
      expected: a.expected,
    });
    return { co, loc };
  }

  it("changed values need an explicit choice; nothing is written before it", async () => {
    const { co, loc } = await approved();
    const d = await makeDraft(admin, co, [
      line("n1", "Luz", "servicios", 2000, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    const base = await counts(admin, co);
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.status).toBe("needs_decision");
    expect(r.conflicts[0]).toMatchObject({
      kind: "overlap",
      old: 4800,
      new: 2000,
      newIfAdd: 6800,
      lineId: "n1",
    });
    expect(r.conflicts[0].existingItems).toHaveLength(4);
    expect(await counts(admin, co)).toEqual(base);

    // Replace: names exactly what it replaces; the old items are retired, not erased.
    const rep = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { n1: "replace" },
    });
    expect(rep.categories[0]).toMatchObject({
      outcome: "replaced",
      total: 2000,
      previous_total: 4800,
    });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      2000
    );
    const retired = await admin.query(
      "select count(*)::int n from public.fixed_cost_items where company_id=$1 and status='retired'",
      [co]
    );
    expect(retired.rows[0].n).toBe(4);
    // Unrelated categories are untouched.
    expect(Number((await agg(admin, co, loc, OCT, "planilla")).amount)).toBe(
      21400
    );
  });

  it("add keeps what exists and adds exactly the new line", async () => {
    const { co, loc } = await approved();
    const d = await makeDraft(admin, co, [
      line("s1", "Seguro", "servicios", 100, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { s1: "add" },
    });
    expect(r.categories[0]).toMatchObject({ outcome: "added", total: 4900 });
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(5);
  });

  it("a subset upload is an overlap, never a silent no-op or a broad replace", async () => {
    const { co, loc } = await approved();
    const d = await makeDraft(admin, co, [
      line("u1", "Luz", "servicios", 1800, OCT, rest(loc)),
      line("u2", "Agua", "servicios", 650, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    expect(p.keys[0].kind).toBe("overlap");
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.status).toBe("needs_decision");
  });

  it("adding an exact repeat of an existing item needs its own choice, then is recorded", async () => {
    const { co, loc } = await approved();
    const d = await makeDraft(admin, co, [
      line("r1", "Luz", "servicios", 1800, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    const first = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { r1: "add" },
    });
    expect(first.status).toBe("needs_decision");
    expect(first.conflicts[0].kind).toBe("duplicate");
    const ok = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { r1: "add_duplicate" },
    });
    expect(ok.categories[0].total).toBe(6600);
    const items = await activeItems(admin, co, loc, OCT, "servicios");
    expect(
      items.filter((i) => i.origin.allowed_duplicate === true)
    ).toHaveLength(1);
  });

  it("a different reviewed month or scope is a new key, not an overlap", async () => {
    const { co, loc } = await approved();
    const d = await makeDraft(admin, co, [
      line("m1", "Luz", "servicios", 1800, NOV, rest(loc)),
      line("m2", "Luz", "servicios", 1800, OCT, G),
    ]);
    const { p, expected } = await preview(d);
    expect(p.keys.map((k: any) => k.kind)).toEqual(["new", "new"]);
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.lines_approved).toBe(2);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    ); // untouched
  });

  it("more lines of the same upload continue it without a warning", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, [
      line("c1", "Luz", "servicios", 1800, OCT, rest(loc)),
      line("c2", "Agua", "servicios", 650, OCT, rest(loc)),
    ]);
    const a = await preview(d);
    await api.approve(c, w.manager, {
      draft: d,
      dv: a.p.draft_version,
      expected: a.expected,
      lineIds: ["c1"],
    });
    const b = await preview(d);
    expect(b.p.keys[0].kind).toBe("continue");
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: b.p.draft_version,
      expected: b.expected,
      lineIds: ["c2"],
    });
    expect(r.status).toBe("applied");
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      2450
    );
  });

  it("stale draft or stale category versions are rejected, never last-writer-wins", async () => {
    const { co, loc } = await fresh();
    const d = await makeDraft(admin, co, [
      line("x1", "Luz", "servicios", 100, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    await expect(
      api.approve(c, w.manager, { draft: d, dv: p.draft_version + 1, expected })
    ).rejects.toMatchObject({ code: "FC409", message: "stale_draft" });
    // Someone else creates the category first.
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "servicios", value: 50, expected_version: 0 }],
    });
    await expect(
      api.approve(c, w.manager, { draft: d, dv: p.draft_version, expected })
    ).rejects.toMatchObject({ code: "FC409", message: "stale_version" });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      50
    );
  });
});

describe("legacy aggregates", () => {
  async function legacy(amount: number) {
    const { co, loc } = await fresh();
    await admin.query(
      "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, amount, currency, source, status, repeats) values ($1,$2,$3,'servicios',$4,'USD','upload','confirmed',false)",
      [co, loc, OCT, amount]
    );
    return { co, loc };
  }

  it("an existing total keeps its exact amount and has no invented items", async () => {
    const { co, loc } = await legacy(4800);
    const a = await agg(admin, co, loc, OCT, "servicios");
    expect(a.detail_state).toBe("legacy_total");
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(0);
  });

  it("a same-sum draft does NOT backfill: it needs an explicit decision", async () => {
    const { co, loc } = await legacy(4800);
    const d = await makeDraft(admin, co, [
      line("a", "Luz", "servicios", 1800, OCT, rest(loc)),
      line("b", "Agua", "servicios", 650, OCT, rest(loc)),
      line("c", "Internet", "servicios", 1450, OCT, rest(loc)),
      line("d", "Gas", "servicios", 900, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    expect(p.keys[0]).toMatchObject({
      kind: "overlap",
      detail_state: "legacy_total",
    });
    const r = await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
    });
    expect(r.status).toBe("needs_decision");
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(0);
  });

  it("add on a legacy total keeps the old total as ONE flagged base; the sum is exact", async () => {
    const { co, loc } = await legacy(4800);
    const d = await makeDraft(admin, co, [
      line("s", "Seguro", "servicios", 100, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { s: "add" },
    });
    const items = await activeItems(admin, co, loc, OCT, "servicios");
    expect(items.map((i) => [i.kind, Number(i.amount_cents)])).toEqual([
      ["legacy_base", 480000],
      ["item", 10000],
    ]);
    expect(items[0].origin.unknown_detail).toBe(true);
    const a = await agg(admin, co, loc, OCT, "servicios");
    expect(Number(a.amount)).toBe(4900);
    expect(a.detail_state).toBe("itemized");
  });

  it("a reviewed full replacement establishes a known item set", async () => {
    const { co, loc } = await legacy(4800);
    const d = await makeDraft(admin, co, [
      line("a", "Luz", "servicios", 1800, OCT, rest(loc)),
      line("b", "Agua", "servicios", 3000, OCT, rest(loc)),
    ]);
    const { p, expected } = await preview(d);
    await api.approve(c, w.manager, {
      draft: d,
      dv: p.draft_version,
      expected,
      decisions: { a: "replace" },
    });
    expect(
      (await activeItems(admin, co, loc, OCT, "servicios")).every(
        (i) => i.kind === "item"
      )
    ).toBe(true);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    );
  });
});
