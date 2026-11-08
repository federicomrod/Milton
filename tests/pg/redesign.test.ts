// Real Postgres. What the desktop redesign relies on, and where the database
// stops short of the product requirement (the GAP tests state the current
// behaviour exactly so the gap is executable, not a claim).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";
import {
  activeItems,
  agg,
  api,
  counts,
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
const rest = (l: string) => ({ kind: "restaurant", locationId: l }) as const;

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

const october = (loc: string) => [
  line("o1", "Planilla", "planilla", 21400, OCT, rest(loc)),
  line("o2", "Renta", "alquiler", 6500, OCT, rest(loc)),
  line("o3", "Luz", "servicios", 1800, OCT, rest(loc)),
  line("o4", "Agua", "servicios", 650, OCT, rest(loc)),
  line("o5", "Internet", "servicios", 1450, OCT, rest(loc)),
  line("o6", "Seguro", "servicios", 100, OCT, rest(loc)),
  line("o7", "Gas", "servicios", 900, OCT, rest(loc)),
  line("o8", "Otros gastos", "otros", 120, OCT, rest(loc)),
];

async function approveFile(co: string, lines: ReturnType<typeof october>) {
  const d = await makeDraft(admin, co, lines);
  const p = await api.preview(c, w.manager, d);
  const expected: Record<string, number> = {};
  for (const k of p.keys) expected[k.key] = k.version;
  return {
    d,
    p,
    expected,
    run: (decisions?: Record<string, string>) =>
      api.approve(c, w.manager, {
        draft: d,
        dv: p.draft_version,
        expected,
        decisions,
      }),
  };
}

describe("the October acceptance file with November already recorded", () => {
  it("October totals 32 920 and November's 25 800 rows are untouched (same version, same items)", async () => {
    const { co, loc } = await fresh();
    // November already holds 25 800 (planilla 20 000 + alquiler 5 800).
    await api.save(c, w.manager, {
      company: co,
      month: NOV,
      loc,
      entries: [
        { category: "planilla", value: 20000, expected_version: 0 },
        { category: "alquiler", value: 5800, expected_version: 0 },
      ],
    });
    const novBefore = await admin.query(
      "select category, amount, version from public.restaurant_fixed_costs where company_id=$1 and month=$2 order by category",
      [co, NOV]
    );
    const novItemsBefore = await admin.query(
      "select id, amount_cents, version from public.fixed_cost_items where company_id=$1 and month=$2 order by id",
      [co, NOV]
    );
    const before = await counts(admin, co);

    const f = await approveFile(co, october(loc));
    const r = await f.run();
    expect(r.status).toBe("applied");

    const sum = ["planilla", "alquiler", "servicios", "otros"].reduce(
      async (t, cat) =>
        (await t) + Number((await agg(admin, co, loc, OCT, cat)).amount),
      Promise.resolve(0)
    );
    expect(await sum).toBe(32920);
    expect(
      (await activeItems(admin, co, loc, OCT, "servicios")).map((i) => i.label)
    ).toEqual(["Luz", "Agua", "Internet", "Seguro", "Gas"]);

    expect(
      (
        await admin.query(
          "select category, amount, version from public.restaurant_fixed_costs where company_id=$1 and month=$2 order by category",
          [co, NOV]
        )
      ).rows
    ).toEqual(novBefore.rows);
    expect(
      (
        await admin.query(
          "select id, amount_cents, version from public.fixed_cost_items where company_id=$1 and month=$2 order by id",
          [co, NOV]
        )
      ).rows
    ).toEqual(novItemsBefore.rows);
    const after = await counts(admin, co);
    expect(after.aggregates).toBe(before.aggregates + 4);
  });

  it("an exact re-upload (another file, same content) changes nothing and is a clear no-op", async () => {
    const { co, loc } = await fresh();
    await (await approveFile(co, october(loc))).run();
    const snapshot = await counts(admin, co);
    const again = await approveFile(co, october(loc));
    expect(again.p.keys.every((k: any) => k.kind === "noop")).toBe(true);
    const r = await again.run();
    expect(r.lines_approved).toBe(0);
    expect(await counts(admin, co)).toEqual({
      ...snapshot,
      // a no-op may record the command, never a financial row
      commands: (await counts(admin, co)).commands,
    });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4900
    );
  });
});

describe("GAP: a revised file cannot reconcile item by item", () => {
  it("GAP: «replace» drops existing items the revised file did not mention (omitted items are NOT retained)", async () => {
    const { co, loc } = await fresh();
    await (await approveFile(co, october(loc))).run();
    // The revised file only restates Luz with a new amount.
    const rev = await approveFile(co, [
      line("r1", "Luz", "servicios", 2000, OCT, rest(loc)),
    ]);
    expect(rev.p.keys[0].kind).toBe("overlap");
    await rev.run({ r1: "replace" });
    const items = await activeItems(admin, co, loc, OCT, "servicios");
    // Agua, Internet, Seguro and Gas are gone: only the restated item remains.
    expect(items.map((i) => i.label)).toEqual(["Luz"]);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      2000
    );
  });

  it("GAP: «add» keeps the old Luz and adds the revised one, so the same cost is counted twice", async () => {
    const { co, loc } = await fresh();
    await (await approveFile(co, october(loc))).run();
    const rev = await approveFile(co, [
      line("r1", "Luz", "servicios", 2000, OCT, rest(loc)),
    ]);
    await rev.run({ r1: "add" });
    const items = await activeItems(admin, co, loc, OCT, "servicios");
    expect(items.filter((i) => i.label === "Luz")).toHaveLength(2);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      6900
    );
  });
});

describe("a breakdown replacing a summary never counts both", () => {
  it("replacing a legacy total with items leaves exactly the items", async () => {
    const { co, loc } = await fresh();
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "servicios", value: 4900, expected_version: 0 }],
    });
    const f = await approveFile(
      co,
      october(loc).filter((l) => l.category === "servicios")
    );
    expect(f.p.keys[0].kind).toBe("overlap");
    await f.run(
      Object.fromEntries(
        ["o3", "o4", "o5", "o6", "o7"].map((i) => [i, "replace"])
      )
    );
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4900
    );
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(5);
  });
});
