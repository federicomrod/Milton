// The recipe editor shows raw and effective cost per line and which factor
// applied. Display only: the line's raw amount is never changed.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  listAllCompanyRestaurants: async () => ({
    locations: [
      { id: "loc-1", name: "Sucursal Demo", brand_id: null, archived_at: null },
    ],
    archiveAvailable: true,
  }),
}));
vi.mock("@/lib/restaurant/kitchen-buffer-server", () => ({
  loadBusinessToday: async () => "2026-11-10",
}));
vi.mock("@/lib/restaurant/yield-buffer", () => ({
  loadResolvedBufferAt: async () => ({
    bufferPct: 5,
    effectiveFrom: null,
    isDefault: true,
  }),
  loadYieldsAt: async () =>
    new Map([["ing-brisket", { lossPct: 35, effectiveFrom: "2026-09-15" }]]),
}));

import { attachEffectiveCosts } from "@/lib/restaurant/effective-cost-server";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";

const line = (over: Record<string, unknown>) =>
  ({
    key: "k",
    input_id: "i",
    kind: "ingredient",
    ingredient_id: null,
    component_id: null,
    name: "x",
    raw_name: "x",
    source_row: null,
    qty: 1,
    unit: "kg",
    unit_cost: null,
    amount: null,
    price: null,
    pending: false,
    flags: [],
    reasons: [],
    possible_match: null,
    evidence_index: null,
    unit_question: null,
    excel_unit_cost: null,
    ...over,
  }) as unknown as EditorState["lines"][number];

const state = (lines: EditorState["lines"], measured?: boolean): EditorState =>
  ({
    editable: true,
    locked_reason: null,
    version_id: "v",
    lines,
    options: [],
    pending: 0,
    total_cost: null,
    ...(measured === undefined
      ? {}
      : {
          preparation: {
            component_id: "c",
            name: "Prep demo",
            status: "draft",
            yield: {
              value: 6.5,
              unit: "kg",
              confirmed: measured,
              source: "manual",
            },
            cost_per_output_unit: null,
            checklist: {} as never,
          },
        }),
  }) as EditorState;

describe("attachEffectiveCosts", () => {
  it("own yield, kitchen buffer, none for a preparation and for a missing price", async () => {
    const s = state([
      line({ key: "a", ingredient_id: "ing-brisket", amount: 2 }),
      line({ key: "b", ingredient_id: "ing-rice", amount: 0.3 }),
      line({ key: "c", kind: "component", component_id: "p", amount: 5 }),
      line({ key: "d", ingredient_id: "ing-x", amount: null }),
    ]);
    await attachEffectiveCosts({} as never, "c1", "loc-1", s);
    const [a, b, c, d] = s.lines.map((l) => l.effective!);
    expect(a.factor).toBe("own_yield");
    expect(a.effective).toBeCloseTo(3.0769, 4);
    expect(b.factor).toBe("kitchen_buffer");
    expect(b.effective).toBeCloseTo(0.315, 6);
    expect(c.factor).toBe("none");
    expect(d.effective).toBeNull();
    // raw amounts untouched
    expect(s.lines.map((l) => l.amount)).toEqual([2, 0.3, 5, null]);
  });
  it("inside a measured preparation: no buffer; an unmeasured one still gets it", async () => {
    const measured = state(
      [line({ ingredient_id: "ing-rice", amount: 1 })],
      true
    );
    await attachEffectiveCosts({} as never, "c1", null, measured);
    expect(measured.lines[0].effective).toMatchObject({
      factor: "measured_prep",
      effective: 1,
    });
    const unmeasured = state(
      [line({ ingredient_id: "ing-rice", amount: 1 })],
      false
    );
    await attachEffectiveCosts({} as never, "c1", null, unmeasured);
    expect(unmeasured.lines[0].effective).toMatchObject({
      factor: "kitchen_buffer",
      effective: 1.05,
    });
  });
});
