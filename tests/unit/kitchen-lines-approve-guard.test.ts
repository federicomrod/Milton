// A line the kitchen could only half read (no price, or «Falta» quantity/unit)
// holds PLACEHOLDERS (quantity 1, unit «unidad», total 0). They must never be
// approved or posted as if they had been read: no $0 cost entry, no invented
// quantity. A fully read line posts as before.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";
import { getDictionary } from "@/lib/i18n";

const CO = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";
const ING = "33333333-3333-4333-8333-333333333333";
const L_FULL = "44444444-4444-4444-8444-444444444441";
const L_NOPRICE = "44444444-4444-4444-8444-444444444442";
const L_NOQTY = "44444444-4444-4444-8444-444444444443";

const h = vi.hoisted(() => ({ db: null as unknown as { client: unknown } }));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: h.db.client,
    companyId: "11111111-1111-4111-8111-111111111111",
    userId: "55555555-5555-4555-8555-555555555555",
  }),
}));
vi.mock("@/lib/auth/permissions", () => ({
  resolveActor: async () => ({}),
  requireCapability: () => null,
}));
vi.mock("@/lib/restaurant/api-lang", () => ({
  apiDictionary: async () => (await import("@/lib/i18n")).getDictionary("es"),
}));

import { POST as approvePOST } from "@/app/api/restaurant/invoices/[id]/approve/route";
import { POST as linePOST } from "@/app/api/restaurant/invoices/[id]/lines/route";

const line = (id: string, over: Record<string, unknown>) => ({
  id,
  company_id: CO,
  invoice_id: INV,
  supplier_id: null,
  ingredient_id: ING,
  supplier_item_name: null,
  supplier_sku: null,
  description: "pan",
  quantity: 1,
  unit: "kg",
  unit_cost: null,
  line_total: 0,
  tax_amount: null,
  match_status: "matched",
  review_status: "approved",
  notes: null,
  created_at: "2026-10-30T10:00:00Z",
  ...over,
});

function seed(lines: Record<string, unknown>[]): FakeDb {
  return createFakeDb({
    supplier_invoices: [
      {
        id: INV,
        company_id: CO,
        supplier_id: null,
        invoice_number: null,
        invoice_date: "2026-10-30",
        currency: "USD",
        status: "needs_review",
        notes: "Actualización de precio",
      },
    ],
    supplier_invoice_lines: lines,
    ingredients: [{ id: ING, company_id: CO, default_unit: "kg" }],
    ingredient_cost_entries: [],
    invoice_events: [],
  });
}
const ctx = { params: Promise.resolve({ id: INV }) };
const approve = () =>
  approvePOST(
    new NextRequest(`http://localhost/api/restaurant/invoices/${INV}/approve`, {
      method: "POST",
    }),
    ctx
  );
