// «Deshacer» of an inline approval, and the pure helpers behind the inline
// list. Demo data only.
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import {
  approveDraft,
  createDraft,
  getDraft,
  undoApproval,
} from "@/lib/restaurant/fixed-cost-upload-server";
import {
  bulkApprovable,
  changeVsLastMonth,
  clusterTotalAfter,
  inlineReview,
  type DraftLine,
} from "@/lib/restaurant/fixed-cost-upload";

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

describe("approve answers with what it wrote", () => {
  it("one applied entry per cluster: the new total and how to undo it", async () => {
    const { ctx, draft } = await setup([
      line({}),
      line({ id: "l2", raw: "Agua", amount: 650 }),
    ]);
    const res = await approveDraft(ctx, draft, {});
    expect(res.ok && res.applied).toEqual([
      expect.objectContaining({
        category: "servicios",
        total: 2450,
        previous: null,
        lineIds: ["l1", "l2"],
      }),
    ]);
  });
});

describe("undoApproval", () => {
  it("a row this approval created is removed, the lines are pending again, the log says so", async () => {
    const { db, ctx, draft } = await setup([line({})]);
    const res = await approveDraft(ctx, draft, {});
    if (!res.ok) throw new Error("approve");
    const undone = await undoApproval(ctx, res.draft, res.applied);
    expect(undone.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs ?? []).toHaveLength(0);
    const after = (await getDraft(ctx, draft.id))!;
    expect(after.status).toBe("draft");
    expect(after.lines[0].status).toBe("pending");
    expect(db.tables.restaurant_fixed_costs_log.at(-1)).toMatchObject({
      action: "delete",
      source: "upload",
      old_value: { amount: 1800 },
      new_value: null,
    });
  });

  it("a row it changed goes back to its previous value, label and source", async () => {
    const { db, ctx, draft } = await setup(
      [line({ id: "l2", raw: "Agua", amount: 650 })],
      {
        restaurant_fixed_costs: [
          {
            id: "fc1",
            company_id: "c1",
            location_id: LOC,
            month: "2026-10-01",
            category: "servicios",
            label: "Luz",
            amount: 1800,
            pct_of_sales: null,
            source: "upload",
          },
        ],
      }
    );
    // This draft already approved "Luz" (so the value is its own): Agua adds.
    draft.lines.unshift(line({ status: "approved" }));
    const res = await approveDraft(ctx, draft, { lineIds: ["l2"] });
    if (!res.ok) throw new Error("approve");
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({ amount: 2450 });
    const undone = await undoApproval(ctx, res.draft, res.applied);
    expect(undone.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 1800,
      label: "Luz",
      source: "upload",
    });
  });

  it("never clobbers a later edit: a value changed since is refused", async () => {
    const { db, ctx, draft } = await setup([line({})]);
    const res = await approveDraft(ctx, draft, {});
    if (!res.ok) throw new Error("approve");
    db.tables.restaurant_fixed_costs[0].amount = 2000;
    db.tables.restaurant_fixed_costs[0].source = "manual";
    const undone = await undoApproval(ctx, res.draft, res.applied);
    expect(undone).toEqual({ ok: false, error: "changed" });
    expect(db.tables.restaurant_fixed_costs[0].amount).toBe(2000);
    expect((await getDraft(ctx, draft.id))!.lines[0].status).toBe("approved");
  });

  it("only touches this company's rows", async () => {
    const { db, ctx, draft } = await setup([line({})], {
      restaurant_fixed_costs: [
        {
          id: "other",
          company_id: "c2",
          location_id: LOC,
          month: "2026-10-01",
          category: "servicios",
          amount: 1800,
          pct_of_sales: null,
          source: "upload",
        },
      ],
    });
    const res = await approveDraft(ctx, draft, {});
    if (!res.ok) throw new Error("approve");
    await undoApproval(ctx, res.draft, res.applied);
    expect(
      db.tables.restaurant_fixed_costs.find((r) => r.id === "other")
    ).toMatchObject({ amount: 1800 });
  });
});

