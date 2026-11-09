// Real Postgres. Issue 4 reproduction: the October file in GROUP scope over
// existing group costs (8 000 / 10 000 / 2 500). Whatever the person chose must
// be exactly what the table the page reads afterwards shows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";
import {
  activeItems,
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
const OCT = "2026-10-01";
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

async function company() {
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

const file = (scope: Parameters<typeof line>[5]) => [
  line("o1", "Planilla", "planilla", 21400, OCT, scope),
  line("o2", "Renta", "alquiler", 6500, OCT, scope),
  line("o3", "Luz", "servicios", 1800, OCT, scope),
  line("o4", "Agua", "servicios", 650, OCT, scope),
  line("o5", "Internet", "servicios", 1450, OCT, scope),
  line("o6", "Seguro", "servicios", 100, OCT, scope),
  line("o7", "Gas", "servicios", 900, OCT, scope),
  line("o8", "Otros gastos", "otros", 120, OCT, scope),
];

async function seedGroupOctober(co: string) {
  await api.save(c, w.manager, {
    company: co,
    month: OCT,
    loc: null,
    entries: [
      { category: "planilla", value: 8000, expected_version: 0 },
      { category: "alquiler", value: 10000, expected_version: 0 },
      { category: "servicios", value: 2500, expected_version: 0 },
    ],
  });
}

async function run(co: string, lines: ReturnType<typeof file>, choice: string) {
  const d = await makeDraft(admin, co, lines);
  const p = await api.preview(c, w.manager, d);
  const expected: Record<string, number> = {};
  for (const k of p.keys) expected[k.key] = k.version;
  const decisions: Record<string, string> = {};
  for (const k of p.keys)
    if (k.kind === "overlap") for (const l of k.lines) decisions[l.id] = choice;
  const r = await api.approve(c, w.manager, {
    draft: d,
    dv: p.draft_version,
    expected,
    decisions,
  });
  return { p, r };
}

const amt = async (co: string, loc: string | null, cat: string) =>
  Number((await agg(admin, co, loc, OCT, cat))?.amount ?? NaN);

describe("issue 4: group scope, overlap with existing group costs", () => {
  it("replace: the group rows become exactly the file's amounts; the reported categories name them", async () => {
    const { co } = await company();
    await seedGroupOctober(co);
    const { p, r } = await run(co, file(G), "replace");
    expect(
      p.keys
        .filter((k: any) => k.kind === "overlap")
        .map((k: any) => k.category)
        .sort()
    ).toEqual(["alquiler", "planilla", "servicios"]);
    expect(r.status).toBe("applied");
    expect(await amt(co, null, "planilla")).toBe(21400);
    expect(await amt(co, null, "alquiler")).toBe(6500);
    expect(await amt(co, null, "servicios")).toBe(4900);
    expect(await amt(co, null, "otros")).toBe(120);
    const changed = r.categories.filter((x: any) => x.outcome !== "unchanged");
    expect(changed.every((x: any) => x.location_id === null)).toBe(true);
    expect(changed.length).toBe(4);
  });

  it("add: the extra amount is summed onto what is recorded", async () => {
    const { co } = await company();
    await seedGroupOctober(co);
    await run(co, file(G), "add");
    expect(await amt(co, null, "planilla")).toBe(29400);
  });

  it("a file saved to a restaurant leaves the group rows untouched (the view of the OTHER scope does not change)", async () => {
    const { co, loc } = await company();
    await seedGroupOctober(co);
    const { r } = await run(
      co,
      file({ kind: "restaurant", locationId: loc }),
      "replace"
    );
    expect(r.status).toBe("applied");
    expect(await amt(co, null, "planilla")).toBe(8000);
    expect(await amt(co, loc, "planilla")).toBe(21400);
    // The command reports the destination of every changed category.
    expect(r.categories.every((x: any) => x.location_id === loc)).toBe(true);
  });
});

// The October file with the three unclear lines of the brief, AFTER the owner
// assigned them inline (Cosa rara → Otros, Seguro → Servicios, Gas → a restaurant).
describe("unclear lines resolved inline, both scopes: October 32 920, Seguro once, November unchanged", () => {
  const NOV = "2026-11-01";
  const resolved = (scope: Parameters<typeof line>[5]) => [
    line("a1", "Planilla", "planilla", 21400, OCT, scope),
    line("a2", "Renta", "alquiler", 6500, OCT, scope),
    line("a3", "Luz", "servicios", 1800, OCT, scope),
    line("a4", "Agua", "servicios", 650, OCT, scope),
    line("a5", "Internet", "servicios", 1450, OCT, scope),
    line("u1", "Cosa rara", "otros", 120, OCT, scope),
    line("u2", "Seguro", "servicios", 100, OCT, scope),
    line("u3", "Gas", "servicios", 900, OCT, scope),
  ];
  const total = async (co: string, loc: string | null) => {
    let t = 0;
    for (const c of ["planilla", "alquiler", "servicios", "otros"])
      t += Number((await agg(admin, co, loc, OCT, c))?.amount ?? 0);
    return t;
  };

  for (const scopeName of ["restaurant", "group"] as const) {
    it(`${scopeName} scope`, async () => {
      const { co, loc } = await company();
      const target = scopeName === "restaurant" ? loc : null;
      const scope = target
        ? ({ kind: "restaurant", locationId: loc } as const)
        : G;
      await api.save(c, w.manager, {
        company: co,
        month: NOV,
        loc: target,
        entries: [
          { category: "planilla", value: 20000, expected_version: 0 },
          { category: "alquiler", value: 5800, expected_version: 0 },
        ],
      });
      const novBefore = (
        await admin.query(
          "select category, amount, version from public.restaurant_fixed_costs where company_id=$1 and month=$2 order by category",
          [co, NOV]
        )
      ).rows;
      const { r } = await run(co, resolved(scope), "replace");
      expect(r.status).toBe("applied");
      expect(await total(co, target)).toBe(32920);
      const svc = await activeItems(admin, co, target, OCT, "servicios");
      expect(svc.filter((i: any) => i.label === "Seguro")).toHaveLength(1);
      expect(
        Number((await agg(admin, co, target, OCT, "servicios")).amount)
      ).toBe(4900);
      expect(
        (
          await admin.query(
            "select category, amount, version from public.restaurant_fixed_costs where company_id=$1 and month=$2 order by category",
            [co, NOV]
          )
        ).rows
      ).toEqual(novBefore);
      // The command reports every changed category with its destination and totals.
      const changed = r.categories.filter(
        (x: any) => x.outcome !== "unchanged"
      );
      expect(
        changed.every((x: any) => (x.location_id ?? null) === target)
      ).toBe(true);
      expect(
        Object.fromEntries(
          changed.map((x: any) => [x.category, Number(x.total)])
        )
      ).toEqual({
        planilla: 21400,
        alquiler: 6500,
        servicios: 4900,
        otros: 120,
      });
    });
  }
});
