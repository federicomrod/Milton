// The single source of truth behind the Costos fijos cards: confirmed cluster
// amounts → total, missing count and break-even; the review list's statuses;
// «Sumar» on the server. Demo data only.
import { describe, expect, it, vi } from "vitest";
import {
  approvableAll,
  clusterAfter,
  clustersFromLines,
  figuresOf,
  fileProposal,
  lineStatuses,
  needsOf,
  sortForReview,
  vsLastMonth,
} from "@/lib/restaurant/fixed-cost-clusters";
import {
  planApproval,
  keyOfLine,
  type DraftLine,
} from "@/lib/restaurant/fixed-cost-upload";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import {
  approveDraft,
  createDraft,
  editDraft,
} from "@/lib/restaurant/fixed-cost-upload-server";

const LOC = "00000000-0000-4000-8000-00000000000a";
const screen = { month: "2026-10-01", locationId: LOC };
const line = (over: Partial<DraftLine>): DraftLine => ({
  id: "l1",
  raw: "Nómina",
  category: "planilla",
  amount: 22100,
  month: "2026-10-01",
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
  ...over,
});
const margin = { sales: 100000, foodCost: 30000 };
const figures = (clusters = {}, extra = {}) =>
  figuresOf({
    clusters,
    groupShares: {},
    groupImpuestosPct: null,
    margin,
    openDays: 30,
    ...extra,
  });
const c = (value: number, source = "upload") => ({
  value,
  source,
  label: null,
});

describe("figuresOf: everything derives from the confirmed clusters", () => {
  it("nothing confirmed: empty, no total, no break-even (never $0, never a fake figure)", () => {
    const f = figures();
    expect(f.empty).toBe(true);
    expect(f.fixed).toEqual({ total: null, missingCount: 4 });
    expect(f.breakEven).toBeNull();
  });

  it("break-even = confirmed ÷ (margin % × open days) and moves with every cluster", () => {
    const a = figures({ planilla: c(21000) });
    const b = figures({ planilla: c(21000), alquiler: c(8400) });
    expect(a.breakEven).toBeCloseTo(21000 / (0.7 * 30), 6);
    expect(b.breakEven).toBeCloseTo(29400 / (0.7 * 30), 6);
    expect(b.breakEven).not.toBe(a.breakEven);
    expect(a.partial).toBe(true);
    expect(a.missingAmounts).toEqual(["alquiler", "servicios", "otros"]);
  });

  it("all four amounts in: not partial; the tax rate comes out of the margin once", () => {
    const all = {
      planilla: c(21000),
      alquiler: c(8400),
      servicios: c(2450),
      otros: c(500),
    };
    const noTax = figures(all);
    const withTax = figures({ ...all, impuestos: c(10) });
    expect(noTax.partial).toBe(false);
    expect(noTax.fixed.total).toBe(32350);
    expect(withTax.breakEven as number).toBeGreaterThan(
      noTax.breakEven as number
    );
    expect(withTax.fixed.total).toBe(32350); // impuestos is not an amount
  });

  it("a group share counts as a confirmed amount for a restaurant", () => {
    const f = figures({}, { groupShares: { servicios: 500 } });
    expect(f.empty).toBe(false);
    expect(f.fixed.total).toBe(500);
  });

  it("no margin: a total, but no break-even", () => {
    expect(
      figures({ planilla: c(100) }, { margin: null }).breakEven
    ).toBeNull();
  });

  it("clustersFromLines reads amounts, and the rate for impuestos", () => {
    const m = clustersFromLines([
      {
        category: "planilla",
        amount: 100,
        pct_of_sales: null,
        source: "manual",
        label: null,
      },
      {
        category: "impuestos",
        amount: null,
        pct_of_sales: 13,
        source: "upload",
        label: "IVA",
      },
    ]);
    expect(m.planilla?.value).toBe(100);
    expect(m.impuestos).toMatchObject({
      value: 13,
      source: "upload",
      label: "IVA",
    });
  });
});

