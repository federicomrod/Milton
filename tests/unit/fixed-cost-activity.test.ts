// Activity is grouped by operation. Approve → undo → re-approve are three clear
// entries, an unchanged total is never an increase. Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  buildActivity,
  direction,
  type CommandRow,
} from "@/lib/restaurant/fixed-cost-activity";
import { NOV, OCT } from "./fixtures/fixed-cost-redesign";

const cat = (
  category: string,
  total: number | null,
  previous: number | null,
  month = OCT,
  loc: string | null = "loc-1"
) => ({
  category,
  month,
  location_id: loc,
  outcome: "created",
  total,
  previous_total: previous,
});

const approve = (
  id: string,
  at: string,
  draft: string,
  categories: unknown[]
): CommandRow => ({
  id,
  kind: "approve_upload",
  created_at: at,
  draft_id: draft,
  undo_of: null,
  result: { categories, draft: { file_name: "octubre.xlsx" } },
});

describe("approve → undo → re-approve", () => {
  const a1 = approve("a1", "2026-11-05T10:00:00Z", "d1", [
    cat("planilla", 21400, null),
  ]);
  const u1: CommandRow = {
    id: "u1",
    kind: "undo",
    created_at: "2026-11-05T10:05:00Z",
    draft_id: "d1",
    undo_of: "a1",
    result: {},
  };
  const a2 = approve("a2", "2026-11-05T10:10:00Z", "d1", [
    cat("planilla", 21400, null),
  ]);
  const entries = buildActivity([a2, u1, a1]);

  it("shows three distinct operations with different labels, newest first", () => {
    expect(entries.map((e) => e.kind)).toEqual([
      "reapproved",
      "undone",
      "approved",
    ]);
  });

  it("the undo restores the earlier value instead of adding to it", () => {
    const undo = entries[1];
    expect(undo.changes[0].before).toBe(21400);
    expect(undo.changes[0].after).toBeNull();
    expect(undo.changes[0].direction).toBe("removed");
    expect(undo.source).toBe("octubre.xlsx");
  });

  it("the re-approval is not an increase: it ends at the same recorded amount", () => {
    expect(entries[0].changes[0].after).toBe(21400);
    expect(entries[2].changes[0].after).toBe(21400);
  });
});

describe("direction", () => {
  it("compares before and after only", () => {
    expect(direction(100, 100)).toBe("same");
    expect(direction(100, 100.004)).toBe("same");
    expect(direction(100, 150)).toBe("up");
    expect(direction(150, 100)).toBe("down");
    expect(direction(null, 5)).toBe("new");
    expect(direction(5, null)).toBe("removed");
  });
  it("an unchanged total is labelled as no change", () => {
    const [e] = buildActivity([
      approve("x", "2026-11-05T10:00:00Z", "d", [cat("alquiler", 6500, 6500)]),
    ]);
    expect(e.changes[0].direction).toBe("same");
  });
});

describe("grouping and scope", () => {
  it("one entry per command with its destination months", () => {
    const [e] = buildActivity([
      approve("x", "2026-11-05T10:00:00Z", "d", [
        cat("planilla", 1, null, OCT),
        cat("planilla", 2, null, NOV),
      ]),
    ]);
    expect(e.months).toEqual([OCT, NOV]);
    expect(e.changes).toHaveLength(2);
  });

  it("a restaurant view shows only its own changes, the group view only the group's", () => {
    const rows = [
      approve("x", "2026-11-05T10:00:00Z", "d", [
        cat("planilla", 1, null, OCT, "loc-1"),
        cat("alquiler", 2, null, OCT, null),
      ]),
    ];
    expect(
      buildActivity(rows, { locationId: "loc-1" })[0].changes
    ).toHaveLength(1);
    expect(
      buildActivity(rows, { locationId: null })[0].changes[0].category
    ).toBe("alquiler");
    expect(buildActivity(rows, { locationId: "other" })).toEqual([]);
  });

  it("copies and manual saves keep their own labels", () => {
    const rows: CommandRow[] = [
      {
        id: "c",
        kind: "copy",
        created_at: "2026-11-05T10:00:00Z",
        draft_id: null,
        undo_of: null,
        result: {},
      },
      {
        id: "s",
        kind: "save_totals",
        created_at: "2026-11-05T11:00:00Z",
        draft_id: null,
        undo_of: null,
        result: {},
      },
    ];
    expect(buildActivity(rows).map((e) => e.kind)).toEqual(["saved", "copied"]);
  });
});
