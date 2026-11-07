// #485 · approving one line at a time ADDS to what this same upload already
// saved for the category/month/restaurant (Luz 1,800 + Agua 650 = 2,450, label
// «Luz + Agua»). The overwrite warning (antes → ahora) only appears for a value
// from somewhere else. A rate (impuestos) is never added up. Demo data only.
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import {
  approveDraft,
  createDraft,
  getDraft,
} from "@/lib/restaurant/fixed-cost-upload-server";
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";

const LOC = "00000000-0000-4000-8000-00000000000a";
const line = (over: Partial<DraftLine>): DraftLine => ({
  id: "l1",
  raw: "Luz",
  category: "servicios",
  amount: 1800,
  month: "2026-10-01",
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
  ...over,
});
const luz = line({});
const agua = line({ id: "l2", raw: "Agua", amount: 650 });

async function setup(
  lines: DraftLine[],
  seed: Record<string, Record<string, unknown>[]> = {}
) {
  const db = fakeSupabase(seed);
  const ctx = { supabase: db.client, companyId: "c1", userId: "u1" };
  const draft = (await createDraft(ctx, {
    fileName: "costos-demo.csv",
    month: "2026-10-01",
    locationId: LOC,
    lines,
  }))!;
  return { db, ctx, draft };
}
const fresh = async (
  ctx: Awaited<ReturnType<typeof setup>>["ctx"],
  id: string
) => (await getDraft(ctx, id))!;
const rows = (db: Awaited<ReturnType<typeof setup>>["db"]) =>
  db.tables.restaurant_fixed_costs;

describe("one at a time adds up", () => {
  it("Luz 1,800 then Agua 650 saves Servicios = 2,450 «Luz + Agua", async () => {
    const { db, ctx, draft } = await setup([luz, agua]);
    expect(await approveDraft(ctx, draft, { lineIds: ["l1"] })).toMatchObject({
      ok: true,
    });
    expect(rows(db)[0]).toMatchObject({ amount: 1800, label: "Luz" });

    const second = await approveDraft(ctx, await fresh(ctx, draft.id), {
      lineIds: ["l2"],
    });
    // no «Esto reemplaza…» warning: it adds
    expect(second).toMatchObject({ ok: true, approved: 1 });
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({
      amount: 2450,
      label: "Luz + Agua",
      source: "upload",
    });
    expect(db.tables.restaurant_fixed_costs_log[1]).toMatchObject({
      action: "update",
      old_value: { amount: 1800, pct_of_sales: null },
      new_value: { amount: 2450, pct_of_sales: null },
    });
    expect((await fresh(ctx, draft.id)).status).toBe("approved");
  });

  it("the same result as «Aprobar todo»", async () => {
    const { db, ctx, draft } = await setup([luz, agua]);
    await approveDraft(ctx, draft, {});
    expect(rows(db)[0]).toMatchObject({ amount: 2450, label: "Luz + Agua" });
  });

  it("a third line keeps adding", async () => {
    const gas = line({ id: "l3", raw: "Gas", amount: 50 });
    const { db, ctx, draft } = await setup([luz, agua, gas]);
    await approveDraft(ctx, draft, { lineIds: ["l1"] });
    await approveDraft(ctx, await fresh(ctx, draft.id), { lineIds: ["l2"] });
    await approveDraft(ctx, await fresh(ctx, draft.id), { lineIds: ["l3"] });
    expect(rows(db)[0]).toMatchObject({
      amount: 2500,
      label: "Luz + Agua + Gas",
    });
  });
});

describe("the warning is only for a value from another source", () => {
  const existing = (source: string, amount = 1800) => ({
    restaurant_fixed_costs: [
      {
        id: "fc1",
        company_id: "c1",
        location_id: LOC,
        month: "2026-10-01",
        category: "servicios",
        amount,
        pct_of_sales: null,
        source,
      },
    ],
  });

  it("typed by hand: antes → ahora, nothing written until confirmed", async () => {
    const { db, ctx, draft } = await setup([agua], existing("manual"));
    const res = await approveDraft(ctx, draft, {});
    expect(res).toMatchObject({
      ok: false,
      conflicts: [{ lineId: "l2", old: 1800, new: 650 }],
    });
    expect(rows(db)[0].amount).toBe(1800);
  });

  it("an earlier file (source 'upload', not approved in this draft) is a conflict", async () => {
    const { ctx, draft } = await setup([agua], existing("upload"));
    expect(await approveDraft(ctx, draft, {})).toMatchObject({
      ok: false,
      conflicts: [{ old: 1800, new: 650 }],
    });
  });

  it("this upload's value edited since is also a conflict, not an add", async () => {
    const { db, ctx, draft } = await setup([luz, agua]);
    await approveDraft(ctx, draft, { lineIds: ["l1"] });
    db.tables.restaurant_fixed_costs[0].amount = 2000; // changed by hand
    db.tables.restaurant_fixed_costs[0].source = "manual";
    const res = await approveDraft(ctx, await fresh(ctx, draft.id), {
      lineIds: ["l2"],
    });
    expect(res).toMatchObject({
      ok: false,
      conflicts: [{ old: 2000, new: 650 }],
    });
  });
});

describe("impuestos are never added up", () => {
  const tax = (id: string, pct: number) =>
    line({ id, raw: `IVA ${pct}`, category: "impuestos", amount: pct });

  it("a second rate replaces (with a warning), never 13 + 5", async () => {
    const { db, ctx, draft } = await setup([tax("t1", 13), tax("t2", 5)]);
    // two pending rates of one key are blocked together
    expect(await approveDraft(ctx, draft, {})).toMatchObject({
      ok: true,
      approved: 0,
    });
    expect(rows(db) ?? []).toHaveLength(0);
  });

  it("with one rate already approved from this upload, another is a conflict", async () => {
    const { db, ctx, draft } = await setup([tax("t1", 13), tax("t2", 5)]);
    // keep one: discard the other rate first, approve, then bring a new one
    const kept = {
      ...draft,
      lines: draft.lines.map((l) =>
        l.id === "t2" ? { ...l, status: "discarded" as const } : l
      ),
    };
    await approveDraft(ctx, kept, {});
    expect(rows(db)[0]).toMatchObject({ pct_of_sales: 13 });
    const later = {
      ...kept,
      lines: kept.lines.map((l) =>
        l.id === "t2"
          ? { ...l, status: "pending" as const }
          : { ...l, status: "approved" as const }
      ),
    };
    const res = await approveDraft(ctx, later, {});
    expect(res).toMatchObject({
      ok: false,
      conflicts: [{ category: "impuestos", old: 13, new: 5 }],
    });
  });
});