describe("the review list statuses", () => {
  it("Falta says what is missing, restaurant first", () => {
    expect(needsOf(line({ scope: null }))).toBe("restaurant");
    expect(needsOf(line({ category: null }))).toBe("category");
    expect(needsOf(line({ amount: null }))).toBe("amount");
    expect(needsOf(line({ month: null }))).toBe("month");
    expect(needsOf(line({}))).toBeNull();
  });

  it("duplicated tax rates are Falta «duplicate»", () => {
    const s = lineStatuses(
      [
        line({ id: "a", category: "impuestos", amount: 10 }),
        line({ id: "b", category: "impuestos", amount: 6 }),
      ],
      {},
      screen
    );
    expect(s.get("a")).toEqual({ kind: "falta", needs: "duplicate" });
  });

  it("a cluster with a confirmed amount from elsewhere is a diff; an empty one is ready", () => {
    const lines = [line({})];
    expect(lineStatuses(lines, {}, screen).get("l1")?.kind).toBe("ready");
    expect(
      lineStatuses(lines, { planilla: c(21400, "manual") }, screen).get("l1")
    ).toEqual({
      kind: "diff",
      today: 21400,
      proposes: 22100,
      sum: 43500,
    });
  });

  it("this upload's own earlier approvals add silently (no diff)", () => {
    const lines = [
      line({
        id: "luz",
        raw: "Luz",
        category: "servicios",
        amount: 1800,
        status: "approved",
      }),
      line({ id: "agua", raw: "Agua", category: "servicios", amount: 650 }),
    ];
    const s = lineStatuses(lines, { servicios: c(1800, "upload") }, screen);
    expect(s.get("agua")?.kind).toBe("ready");
    // …but not if the card was edited by hand since
    expect(
      lineStatuses(lines, { servicios: c(1900, "manual") }, screen).get("agua")
        ?.kind
    ).toBe("diff");
  });

  it("a rate is never summed: no «sum» for impuestos", () => {
    const s = lineStatuses(
      [line({ category: "impuestos", amount: 16 })],
      { impuestos: c(13, "manual") },
      screen
    );
    expect(s.get("l1")).toMatchObject({ kind: "diff", sum: null });
  });

  it("the same amount as today is not a diff", () => {
    expect(
      lineStatuses(
        [line({ amount: 21400 })],
        { planilla: c(21400, "manual") },
        screen
      ).get("l1")?.kind
    ).toBe("ready");
  });

  it("«Aprobar todo» counts only ready lines; diffs wait and are counted apart; 0 stays 0", () => {
    const lines = [
      line({ id: "a", category: "alquiler", amount: 7000 }),
      line({ id: "b", category: "planilla", amount: 22100 }),
      line({ id: "c", category: null }),
    ];
    const st = lineStatuses(lines, { planilla: c(21400, "manual") }, screen);
    expect(approvableAll(lines, st)).toEqual({
      ids: ["a"],
      count: 1,
      total: 7000,
      deciding: 1,
    });
    const none = lineStatuses([line({ category: null })], {}, screen);
    expect(approvableAll([line({ category: null })], none).count).toBe(0);
  });

  it("Falta lines are listed first", () => {
    const lines = [line({ id: "ok" }), line({ id: "bad", category: null })];
    const st = lineStatuses(lines, {}, screen);
    expect(sortForReview(lines, st).map((l) => l.id)).toEqual(["bad", "ok"]);
  });

  it("fileProposal and vsLastMonth", () => {
    const lines = [
      line({
        id: "a",
        category: "servicios",
        amount: 1800,
        status: "approved",
      }),
      line({ id: "b", category: "servicios", amount: 650 }),
    ];
    const st = lineStatuses(lines, {}, screen);
    expect(fileProposal(lines, "servicios", st, screen)).toBe(2450);
    expect(vsLastMonth(11200, 10000)).toBeCloseTo(0.12);
    expect(vsLastMonth(100, undefined)).toBeNull();
    expect(vsLastMonth(100, 0)).toBeNull();
  });

  it("clusterAfter: replace ignores today, add sums, a rate is the last one", () => {
    const two = [line({ amount: 100 }), line({ id: "x", amount: 50 })];
    expect(clusterAfter("planilla", 1000, two, "add")).toBe(1150);
    expect(clusterAfter("planilla", 1000, two, "replace")).toBe(150);
    expect(
      clusterAfter(
        "impuestos",
        13,
        [line({ category: "impuestos", amount: 16 })],
        "add"
      )
    ).toBe(16);
  });
});

describe("server: Sumar adds to a value from elsewhere", () => {
  const existing = new Map([
    [
      keyOfLine(line({})),
      {
        amount: 21400,
        pct_of_sales: null,
        source: "manual",
        label: "Nómina junio",
      },
    ],
  ]);

  it("without a choice it is a conflict; Reemplazar is the confirm; Sumar adds", () => {
    const plain = planApproval([line({})], existing);
    expect(plain.conflicts).toHaveLength(1);
    const added = planApproval(
      [line({})],
      existing,
      [],
      new Set([keyOfLine(line({}))])
    );
    expect(added.conflicts).toHaveLength(0);
    expect(added.writes[0].line.amount).toBe(43500);
    expect(added.writes[0].line.raw).toBe("Nómina junio + Nómina");
  });

  it("a rate is never added even if asked", () => {
    const k = keyOfLine(line({ category: "impuestos" }));
    const ex = new Map([
      [k, { amount: null, pct_of_sales: 13, source: "manual" }],
    ]);
    const r = planApproval(
      [line({ category: "impuestos", amount: 16 })],
      ex,
      [],
      new Set([k])
    );
    expect(r.conflicts).toHaveLength(1);
  });

  it("approveDraft with adds writes today + invoice", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [
        {
          id: "fc1",
          company_id: "c1",
          location_id: LOC,
          month: "2026-10-01",
          category: "planilla",
          label: "Nómina junio",
          amount: 21400,
          pct_of_sales: null,
          source: "manual",
        },
      ],
    });
    const ctx = { supabase: db.client, companyId: "c1", userId: "u1" };
    const draft = (await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({})],
    }))!;
    const res = await approveDraft(ctx, draft, {
      lineIds: ["l1"],
      adds: ["l1"],
    });
    expect(res.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 43500,
      source: "upload",
    });
  });
});

describe("server: answering ¿A qué restaurante? edits the draft line", () => {
  it("scope and month are saved on a pending line only", async () => {
    const db = fakeSupabase({});
    const ctx = { supabase: db.client, companyId: "c1", userId: "u1" };
    const draft = (await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: "2026-10-01",
      locationId: LOC,
      lines: [line({ scope: null, month: null })],
    }))!;
    const next = await editDraft(ctx, draft, [
      {
        lineId: "l1",
        scope: { kind: "restaurant", locationId: LOC },
        month: "2026-10-01",
      },
    ]);
    expect(next?.lines[0]).toMatchObject({
      scope: { kind: "restaurant", locationId: LOC },
      month: "2026-10-01",
    });
  });
});
