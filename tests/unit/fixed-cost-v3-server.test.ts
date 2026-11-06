// v3 server rules: «desde factura» survives the repeat switch only while the
// amount is untouched; uploads default «Se repite cada mes» ON (one-offs OFF);
// the lines an upload approved can be read back after a reload. Demo data only.
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-memory-db";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

import { saveFixedCosts } from "@/lib/restaurant/fixed-costs-server";
import {
  approveDraft,
  createDraft,
  loadApprovedItems,
  undoApproval,
} from "@/lib/restaurant/fixed-cost-upload-server";
import {
  isOneTimeText,
  nextRepeats,
  parseGrid,
  type DraftLine,
} from "@/lib/restaurant/fixed-cost-upload";

const LOC = "00000000-0000-4000-8000-00000000000a";
const MONTH = "2026-10-01";
const row = (over: Record<string, unknown> = {}) => ({
  id: "fc1",
  company_id: "c1",
  location_id: LOC,
  month: MONTH,
  category: "planilla",
  label: "Nómina demo",
  amount: 21400,
  pct_of_sales: null,
  currency: "USD",
  source: "upload",
  status: "confirmed",
  repeats: false,
  split_rule: null,
  ...over,
});
const line = (over: Partial<DraftLine>): DraftLine => ({
  id: "l1",
  raw: "Nómina demo",
  category: "planilla",
  amount: 21400,
  month: MONTH,
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
  ...over,
});
const ctxOf = (db: ReturnType<typeof fakeSupabase>) => ({
  supabase: db.client,
  companyId: "c1",
  userId: "u1",
});

describe("saveFixedCosts keepSource", () => {
  const save = async (
    seed: Record<string, unknown>,
    entry: Record<string, unknown>
  ) => {
    const db = fakeSupabase({ restaurant_fixed_costs: [seed] });
    const res = await saveFixedCosts(ctxOf(db), {
      month: MONTH,
      locationId: LOC,
      entries: [
        { category: "planilla", label: "Nómina demo", ...entry },
      ] as never,
    });
    expect(res.ok).toBe(true);
    return db.tables.restaurant_fixed_costs[0];
  };

  it("same amount + keepSource: the source stays «upload» and the flag changes", async () => {
    const r = await save(row(), {
      value: 21400,
      repeats: true,
      keepSource: true,
    });
    expect(r).toMatchObject({ source: "upload", repeats: true, amount: 21400 });
  });

  it("a different amount with keepSource is the person's: source «manual»", async () => {
    const r = await save(row(), {
      value: 22000,
      repeats: true,
      keepSource: true,
    });
    expect(r).toMatchObject({ source: "manual", amount: 22000 });
  });

  it("without keepSource an edit is always «manual»", async () => {
    const r = await save(row(), { value: 21400, repeats: true });
    expect(r.source).toBe("manual");
  });

  it("impuestos: the rate decides, not the amount", async () => {
    const seed = row({
      category: "impuestos",
      label: "IVA",
      amount: null,
      pct_of_sales: 13,
    });
    const same = await save(seed, {
      category: "impuestos",
      label: "IVA",
      value: 13,
      repeats: true,
      keepSource: true,
    });
    expect(same.source).toBe("upload");
    const changed = await save(seed, {
      category: "impuestos",
      label: "IVA",
      value: 16,
      repeats: true,
      keepSource: true,
    });
    expect(changed.source).toBe("manual");
  });
});