const patchLine = (body: Record<string, unknown>) =>
  linePOST(
    new NextRequest(`http://localhost/api/restaurant/invoices/${INV}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx
  );
type AnyRow = any;
const costs = (): AnyRow[] =>
  (h.db as unknown as FakeDb).tables.ingredient_cost_entries;
const lineRow = (id: string): AnyRow =>
  (h.db as unknown as FakeDb).tables.supplier_invoice_lines.find(
    (l) => l.id === id
  );
const es = getDictionary("es").costs.api;
const en = getDictionary("en").costs.api;
const de = getDictionary("de").costs.api;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("posting never turns a placeholder into a real number", () => {
  it("(a) an unpriced kitchen line that was approved is skipped: no cost entry, listed in skipped_lines", async () => {
    h.db = seed([
      line(L_FULL, {
        description: "harina",
        quantity: 3,
        unit: "kg",
        unit_cost: 2,
        line_total: 6,
      }),
      line(L_NOPRICE, {
        description: "tomates",
        notes: "[falta:cantidad,unidad]",
      }),
    ]);
    const res = await approve();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(costs()).toHaveLength(1);
    expect(costs()[0]).toMatchObject({
      source_id: L_FULL,
      quantity: 3,
      total_cost: 6,
      unit_cost: 2,
    });
    expect(costs().some((c) => c.unit_cost === 0)).toBe(false);
    expect(body.skipped_lines).toEqual([
      expect.objectContaining({
        line_id: L_NOPRICE,
        reason: es.lineIncomplete,
      }),
    ]);
  });

  it("an unpriced line WITHOUT a marker (price empty, total 0) is skipped too, and alone it posts nothing", async () => {
    h.db = seed([line(L_NOPRICE, { description: "tomates" })]);
    const res = await approve();
    expect(res.status).toBe(400);
    expect((await res.json()).skipped_lines[0].reason).toBe(es.lineIncomplete);
    expect(costs()).toHaveLength(0);
  });

  it("a priced line whose quantity is still «Falta» is skipped (its price is not a total)", async () => {
    h.db = seed([
      line(L_NOQTY, {
        description: "pan",
        unit_cost: 2,
        line_total: 2,
        notes: "[falta:cantidad]",
      }),
    ]);
    const res = await approve();
    expect(res.status).toBe(400);
    expect(costs()).toHaveLength(0);
  });

  it("(c) a fully read line posts exactly as before, and a [falta] note never reaches the cost entry", async () => {
    h.db = seed([
      line(L_FULL, {
        description: "harina",
        quantity: 3,
        unit: "kg",
        unit_cost: 2,
        line_total: 6,
        notes: "revisado [falta:otra]",
      }),
    ]);
    const res = await approve();
    expect(res.status).toBe(200);
    expect(costs()).toHaveLength(1);
    expect(costs()[0]).toMatchObject({
      quantity: 3,
      total_cost: 6,
      unit: "kg",
    });
    expect(costs()[0].notes).not.toContain("[falta");
  });

  it("a [falta:…] marker is stripped from the note copied into a cost entry", async () => {
    // A marker the manager already cleared in quantity but left in the text.
    const { stripMissing } = await import("@/lib/restaurant/invoice-missing");
    expect(stripMissing("llegó tarde [falta:unidad]")).toBe("llegó tarde");
    expect(stripMissing("[falta:cantidad,unidad]")).toBeNull();
    expect(stripMissing(null)).toBeNull();
  });
});

describe("approving a line in Revisar", () => {
  it("(b) a priced line with [falta:cantidad] cannot be approved; once the quantity is filled it can, and posts that quantity", async () => {
    h.db = seed([
      line(L_NOQTY, {
        review_status: "pending",
        description: "pan",
        unit_cost: 2,
        line_total: 2,
        notes: "[falta:cantidad,unidad]",
      }),
    ]);
    const refused = await patchLine({
      line_id: L_NOQTY,
      review_status: "approved",
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe(es.lineIncomplete);
    expect(lineRow(L_NOQTY).review_status).toBe("pending");

    // Quantity alone is not enough while the unit is still «Falta».
    const half = await patchLine({
      line_id: L_NOQTY,
      review_status: "approved",
      quantity: 3,
    });
    expect(half.status).toBe(400);

    // Quantity and unit in the same PATCH clear the marker: allowed.
    const ok = await patchLine({
      line_id: L_NOQTY,
      review_status: "approved",
      quantity: 3,
      unit: "kg",
    });
    expect(ok.status).toBe(200);
    expect(lineRow(L_NOQTY)).toMatchObject({
      review_status: "approved",
      quantity: 3,
      unit: "kg",
      line_total: 6,
      notes: null,
    });

    const res = await approve();
    expect(res.status).toBe(200);
    expect(costs()).toHaveLength(1);
    expect(costs()[0]).toMatchObject({
      quantity: 3,
      unit: "kg",
      unit_cost: 2,
      total_cost: 6,
    });
  });

  it("a line with no price cannot be approved until a price is given in the same PATCH", async () => {
    h.db = seed([
      line(L_NOPRICE, {
        review_status: "pending",
        description: "tomates",
        notes: "[falta:cantidad,unidad]",
      }),
    ]);
    const refused = await patchLine({
      line_id: L_NOPRICE,
      review_status: "approved",
      quantity: 2,
      unit: "kg",
    });
    expect(refused.status).toBe(400);
    const ok = await patchLine({
      line_id: L_NOPRICE,
      review_status: "approved",
      quantity: 2,
      unit: "kg",
      unit_cost: 1.5,
      line_total: 3,
    });
    expect(ok.status).toBe(200);
  });

  it("other edits to an incomplete line (rejecting it, fixing the name) are still allowed", async () => {
    h.db = seed([
      line(L_NOPRICE, {
        review_status: "pending",
        description: "tomates",
        notes: "[falta:cantidad,unidad]",
      }),
    ]);
    expect(
      (await patchLine({ line_id: L_NOPRICE, review_status: "rejected" }))
        .status
    ).toBe(200);
  });
});

describe("the new strings exist in es / en / de", () => {
  it("(d) lineIncomplete (API) and completeHint (Revisar) are written in all three, and differ", () => {
    expect([es.lineIncomplete, en.lineIncomplete, de.lineIncomplete]).toEqual([
      expect.stringMatching(/precio o la cantidad/),
      expect.stringMatching(/price or quantity/),
      expect.stringMatching(/Preis oder Menge/),
    ]);
    const hints = ["es", "en", "de"].map(
      (l) => getDictionary(l as "es").costs.invoices.completeHint as string
    );
    expect(new Set(hints).size).toBe(3);
    expect(hints[0]).toBe("Completa precio / cantidad");
    for (const t of [
      ...hints,
      es.lineIncomplete,
      en.lineIncomplete,
      de.lineIncomplete,
    ]) {
      expect(t.trim().length).toBeGreaterThan(5);
    }
  });
});