describe("undoApproval is all-or-nothing", () => {
  // Two clusters approved at once: servicios 1,800 and otros 400.
  async function twoEntries() {
    const s = await setup([
      line({}),
      line({ id: "l2", raw: "Contador", category: "otros", amount: 400 }),
    ]);
    const res = await approveDraft(s.ctx, s.draft, {});
    if (!res.ok) throw new Error("approve");
    expect(res.applied).toHaveLength(2);
    return { ...s, res };
  }

  it("refuses without writing anything when the second row was edited since", async () => {
    const { db, ctx, res } = await twoEntries();
    const second = res.applied[1];
    const row = db.tables.restaurant_fixed_costs.find(
      (r) => r.category === second.category
    )!;
    row.amount = 999;
    row.source = "manual";
    const logBefore = (db.tables.restaurant_fixed_costs_log ?? []).length;
    const out = await undoApproval(ctx, res.draft, res.applied);
    expect(out).toEqual({ ok: false, error: "changed" });
    expect(db.tables.restaurant_fixed_costs).toHaveLength(2);
    expect(
      db.tables.restaurant_fixed_costs.find(
        (r) => r.category === res.applied[0].category
      )
    ).toMatchObject({ amount: res.applied[0].total });
    expect((db.tables.restaurant_fixed_costs_log ?? []).length).toBe(logBefore);
    const after = (await getDraft(ctx, res.draft.id))!;
    expect(after.lines.every((l) => l.status === "approved")).toBe(true);
  });

  it("a failing second write leaves entry 1's lines pending and entry 2's approved", async () => {
    const { db, ctx, res } = await twoEntries();
    let deletes = 0;
    const real = ctx.supabase as unknown as {
      from(table: string): object;
    };
    const flaky = {
      ...ctx,
      supabase: {
        from(table: string) {
          const t = real.from(table);
          if (table !== "restaurant_fixed_costs") return t;
          return new Proxy(t, {
            get(target, prop, recv) {
              if (prop === "delete")
                return (...a: unknown[]) => {
                  deletes++;
                  if (deletes === 2)
                    return {
                      eq: () => ({
                        eq: async () => ({ error: { message: "boom" } }),
                      }),
                    };
                  return (
                    target as { delete: (...x: unknown[]) => unknown }
                  ).delete(...a);
                };
              return Reflect.get(target, prop, recv);
            },
          });
        },
      },
    } as unknown as typeof ctx;
    const out = await undoApproval(flaky, res.draft, res.applied);
    expect(out).toEqual({ ok: false, error: "failed" });
    expect(db.tables.restaurant_fixed_costs).toHaveLength(1);
    const after = (await getDraft(ctx, res.draft.id))!;
    const status = (id: string) => after.lines.find((l) => l.id === id)!.status;
    expect(status(res.applied[0].lineIds[0])).toBe("pending");
    expect(status(res.applied[1].lineIds[0])).toBe("approved");
  });
});

describe("inline list helpers", () => {
  const lines = [
    line({}),
    line({ id: "l2", raw: "Agua", amount: 650 }),
    line({ id: "l3", raw: "Cosa", category: null, amount: null }),
    line({
      id: "l4",
      raw: "Renta",
      category: "alquiler",
      amount: 7000,
      status: "approved",
    }),
    line({ id: "l5", raw: "Omitida", category: "otros", status: "discarded" }),
  ];
  it("⚑ lines apart, clusters in order, approved kept under their cluster", () => {
    const r = inlineReview(lines);
    expect(r.fix.map((l) => l.id)).toEqual(["l3"]);
    expect(r.clusters.map((c) => c.category)).toEqual([
      "alquiler",
      "servicios",
    ]);
    expect(r.clusters[0]).toMatchObject({ approvedTotal: 7000 });
    expect(r.clusters[1]).toMatchObject({ pendingTotal: 2450 });
  });
  it("«Aprobar todo» counts and sums only the ready lines", () => {
    expect(bulkApprovable(lines.filter((l) => l.status === "pending"))).toEqual(
      {
        ids: ["l1", "l2"],
        count: 2,
        total: 2450,
      }
    );
  });
  it("last month: flagged only above 20%", () => {
    expect(changeVsLastMonth(120, 100)).toBeNull(); // exactly 20%
    expect(changeVsLastMonth(121, 100)).toBeCloseTo(0.21);
    expect(changeVsLastMonth(70, 100)).toBeCloseTo(-0.3);
    expect(changeVsLastMonth(100, undefined)).toBeNull();
    expect(changeVsLastMonth(100, 0)).toBeNull();
  });
  it("a cluster total adds amounts, but a rate is never added", () => {
    expect(clusterTotalAfter("servicios", 1800, [lines[1]])).toBe(2450);
    expect(clusterTotalAfter("servicios", null, [lines[0], lines[1]])).toBe(
      2450
    );
    expect(
      clusterTotalAfter("impuestos", 13, [
        line({ category: "impuestos", amount: 16 }),
      ])
    ).toBe(16);
  });
});
