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
  createDraft,
  discardDraft,
  editDraft,
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

// Approving is a database command now (migration 079). Its behaviour is proven
// on a real Postgres in tests/pg/approve.test.ts and commands.test.ts.
