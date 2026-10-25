// Quantity calculated from a read unit price and line total (synthetic data).
import { describe, expect, it } from "vitest";
import { createInvoiceDraft } from "@/lib/restaurant/invoice-draft";
import {
  deriveQuantityFromTotal,
  enrichExtraction,
  type ExtractedInvoice,
} from "@/lib/restaurant/invoice-extraction";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

function line(over: Partial<ExtractedInvoice["lines"][number]> = {}) {
  return {
    description: "pollo",
    supplier_item_name: null,
    supplier_sku: null,
    quantity: null as number | null,
    unit: "kg" as string | null,
    unit_cost: 1.9 as number | null,
    line_total: 28.5 as number | null,
    tax_amount: null,
    ...over,
  };
}
function inv(lines: ExtractedInvoice["lines"]): ExtractedInvoice {
  return {
    supplier_name: "Proveedor Demo",
    invoice_number: null,
    invoice_date: "2026-03-04",
    due_date: null,
    currency: null,
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    lines,
    confidence_notes: [],
  };
}
const base = {
  companyId: "co-1",
  userId: null,
  sourceType: "image" as const,
  originalFileName: null,
};
async function run(lines: ExtractedInvoice["lines"], strictPrices = true) {
  const store: FakeStore = {};
  const r = await createInvoiceDraft(makeFakeDb(store) as never, {
    ...base,
    extraction: inv(lines),
    strictPrices,
  });
  return { store, r };
}

describe("deriveQuantityFromTotal (exact to the cent)", () => {
  it("accepts 28.50 / 1.90 = 15", () => {
    expect(deriveQuantityFromTotal(1.9, 28.5)).toBe(15);
  });
  it("rejects 28.47 / 1.90 (14.98 x 1.90 = 28.46)", () => {
    expect(deriveQuantityFromTotal(1.9, 28.47)).toBeNull();
  });
  it("rejects missing, zero and negative inputs", () => {
    expect(deriveQuantityFromTotal(null, 5)).toBeNull();
    expect(deriveQuantityFromTotal(0, 5)).toBeNull();
    expect(deriveQuantityFromTotal(2, 0)).toBeNull();
    expect(deriveQuantityFromTotal(2, -4)).toBeNull();
  });
});

describe("enrichExtraction derived_quantity", () => {
  it("derives the quantity and flags it", () => {
    const e = enrichExtraction(inv([line()])).lines[0];
    expect(e.quantity).toBe(15);
    expect(e.derived_quantity).toBe(true);
    expect(e.missing_quantity).toBe(false);
    expect(e.derived_unit_cost).toBe(false);
    expect(e.derived_line_total).toBe(false);
  });
  it("leaves quantity null when not exact", () => {
    const e = enrichExtraction(inv([line({ line_total: 28.47 })])).lines[0];
    expect(e.quantity).toBeNull();
    expect(e.derived_quantity).toBeUndefined();
  });
  it("does not flag a quantity that was read", () => {
    const e = enrichExtraction(inv([line({ quantity: 15 })])).lines[0];
    expect(e.quantity).toBe(15);
    expect(e.derived_quantity).toBeUndefined();
  });
});

describe("createInvoiceDraft strict with a calculable quantity", () => {
  it("inserts the line and notes the calculation", async () => {
    const { store, r } = await run([line()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linesInserted).toBe(1);
    expect(r.linesSkipped).toEqual([]);
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 15,
      unit: "kg",
      line_total: 28.5,
    });
    const notes = String(store.supplier_invoices[0].notes);
    expect(notes).toContain(
      "Cantidad calculada de total ÷ precio: pollo = 28.50 ÷ 1.90 = 15"
    );
    expect(notes).not.toContain("sin cantidad");
  });

  it("also works on an already enriched line, with one note only", async () => {
    const enriched = enrichExtraction(
      inv([line()])
    ) as never as ExtractedInvoice;
    const store: FakeStore = {};
    await createInvoiceDraft(makeFakeDb(store) as never, {
      ...base,
      extraction: enriched,
      strictPrices: true,
    });
    const notes = String(store.supplier_invoices[0].notes);
    expect(notes.match(/Cantidad calculada/g)).toHaveLength(1);
  });

  it("still skips for a missing unit (no invented unit)", async () => {
    const { r, store } = await run([
      line(),
      line({ description: "res", unit: null }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linesSkipped).toEqual([{ description: "res", reason: "no_unit" }]);
    const notes = String(store.supplier_invoices[0].notes);
    expect(notes).not.toContain("res =");
    expect(notes).toContain(
      "Líneas sin unidad legible (leídas de la foto): res"
    );
  });

  it("splits sin precio / sin cantidad and orders the sections", async () => {
    const { r, store } = await run([
      line(),
      line({ description: "limón", line_total: 28.47 }),
      line({ description: "sal", unit_cost: null, line_total: null }),
      line({ description: "ajo", unit: null, quantity: 2 }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linesSkipped.map((s) => s.reason)).toEqual([
      "no_quantity",
      "no_price",
      "no_unit",
    ]);
    const notes = String(store.supplier_invoices[0].notes).split("\n");
    expect(notes).toEqual([
      "Cantidad calculada de total ÷ precio: pollo = 28.50 ÷ 1.90 = 15",
      "Líneas sin precio (leídas de la foto): sal",
      "Líneas sin cantidad (leídas de la foto): limón",
      "Líneas sin unidad legible (leídas de la foto): ajo",
    ]);
  });
});

describe("createInvoiceDraft strictPrices:false is unchanged", () => {
  it("coerces a null quantity to 1 and does not derive", async () => {
    const { r, store } = await run([line()], false);
    expect(r.ok).toBe(true);
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 1,
      unit: "kg",
      line_total: 28.5,
    });
    expect(String(store.supplier_invoices[0].notes ?? "")).not.toContain(
      "Cantidad calculada"
    );
  });
});
