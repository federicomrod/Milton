// Real Postgres. Manual save, items, explicit copy, undo, durability, atomic failure.
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
async function approveLines(
  co: string,
  lines: ReturnType<typeof line>[],
  decisions: Record<string, string> = {}
) {
  const d = await makeDraft(admin, co, lines);
  const p = await api.preview(c, w.manager, d);
  const expected: Record<string, number> = {};
  for (const k of p.keys) expected[k.key] = k.version;
  const r = await api.approve(c, w.manager, {
    draft: d,
    dv: p.draft_version,
    expected,
    decisions,
  });
  return { d, r };
}
const servicios4 = (loc: string, month = OCT) => [
  line("s1", "Luz", "servicios", 1800, month, rest(loc)),
  line("s2", "Agua", "servicios", 650, month, rest(loc)),
  line("s3", "Internet", "servicios", 1450, month, rest(loc)),
  line("s4", "Gas", "servicios", 900, month, rest(loc)),
];
const ver = async (co: string, loc: string | null, m: string, cat: string) =>
  Number((await agg(admin, co, loc, m, cat))?.version ?? 0);

describe("manual save", () => {
  it("creates one manual item, rejects a missing expected version and a stale one", async () => {
    const { co, loc } = await fresh();
    await expect(
      api.save(c, w.manager, {
        company: co,
        month: OCT,
        loc,
        entries: [{ category: "alquiler", value: 1000 }],
      })
    ).rejects.toMatchObject({
      code: "FC422",
      message: "expected_version_required",
    });
    const r = await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [
        {
          category: "alquiler",
          value: 1000,
          label: "Renta",
          expected_version: 0,
        },
      ],
    });
    expect(r.status).toBe("applied");
    expect(Number((await agg(admin, co, loc, OCT, "alquiler")).amount)).toBe(
      1000
    );
    expect(await activeItems(admin, co, loc, OCT, "alquiler")).toHaveLength(1);
    await expect(
      api.save(c, w.manager, {
        company: co,
        month: OCT,
        loc,
        entries: [{ category: "alquiler", value: 1100, expected_version: 0 }],
      })
    ).rejects.toMatchObject({ code: "FC409", message: "stale_version" });
  });

  it("a typed 0 is a real confirmed value; empty removes the category", async () => {
    const { co, loc } = await fresh();
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "otros", value: 0, expected_version: 0 }],
    });
    const a = await agg(admin, co, loc, OCT, "otros");
    expect(Number(a.amount)).toBe(0);
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [
        { category: "otros", value: null, expected_version: a.version },
      ],
    });
    expect(await agg(admin, co, loc, OCT, "otros")).toBeNull();
    expect(await activeItems(admin, co, loc, OCT, "otros")).toHaveLength(0);
  });

  it("a total over known items needs replace_items, and nothing else changes", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, servicios4(loc));
    const v = await ver(co, loc, OCT, "servicios");
    await expect(
      api.save(c, w.manager, {
        company: co,
        month: OCT,
        loc,
        entries: [{ category: "servicios", value: 100, expected_version: v }],
      })
    ).rejects.toMatchObject({ code: "FC422", message: "has_items" });
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(4);
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [
        {
          category: "servicios",
          value: 100,
          replace_items: true,
          expected_version: v,
        },
      ],
    });
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(1);
  });

  it("an unchanged save is a no-op: no command, no history", async () => {
    const { co, loc } = await fresh();
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "alquiler", value: 1000, expected_version: 0 }],
    });
    const base = await counts(admin, co);
    const v = await ver(co, loc, OCT, "alquiler");
    const r = await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [{ category: "alquiler", value: 1000, expected_version: v }],
    });
    expect(r.status).toBe("noop");
    expect(await counts(admin, co)).toEqual(base);
  });

  it("flipping a flag only keeps the amount and its source", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, [
      line("a", "Renta", "alquiler", 500, OCT, rest(loc)),
    ]);
    const v = await ver(co, loc, OCT, "alquiler");
    await api.save(c, w.manager, {
      company: co,
      month: OCT,
      loc,
      entries: [
        {
          category: "alquiler",
          value: 500,
          label: "Renta",
          repeats: false,
          expected_version: v,
        },
      ],
    });
    const a = await agg(admin, co, loc, OCT, "alquiler");
    expect(a.source).toBe("upload");
    expect(a.repeats).toBe(false);
  });
});

