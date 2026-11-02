// Migration 077 may not be applied yet: nothing crashes, nothing is $0.
import { describe, expect, it } from "vitest";
import {
  isMissingTable,
  loadPlanVsReported,
  loadWasteSummary,
} from "@/lib/restaurant/unplanned-waste-server";
import { draftWasteLines } from "@/lib/restaurant/waste-drafts-server";

const failing = (code: string) =>
  ({
    from: () => {
      const q: Record<string, unknown> = {};
      const self = () => q;
      Object.assign(q, {
        select: self,
        eq: self,
        gte: self,
        lte: self,
        limit: async () => ({
          data: null,
          error: { code, message: "relation does not exist" },
        }),
        maybeSingle: async () => ({ data: null, error: null }),
      });
      return q;
    },
  }) as never;

describe("table not there yet", () => {
  it("knows a missing table", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable(null)).toBe(false);
  });
  it("the read answers «not available» instead of throwing", async () => {
    expect(
      await loadWasteSummary(
        failing("42P01"),
        "c",
        "l",
        "2026-10-01",
        "2026-10-26"
      )
    ).toEqual({ available: false });
  });
  it("plan vs reported answers null, never a number", async () => {
    expect(
      await loadPlanVsReported(
        failing("42P01"),
        "c",
        "l",
        "2026-10-01",
        "2026-10-26",
        5
      )
    ).toBeNull();
  });
  it("drafting never throws and writes nothing", async () => {
    const r = await draftWasteLines({
      admin: failing("42P01"),
      companyId: "c",
      locationId: "l",
      text: "tiramos 3 kg de tomate",
      reportId: "r1",
    });
    expect(r.drafted).toBe(0);
  });
});
