// #407 · the editor flags preparations without a measured batch output and
// treats a prep nested under a measured one as covered. Demo data only.
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
  loadYieldsAt: async () => new Map(),
}));
vi.mock("@/lib/restaurant/nested-yield-server", () => ({
  loadPrepGraph: async () =>
    new Map([
      ["top", { id: "top", measured: true, children: ["mid"] }],
      ["mid", { id: "mid", measured: false, children: [] }],
      ["assumed", { id: "assumed", measured: false, children: [] }],
    ]),
}));

import { attachEffectiveCosts } from "@/lib/restaurant/effective-cost-server";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";

const line = (over: Record<string, unknown>) =>
  ({
    key: "k",
    kind: "ingredient",
    ingredient_id: null,
    component_id: null,
    name: "x",
    qty: 1,
    unit: "kg",
    amount: null,
    ...over,
  }) as never;
const base = (lines: unknown[], prep?: unknown): EditorState =>
  ({
    editable: true,
    lines,
    options: [],
    pending: 0,
    total_cost: null,
    ...(prep ? { preparation: prep } : {}),
  }) as never;

describe("nested yield in the editor", () => {
  it("flags a prep line with an assumed yield; not a measured one", async () => {
    const st = base([
      line({ kind: "component", component_id: "assumed", amount: 10 }),
      line({ kind: "component", component_id: "top", amount: 10 }),
    ]);
    await attachEffectiveCosts({} as never, "co", "loc-1", st);
    expect(st.lines[0].yield_missing).toBe(true);
    expect(st.lines[1].yield_missing).toBe(false);
  });

  it("plato lines get only the buffer", async () => {
    const st = base([line({ ingredient_id: "i1", amount: 100 })]);
    await attachEffectiveCosts({} as never, "co", "loc-1", st);
    expect(st.lines[0].effective).toMatchObject({
      factor: "kitchen_buffer",
      effective: 105,
    });
  });

  it("an unmeasured prep under a measured one: no factor, flagged itself", async () => {
    const st = base([line({ ingredient_id: "i1", amount: 100 })], {
      component_id: "mid",
      name: "Base demo",
      yield: { value: 1, unit: "unit", confirmed: false, source: "assumed" },
    });
    await attachEffectiveCosts({} as never, "co", "loc-1", st);
    expect(st.lines[0].effective?.factor).toBe("measured_prep");
    expect(st.preparation?.yield_missing).toBe(true);
  });

  it("a missing price stays null, not $0", async () => {
    const st = base([line({ ingredient_id: "i1", amount: null })]);
    await attachEffectiveCosts({} as never, "co", "loc-1", st);
    expect(st.lines[0].effective?.effective).toBeNull();
  });
});