describe("item durability across edits, reloads and copies", () => {
  it("four Servicios items, explicit Seguro, edit, delete, copy twice", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, servicios4(loc));
    // explicit add
    let v = await ver(co, loc, OCT, "servicios");
    await api.item(c, w.manager, {
      company: co,
      op: "add",
      loc,
      month: OCT,
      category: "servicios",
      label: "Seguro",
      cents: 10000,
      aggVersion: v,
    });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4900
    );
    // edit Agua: same item id, new amount
    let items = await activeItems(admin, co, loc, OCT, "servicios");
    const agua = items.find((i) => i.label === "Agua");
    v = await ver(co, loc, OCT, "servicios");
    await api.item(c, w.manager, {
      company: co,
      op: "update",
      loc,
      month: OCT,
      category: "servicios",
      itemId: agua.id,
      label: "Agua",
      cents: 70000,
      aggVersion: v,
      itemVersion: agua.version,
    });
    items = await activeItems(admin, co, loc, OCT, "servicios");
    expect(items.find((i) => i.label === "Agua").id).toBe(agua.id); // identity survives
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4950
    );
    // delete Gas
    const gas = items.find((i) => i.label === "Gas");
    v = await ver(co, loc, OCT, "servicios");
    await api.item(c, w.manager, {
      company: co,
      op: "delete",
      loc,
      month: OCT,
      category: "servicios",
      itemId: gas.id,
      aggVersion: v,
      itemVersion: gas.version,
    });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4050
    );
    // a stale item version is refused
    v = await ver(co, loc, OCT, "servicios");
    await expect(
      api.item(c, w.manager, {
        company: co,
        op: "update",
        loc,
        month: OCT,
        category: "servicios",
        itemId: agua.id,
        cents: 1,
        aggVersion: v,
        itemVersion: agua.version,
      })
    ).rejects.toMatchObject({ code: "FC409", message: "stale_item" });

    // "newest draft wins" cannot hide them: a later unrelated draft changes nothing here.
    await approveLines(co, [line("z", "Renta", "alquiler", 1, OCT, rest(loc))]);
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(4);

    // copy twice: source and destination stay distinct snapshots
    const prev = await api.previewCopy(c, w.manager, co, loc, OCT, NOV);
    expect(
      prev.categories.find((x: any) => x.category === "servicios").state
    ).toBe("missing_in_destination");
    const first = await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: { [keyOf(loc, NOV, "servicios")]: 0 },
    });
    expect(first.status).toBe("applied");
    const second = await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: {
        [keyOf(loc, NOV, "servicios")]: await ver(co, loc, NOV, "servicios"),
      },
    });
    expect(second.status).toBe("noop");
    const dest = await activeItems(admin, co, loc, NOV, "servicios");
    const src = await activeItems(admin, co, loc, OCT, "servicios");
    expect(dest).toHaveLength(4);
    expect(
      dest.map((i) => i.id).some((id) => src.map((s) => s.id).includes(id))
    ).toBe(false);
    // genuine lineage, recorded only because the source really had items
    expect(
      dest.every((i) => src.some((s) => s.id === i.origin.source_item_id))
    ).toBe(true);
    expect(Number((await agg(admin, co, loc, NOV, "servicios")).amount)).toBe(
      4050
    );
  });
});

