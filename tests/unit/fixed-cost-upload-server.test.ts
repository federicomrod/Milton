// #409 · draft → approve against an in-memory database. Drafts, edits and
// discards never touch restaurant_fixed_costs; approving saves with source
// 'upload' and logs it; a different value already in the month needs a
// confirmation first. Demo data only.
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import {
  approveDraft,
  createDraft,
  discardDraft,
  editDraft,
  getDraft,
} from "@/lib/restaurant/fixed-cost-upload-server";
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";

const LOC = "00000000-0000-4000-8000-00000000000a";
const line = (over: Partial<DraftLine>): DraftLine => ({
  id: "l1",
  raw: "Renta",
  category: "alquiler",
  amount: 7000,
  month: "2026-10-01",
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
  ...over,
});

function setup(seed: Record<string, Record<string, unknown>[]> = {}) {
  const db = fakeSupabase(seed);
  const ctx = { supabase: db.client, companyId: "c1", userId: "u1" };
  return { db, ctx };
}
const costWrites = (db: ReturnType<typeof fakeSupabase>) =>
  db.writes.filter((w) => w.table.startsWith("restaurant_fixed_costs"));

describe("nothing changes until approved", () => {
  it("creating, editing and discarding a draft never touch Costos fijos", async () => {
    const { db, ctx } = setup();
    const draft = await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({}), line({ id: "l2", category: null, amount: null })],
    });
    expect(draft).not.toBeNull();
    expect(db.tables.fixed_cost_upload_drafts[0].storage_path).toBeNull(); // file not kept
    const edited = await editDraft(ctx, draft!, [
      { lineId: "l2", category: "servicios", amount: 900 },
      { lineId: "l1", discard: true },
    ]);
    expect(edited!.lines[1]).toMatchObject({
      category: "servicios",
      amount: 900,
    });
    await discardDraft(ctx, edited!);
    expect(costWrites(db)).toHaveLength(0);
    expect(db.tables.fixed_cost_upload_drafts[0].status).toBe("discarded");
  });
});

describe("approving", () => {
  it("saves with source 'upload' and logs it (history shows «Archivo»)", async () => {
    const { db, ctx } = setup();
    const draft = (await createDraft(ctx, {
      fileName: "x.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({})],
    }))!;
    const res = await approveDraft(ctx, draft, {});
    expect(res.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      category: "alquiler",
      amount: 7000,
      source: "upload",
      status: "confirmed",
      currency: "USD",
      location_id: LOC,
    });
    expect(db.tables.restaurant_fixed_costs_log[0]).toMatchObject({
      action: "create",
      source: "upload",
      old_value: null,
      new_value: { amount: 7000, pct_of_sales: null },
      actor: "u1",
    });
    expect((await getDraft(ctx, draft.id))!.status).toBe("approved");
  });

  it("lines with a problem stay in the draft, unsaved and never $0", async () => {
    const { db, ctx } = setup();
    const draft = (await createDraft(ctx, {
      fileName: "x.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [
        line({}),
        line({ id: "l2", category: null }),
        line({ id: "l3", category: "otros", amount: null }),
      ],
    }))!;
    const res = await approveDraft(ctx, draft, {});
    expect(res.ok && res.approved).toBe(1);
    expect(db.tables.restaurant_fixed_costs).toHaveLength(1);
    const after = (await getDraft(ctx, draft.id))!;
    expect(after.status).toBe("draft");
    expect(
      after.lines.filter((l) => l.status === "pending").map((l) => l.id)
    ).toEqual(["l2", "l3"]);
  });

  it("a different value already there needs a confirmation: old → new, nothing written", async () => {
    const { db, ctx } = setup({
      restaurant_fixed_costs: [
        {
          id: "fc1",
          company_id: "c1",
          location_id: LOC,
          month: "2026-10-01",
          category: "alquiler",
          amount: 6500,
          pct_of_sales: null,
          source: "manual",
        },
      ],
    });
    const draft = (await createDraft(ctx, {
      fileName: "x.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({})],
    }))!;
    const first = await approveDraft(ctx, draft, {});
    expect(first).toMatchObject({
      ok: false,
      conflicts: [{ lineId: "l1", old: 6500, new: 7000, category: "alquiler" }],
    });
    expect(costWrites(db)).toHaveLength(0);
    expect(db.tables.restaurant_fixed_costs[0].amount).toBe(6500);

    const second = await approveDraft(ctx, draft, { confirmed: ["l1"] });
    expect(second.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 7000,
      source: "upload",
    });
    expect(db.tables.restaurant_fixed_costs_log[0]).toMatchObject({
      action: "update",
      source: "upload",
      old_value: { amount: 6500, pct_of_sales: null },
      new_value: { amount: 7000, pct_of_sales: null },
    });
  });

  it("the same value is not a conflict and writes nothing", async () => {
    const { db, ctx } = setup({
      restaurant_fixed_costs: [
        {
          id: "fc1",
          company_id: "c1",
          location_id: LOC,
          month: "2026-10-01",
          category: "alquiler",
          amount: 7000,
          pct_of_sales: null,
          source: "manual",
        },
      ],
    });
    const draft = (await createDraft(ctx, {
      fileName: "x.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({})],
    }))!;
    const res = await approveDraft(ctx, draft, {});
    expect(res.ok).toBe(true);
    expect(costWrites(db)).toHaveLength(0);
  });

  it("impuestos is saved as a rate, with no amount", async () => {
    const { db, ctx } = setup();
    const draft = (await createDraft(ctx, {
      fileName: "x.csv",
      month: "2026-10-01",
      locationId: null,
      lines: [
        line({ category: "impuestos", amount: 16, scope: { kind: "group" } }),
      ],
    }))!;
    await approveDraft(ctx, draft, {});
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      category: "impuestos",
      pct_of_sales: 16,
      amount: null,
      location_id: null,
    });
  });
});
