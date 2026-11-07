// Reading never writes; the group share is counted once. Synthetic data only.
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import {
  groupSharesFor,
  loadFixedCostsView,
  listFixedCostHistory,
} from "@/lib/restaurant/fixed-costs-server";
import {
  effectiveFixedCosts,
  splitGroupAmount,
} from "@/lib/restaurant/fixed-costs";
import { computeFixedFigures } from "@/lib/restaurant/fixed-cost-engine";

const CO = "c1";
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const L3 = "00000000-0000-4000-8000-000000000003";
const OCT = "2026-10-01";
const NOV = "2026-11-01";

const row = (
  loc: string | null,
  category: string,
  amount: number,
  month = OCT,
  over = {}
) => ({
  id: `${loc}-${category}-${month}`,
  company_id: CO,
  location_id: loc,
  month,
  category,
  label: null,
  amount: category === "impuestos" ? null : amount,
  pct_of_sales: category === "impuestos" ? amount : null,
  currency: "USD",
  source: "upload",
  status: "confirmed",
  repeats: true,
  split_rule: loc === null ? "equal" : null,
  version: 1001,
  detail_state: "legacy_total",
  copy_source: null,
  ...over,
});

/** The fake client plus an `rpc` that only knows the read-only preview and records calls. */
function client(seed: Record<string, any[]>) {
  const db = fakeSupabase(seed);
  const rpcCalls: string[] = [];
  const supabase = {
    ...(db.client as object),
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return { data: null, error: { code: "FC403", message: "forbidden" } };
    },
  } as never;
  return { db, supabase, rpcCalls };
}

describe("rendering never writes (no auto-copy, no history, no drafts)", () => {
  it("loading November, an older month and the history produces zero mutations", async () => {
    const seed = {
      restaurant_fixed_costs: [
        row(L1, "alquiler", 6500),
        row(L1, "servicios", 4800),
        row(L1, "planilla", 21400),
      ],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [],
      fixed_cost_items: [],
    };
    const { db, supabase, rpcCalls } = client(seed);
    const before = JSON.stringify(seed);
    for (const month of [NOV, OCT, "2026-08-01"]) {
      await loadFixedCostsView(
        { supabase, companyId: CO, userId: "u1" },
        {
          month,
          locationId: L1,
          brandId: null,
          restaurantIds: [L1],
          marginRead: { ok: false, reason: "x" },
        }
      );
      await listFixedCostHistory(supabase, CO, { locationId: L1, month });
    }
    expect(db.writes).toEqual([]);
    expect(
      JSON.stringify(
        Object.fromEntries(Object.keys(seed).map((k) => [k, db.tables[k]]))
      )
    ).toBe(before);
    // The only database function a view may call is the read-only copy preview.
    expect(new Set(rpcCalls)).toEqual(new Set(["fixed_cost_preview_copy"]));
    // November has nothing it did not have: October's costs are NOT copied by looking.
    const nov = db.tables.restaurant_fixed_costs.filter((r) => r.month === NOV);
    expect(nov).toEqual([]);
  });

  it("the Costos page and loaders contain no writer at all", async () => {
    const { readFileSync } = await import("fs");
    for (const f of [
      "app/dashboard/restaurant/costs/page.tsx",
      "lib/restaurant/fixed-costs-server.ts",
      "lib/restaurant/rentabilidad-server.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(
        /\.(insert|update|delete|upsert)\(|saveTotals|approveUpload|copyMonth|undoCommand|itemCommand/
      );
    }
  });
});

describe("group allocation: counted once, to the cent", () => {
  it("shares of every restaurant add up to the group total (equal split, 3 restaurants)", async () => {
    const { supabase } = client({
      restaurant_fixed_costs: [
        row(null, "servicios", 10000),
        row(null, "alquiler", 8000.01),
      ],
    });
    const ids = [L1, L2, L3];
    let sumServicios = 0;
    let sumAlquiler = 0;
    for (const id of ids) {
      const g = await groupSharesFor(supabase, CO, OCT, id, ids);
      sumServicios += Math.round((g.shares.servicios ?? 0) * 100);
      sumAlquiler += Math.round((g.shares.alquiler ?? 0) * 100);
    }
    expect(sumServicios).toBe(1000000);
    expect(sumAlquiler).toBe(800001); // largest remainder: not a cent lost or invented
  });

  it("a single-location company gets 100% of the group costs; a restaurant never doubles its own", async () => {
    const { supabase } = client({
      restaurant_fixed_costs: [
        row(null, "servicios", 8000),
        row(null, "alquiler", 10000),
        row(null, "planilla", 2500),
        row(null, "otros", 500),
        row(L1, "servicios", 4800),
      ],
    });
    const g = await groupSharesFor(supabase, CO, OCT, L1, [L1]);
    expect(g.shares).toEqual({
      servicios: 8000,
      alquiler: 10000,
      planilla: 2500,
      otros: 500,
    });
    // own Servicios 4,800 + the group's 8,000 once = 12,800; never 4,800 + 8,000 + 8,000.
    const own = [
      { category: "servicios" as const, amount: 4800, pct_of_sales: null },
    ];
    expect(effectiveFixedCosts(own, g.shares, null).amounts.servicios).toBe(
      12800
    );
  });

  it("with several locations each restaurant carries only its share, and the group view carries none", async () => {
    const { supabase } = client({
      restaurant_fixed_costs: [row(null, "servicios", 9000)],
    });
    const ids = [L1, L2, L3];
    const shares = await Promise.all(
      ids.map((id) => groupSharesFor(supabase, CO, OCT, id, ids))
    );
    expect(shares.map((s) => s.shares.servicios)).toEqual([3000, 3000, 3000]);
    // A restaurant that is not one of the active ones receives nothing.
    const outsider = await groupSharesFor(supabase, CO, OCT, "x", ids);
    expect(outsider.shares).toEqual({});
  });

  it("the sales rule is largest-remainder and falls back to equal without sales (existing rule, unchanged)", () => {
    const shares = splitGroupAmount(100, "sales", [
      { location_id: L1, sales: 1 },
      { location_id: L2, sales: 1 },
      { location_id: L3, sales: 1 },
    ]);
    expect(shares.reduce((n, s) => n + Math.round(s.amount * 100), 0)).toBe(
      10000
    );
    const none = splitGroupAmount(90, "sales", [
      { location_id: L1, sales: null },
      { location_id: L2, sales: null },
    ]);
    expect(none.map((s) => s.amount)).toEqual([45, 45]);
  });

  it("only CONFIRMED group lines count in the figure (same inputs in Costos and Rentabilidad)", async () => {
    const { supabase } = client({
      restaurant_fixed_costs: [
        row(null, "servicios", 9000, OCT, { status: "draft" }),
        row(null, "alquiler", 2000),
      ],
    });
    const g = await groupSharesFor(supabase, CO, OCT, L1, [L1], {
      confirmedOnly: true,
    });
    expect(g.shares).toEqual({ alquiler: 2000 });
  });

  it("the inherited group tax is labelled as inherited, not merged into a local rate", () => {
    const f = computeFixedFigures({
      month: NOV,
      costs: effectiveFixedCosts([], { servicios: 100 }, 15),
      taxSource: "group",
      margin: { sales: 1000, foodCost: 300 },
      openDays: 30,
    });
    expect(f.tax).toEqual({ kind: "group", month: NOV, rate: 15 });
  });
});