describe("explicit recurrence", () => {
  it("preview writes nothing; a copy is a snapshot; editing the source does not propagate", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, servicios4(loc));
    const base = await counts(admin, co);
    await api.previewCopy(c, w.manager, co, loc, OCT, NOV);
    expect(await counts(admin, co)).toEqual(base);

    await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: { [keyOf(loc, NOV, "servicios")]: 0 },
    });
    const a = await agg(admin, co, loc, NOV, "servicios");
    expect(a.repeats).toBe(false); // a copy never silently enables the repeat flag
    expect(a.copy_source).toMatchObject({ month: OCT });

    // Edit October afterwards: November does not move; the preview says so.
    const v = await ver(co, loc, OCT, "servicios");
    await api.item(c, w.manager, {
      company: co,
      op: "add",
      loc,
      month: OCT,
      category: "servicios",
      label: "Seguro",
      cents: 10000,
      aggVersion: v,
    });
    expect(Number((await agg(admin, co, loc, NOV, "servicios")).amount)).toBe(
      4800
    );
    const prev = await api.previewCopy(c, w.manager, co, loc, OCT, NOV);
    const s = prev.categories.find((x: any) => x.category === "servicios");
    expect(s.source_changed_since_copy).toBe(true);
    expect(s.state).toBe("conflict");
  });

  it("a conflicting destination is never silently overwritten; replace is explicit and guarded", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, servicios4(loc));
    await api.save(c, w.manager, {
      company: co,
      month: NOV,
      loc,
      entries: [{ category: "servicios", value: 999, expected_version: 0 }],
    });
    const dv = await ver(co, loc, NOV, "servicios");
    const r = await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: { [keyOf(loc, NOV, "servicios")]: dv },
    });
    expect(r.status).toBe("needs_decision");
    expect(Number((await agg(admin, co, loc, NOV, "servicios")).amount)).toBe(
      999
    );
    await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      decisions: { servicios: "replace" },
      expected: { [keyOf(loc, NOV, "servicios")]: dv },
    });
    expect(Number((await agg(admin, co, loc, NOV, "servicios")).amount)).toBe(
      4800
    );
    // stale destination version
    await expect(
      api.copy(c, w.manager, {
        company: co,
        loc,
        from: OCT,
        to: NOV,
        categories: ["servicios"],
        decisions: { servicios: "replace" },
        expected: { [keyOf(loc, NOV, "servicios")]: dv },
      })
    ).rejects.toMatchObject({ code: "FC409", message: "stale_version" });
  });

  it("copying a legacy total stays honest: no items, no invented lineage", async () => {
    const { co, loc } = await fresh();
    await admin.query(
      "insert into public.restaurant_fixed_costs (company_id, location_id, month, category, amount, currency, source, status, repeats) values ($1,$2,$3,'servicios',4800,'USD','upload','confirmed',true)",
      [co, loc, OCT]
    );
    await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: { [keyOf(loc, NOV, "servicios")]: 0 },
    });
    const a = await agg(admin, co, loc, NOV, "servicios");
    expect(Number(a.amount)).toBe(4800);
    expect(a.detail_state).toBe("legacy_total");
    expect(await activeItems(admin, co, loc, NOV, "servicios")).toHaveLength(0);
    const log = (
      await admin.query(
        "select new_value from public.restaurant_fixed_costs_log where company_id=$1 and month=$2",
        [co, NOV]
      )
    ).rows[0].new_value;
    expect(log.from_month).toBe(OCT); // true: the command recorded it
    expect(log.items).toBeUndefined(); // no breakdown is claimed
  });

  it("the tax rate is copied only when asked for", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, [
      line("t", "IVA", "impuestos", 13, OCT, rest(loc)),
      line("a", "Renta", "alquiler", 10, OCT, rest(loc)),
    ]);
    await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["alquiler"],
      expected: { [keyOf(loc, NOV, "alquiler")]: 0 },
    });
    expect(await agg(admin, co, loc, NOV, "impuestos")).toBeNull();
  });
});

describe("undo", () => {
  it("restores only the intended command; a forged client total has no entry point", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, [
      line("p", "Planilla", "planilla", 500, OCT, rest(loc)),
    ]);
    const { d, r } = await approveLines(co, servicios4(loc));
    const before = await counts(admin, co);
    const u = await api.undo(c, w.manager, r.command_id);
    expect(u.status).toBe("applied");
    expect(await agg(admin, co, loc, OCT, "servicios")).toBeNull();
    expect(Number((await agg(admin, co, loc, OCT, "planilla")).amount)).toBe(
      500
    ); // unrelated work kept
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(0);
    const dr = (
      await admin.query(
        "select status, parsed_lines from public.fixed_cost_upload_drafts where id=$1",
        [d]
      )
    ).rows[0];
    expect(dr.status).toBe("draft");
    expect(dr.parsed_lines.every((x: any) => x.status === "pending")).toBe(
      true
    );
    expect((await counts(admin, co)).commands).toBe(before.commands + 1);
    // Items stay for audit (retired), history keeps the original events.
    const hist = await admin.query(
      "select count(*)::int n from public.restaurant_fixed_costs_log where company_id=$1 and category='servicios'",
      [co]
    );
    expect(hist.rows[0].n).toBe(2);
    // Undo once only.
    await expect(api.undo(c, w.manager, r.command_id)).rejects.toMatchObject({
      code: "FC409",
      message: "already_undone",
    });
    // The function takes only a command id: there is no parameter to forge.
    const sig = await admin.query(
      "select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='fixed_cost_undo' and n.nspname='public'"
    );
    expect(sig.rows[0].a).toBe("p_command_key text, p_target uuid");
  });

  it("restores a replaced value and a previous total", async () => {
    const { co, loc } = await fresh();
    const base = await approveLines(co, servicios4(loc));
    const { r } = await approveLines(
      co,
      [line("n", "Luz", "servicios", 2000, OCT, rest(loc))],
      { n: "replace" }
    );
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      2000
    );
    await api.undo(c, w.manager, r.command_id);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    );
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(4);
    expect(base.r.status).toBe("applied");
  });

  it("a later edit makes the undo conflict instead of erasing that edit", async () => {
    const { co, loc } = await fresh();
    const { r } = await approveLines(co, servicios4(loc));
    const v = await ver(co, loc, OCT, "servicios");
    await api.item(c, w.manager, {
      company: co,
      op: "add",
      loc,
      month: OCT,
      category: "servicios",
      label: "Seguro",
      cents: 10000,
      aggVersion: v,
    });
    await expect(api.undo(c, w.manager, r.command_id)).rejects.toMatchObject({
      code: "FC409",
      message: "changed_since",
    });
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4900
    );
  });

  it("undoing a copy removes the copied key and leaves the source", async () => {
    const { co, loc } = await fresh();
    await approveLines(co, servicios4(loc));
    const cp = await api.copy(c, w.manager, {
      company: co,
      loc,
      from: OCT,
      to: NOV,
      categories: ["servicios"],
      expected: { [keyOf(loc, NOV, "servicios")]: 0 },
    });
    await api.undo(c, w.manager, cp.command_id);
    expect(await agg(admin, co, loc, NOV, "servicios")).toBeNull();
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    );
  });
});