describe("uploads default «Se repite cada mes» ON, one-offs OFF", () => {
  it("one-off concepts are recognised in es / en / de", () => {
    for (const t of [
      "Reparación de campana",
      "Deposit",
      "Depósito de garantía",
      "Installation fee",
      "Kaution",
      "Einmalig",
    ])
      expect(isOneTimeText(t), t).toBe(true);
    for (const t of ["Nómina", "Renta del local", "Luz", "Agua", "Seguro"])
      expect(isOneTimeText(t), t).toBe(false);
  });

  it("the sheet reader tags a one-off line", () => {
    const lines = parseGrid(
      [
        ["Concepto", "Monto"],
        ["Renta", 7000],
        ["Reparación de campana", 1200],
      ],
      {
        month: MONTH,
        scope: { kind: "group" },
        locations: [],
      }
    );
    expect(lines[0].oneTime).toBeUndefined();
    expect(lines[1].oneTime).toBe(true);
  });

  it("nextRepeats: ON for bills, OFF for a one-off, an add keeps the person's choice", () => {
    expect(nextRepeats([{}], false, null)).toBe(true);
    expect(nextRepeats([{ oneTime: true }], false, null)).toBe(false);
    expect(nextRepeats([{}, { oneTime: true }], false, null)).toBe(false);
    expect(nextRepeats([{}], true, true)).toBe(true);
    expect(nextRepeats([{}], true, false)).toBe(false);
    expect(nextRepeats([{ oneTime: true }], true, true)).toBe(false);
  });

  async function approve(
    lines: DraftLine[],
    seed: Record<string, unknown>[] = []
  ) {
    const db = fakeSupabase({ restaurant_fixed_costs: seed });
    const ctx = ctxOf(db);
    const draft = (await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: MONTH,
      locationId: LOC,
      lines,
    }))!;
    const res = await approveDraft(ctx, draft, {});
    if (!res.ok) throw new Error("approve");
    return { db, ctx, res };
  }

  it("an approved bill is saved with repeats ON and the answer says so", async () => {
    const { db, res } = await approve([line({})]);
    expect(db.tables.restaurant_fixed_costs[0].repeats).toBe(true);
    expect(res.applied[0].repeats).toBe(true);
  });

  it("an approved one-off is saved with repeats OFF", async () => {
    const { db, res } = await approve([
      line({ raw: "Reparación de campana", oneTime: true }),
    ]);
    expect(db.tables.restaurant_fixed_costs[0].repeats).toBe(false);
    expect(res.applied[0].repeats).toBe(false);
  });

  it("a one-off merged into a cluster turns that row OFF", async () => {
    const { db } = await approve([
      line({ id: "a", raw: "Luz", category: "servicios", amount: 1800 }),
      line({
        id: "b",
        raw: "Reparación de bomba",
        category: "servicios",
        amount: 500,
        oneTime: true,
      }),
    ]);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 2300,
      repeats: false,
    });
  });

  it("Deshacer restores the row's previous repeat flag", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [row({ source: "manual", repeats: false })],
    });
    const ctx = ctxOf(db);
    const draft = (await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: MONTH,
      locationId: LOC,
      lines: [line({ amount: 22100 })],
    }))!;
    const res = await approveDraft(ctx, draft, {
      lineIds: ["l1"],
      confirmed: ["l1"],
    });
    if (!res.ok) throw new Error("approve");
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 22100,
      repeats: true,
    });
    const undone = await undoApproval(ctx, res.draft, res.applied);
    expect(undone.ok).toBe(true);
    expect(db.tables.restaurant_fixed_costs[0]).toMatchObject({
      amount: 21400,
      repeats: false,
      source: "manual",
    });
  });
});

describe("the approved lines can be read back after a reload", () => {
  it("lists the newest upload's approved lines per cluster", async () => {
    const db = fakeSupabase({});
    const ctx = ctxOf(db);
    const draft = (await createDraft(ctx, {
      fileName: "costos-demo.csv",
      month: MONTH,
      locationId: LOC,
      lines: [
        line({ id: "a", raw: "Agua", category: "servicios", amount: 650 }),
        line({ id: "b", raw: "Seguro", category: "servicios", amount: 3250 }),
        line({
          id: "c",
          raw: "Otro mes",
          category: "otros",
          amount: 5,
          month: "2026-09-01",
        }),
      ],
    }))!;
    const ok = await approveDraft(ctx, draft, { lineIds: ["a", "b"] });
    expect(ok.ok).toBe(true);
    const items = await loadApprovedItems(ctx, {
      month: MONTH,
      locationId: LOC,
    });
    expect(items.servicios?.map((i) => [i.raw, i.amount])).toEqual([
      ["Agua", 650],
      ["Seguro", 3250],
    ]);
    expect(items.otros).toBeUndefined(); // another month
    const other = await loadApprovedItems(ctx, {
      month: MONTH,
      locationId: null,
    });
    expect(other).toEqual({}); // another scope
  });

  it("a company never reads another company's lines", async () => {
    const db = fakeSupabase({});
    const draft = (await createDraft(ctxOf(db), {
      fileName: "x.csv",
      month: MONTH,
      locationId: LOC,
      lines: [line({})],
    }))!;
    await approveDraft(ctxOf(db), draft, {});
    const items = await loadApprovedItems(
      { supabase: db.client, companyId: "c2", userId: "u2" },
      { month: MONTH, locationId: LOC }
    );
    expect(items).toEqual({});
  });
});
