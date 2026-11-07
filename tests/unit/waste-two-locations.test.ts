// Purchases are company-wide, waste is per restaurant: with two restaurants the
// plan-vs-reported line uses the waste of BOTH and says so. And the cost entry
// read orders newest first and keeps entries by effective date.
import { describe, expect, it } from "vitest";
import {
  loadPlanVsReported,
  loadWasteSummary,
  valueIngredientWaste,
} from "@/lib/restaurant/unplanned-waste-server";
import { planVsReported } from "@/lib/restaurant/unplanned-waste";

function fake(
  tables: Record<string, unknown[]>,
  calls: Array<[string, unknown[]]>
) {
  return {
    from: (name: string) => {
      const q: Record<string, unknown> = {};
      const rec =
        (m: string) =>
        (...a: unknown[]) => {
          calls.push([`${name}.${m}`, a]);
          return q;
        };
      for (const m of ["select", "eq", "in", "gte", "lte", "or", "order"])
        q[m] = rec(m);
      q.limit = async () => ({ data: tables[name] ?? [], error: null });
      return q;
    },
  } as never;
}

describe("two restaurants", () => {
  it("the waste read takes every location id", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const r = await loadWasteSummary(
      fake(
        {
          kitchen_waste_lines: [
            { status: "confirmed", value: 60 },
            { status: "confirmed", value: 40 },
          ],
        },
        calls
      ),
      "c",
      ["loc-a", "loc-b"],
      "2026-10-01",
      "2026-10-26"
    );
    expect(calls).toContainEqual([
      "kitchen_waste_lines.in",
      ["location_id", ["loc-a", "loc-b"]],
    ]);
    expect(r.available && r.summary.amount).toBe(100);
  });

  it("the plan line is marked «all restaurants» and compares company purchases", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const out = await loadPlanVsReported(
      fake(
        {
          ingredient_cost_entries: [{ ingredient_id: "i1", total_cost: 1000 }],
          ingredient_yields: [],
          kitchen_buffer_settings: [],
        },
        calls
      ),
      "c",
      "loc-a",
      "2026-10-01",
      "2026-10-26",
      100,
      true
    );
    expect(out?.allRestaurants).toBe(true);
    expect(out?.reportedPct).toBe(10);
  });

  it("a single restaurant carries no «all restaurants» mark", () => {
    expect(
      planVsReported({ purchases: 100, planned: 5, reported: 8 })
    ).not.toHaveProperty("allRestaurants");
  });
});

describe("price lookup for a report day", () => {
  it("orders newest first before the limit and keeps entries by effective date", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const v = await valueIngredientWaste(
      fake(
        {
          ingredient_cost_entries: [
            // cost_date later than the report day, but effective on it
            {
              ingredient_id: "i1",
              effective_date: "2026-10-10",
              cost_date: "2026-10-15",
              created_at: "2026-10-15T00:00:00Z",
              normalized_unit_cost: 6,
              normalized_unit: "kg",
              unit_cost: 6,
              source_type: "invoice",
            },
          ],
        },
        calls
      ),
      "c",
      "i1",
      "2026-10-12",
      2,
      "kg"
    );
    expect(v?.value).toBe(12);
    const orders = calls.filter(([k]) => k.endsWith(".order"));
    expect(orders[0][1][0]).toBe("effective_date");
    expect(orders[0][1][1]).toMatchObject({ ascending: false });
    const or = calls.find(([k]) => k.endsWith(".or"))![1][0] as string;
    expect(or).toContain("effective_date.lte.2026-10-12");
    expect(or).toContain(
      "and(effective_date.is.null,cost_date.lte.2026-10-12)"
    );
  });
});