describe("atomic failure: zero new effects, then one clean retry", () => {
  beforeAll(async () => {
    await admin.query(`
      create table public.poison (company uuid, at_table text, nth int default 1);
      create function public.poison_trg() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from public.poison p where p.company = NEW.company_id and p.at_table = TG_TABLE_NAME) then
          raise exception 'injected failure on %', TG_TABLE_NAME using errcode = 'XX999';
        end if;
        return NEW;
      end $$;
      create trigger poison_items after insert on public.fixed_cost_items for each row execute function public.poison_trg();
      create trigger poison_log before insert on public.restaurant_fixed_costs_log for each row execute function public.poison_trg();
      create trigger poison_drafts before update on public.fixed_cost_upload_drafts for each row execute function public.poison_trg();
    `);
  });

  for (const table of [
    "fixed_cost_items",
    "restaurant_fixed_costs_log",
    "fixed_cost_upload_drafts",
  ]) {
    it(`a failure in ${table} leaves nothing behind; the retry succeeds once`, async () => {
      const { co, loc } = await fresh();
      // pre-existing work that must survive untouched
      await approveLines(co, [
        line("p", "Planilla", "planilla", 500, OCT, rest(loc)),
      ]);
      const d = await makeDraft(admin, co, [
        ...servicios4(loc),
        line("al", "Renta", "alquiler", 100, OCT, rest(loc)),
      ]);
      const p = await api.preview(c, w.manager, d);
      const expected: Record<string, number> = {};
      for (const k of p.keys) expected[k.key] = k.version;
      const base = await counts(admin, co);
      const key = `k-${uuid()}`;
      // poison AFTER the servicios items are written (the early write), at the named table
      await admin.query(
        "insert into public.poison (company, at_table) values ($1,$2)",
        [co, table]
      );
      await expect(
        api.approve(c, w.manager, {
          key,
          draft: d,
          dv: p.draft_version,
          expected,
        })
      ).rejects.toMatchObject({ code: "XX999" });
      expect(await counts(admin, co)).toEqual(base);
      const dr = (
        await admin.query(
          "select status, version, parsed_lines from public.fixed_cost_upload_drafts where id=$1",
          [d]
        )
      ).rows[0];
      expect(dr.status).toBe("draft");
      expect(dr.version).toBe(p.draft_version);
      expect(dr.parsed_lines.some((x: any) => x.status === "approved")).toBe(
        false
      );
      expect(await agg(admin, co, loc, OCT, "servicios")).toBeNull();
      expect(Number((await agg(admin, co, loc, OCT, "planilla")).amount)).toBe(
        500
      );

      await admin.query("delete from public.poison where company=$1", [co]);
      const ok = await api.approve(c, w.manager, {
        key,
        draft: d,
        dv: p.draft_version,
        expected,
      });
      expect(ok.status).toBe("applied");
      expect(ok.replayed).toBe(false);
      expect((await counts(admin, co)).commands).toBe(base.commands + 1);
    });
  }

  it("an undo that fails rolls back its event and its financial changes together", async () => {
    const { co, loc } = await fresh();
    const { r } = await approveLines(co, servicios4(loc));
    const base = await counts(admin, co);
    await admin.query(
      "insert into public.poison (company, at_table) values ($1,'restaurant_fixed_costs_log')",
      [co]
    );
    await expect(api.undo(c, w.manager, r.command_id)).rejects.toMatchObject({
      code: "XX999",
    });
    await admin.query("delete from public.poison where company=$1", [co]);
    expect(await counts(admin, co)).toEqual(base);
    expect(Number((await agg(admin, co, loc, OCT, "servicios")).amount)).toBe(
      4800
    );
    expect(await activeItems(admin, co, loc, OCT, "servicios")).toHaveLength(4);
  });
});
