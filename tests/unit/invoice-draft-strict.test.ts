// createInvoiceDraft (strict Telegram path + the unchanged route path) and
// invoiceExistsForKitchenReport. Synthetic data only, in-memory database.
import { describe, expect, it } from "vitest";
import {
  PRICE_UPDATE_NOTE_PREFIX,
  createInvoiceDraft,
  invoiceExistsForKitchenReport,
} from "@/lib/restaurant/invoice-draft";
import type { ExtractedInvoice } from "@/lib/restaurant/invoice-extraction";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const CO = "co-1";

function line(over: Partial<ExtractedInvoice["lines"][number]> = {}) {
  return {
    description: "Aguacate",
    supplier_item_name: null,
    supplier_sku: null,
    quantity: 10,
    unit: "kg",
    unit_cost: 2,
    line_total: 20,
    tax_amount: null,
    ...over,
  };
}
function inv(over: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplier_name: "Proveedor Demo",
    invoice_number: null,
    invoice_date: "2026-03-04",
    due_date: null,
    currency: null,
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    lines: [line()],
    confidence_notes: [],
    ...over,
  };
}
function db(store: FakeStore = {}) {
  return { store, client: makeFakeDb(store) as never };
}
const base = {
  companyId: CO,
  userId: null,
  sourceType: "image" as const,
  originalFileName: null,
};

describe("createInvoiceDraft strictPrices:true", () => {
  it("inserts a fully read line as needs_review, userId null, no cost entries", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      extraction: inv(),
      strictPrices: true,
      eventMetadata: { kitchen_report_id: "kr-1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linesInserted).toBe(1);
    expect(store.supplier_invoices[0]).toMatchObject({
      status: "needs_review",
      created_by_user_id: null,
      invoice_date: "2026-03-04",
    });
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 10,
      unit: "kg",
      line_total: 20,
    });
    expect(store.invoice_events.map((e) => e.event_type)).toEqual([
      "uploaded",
      "created",
    ]);
    for (const e of store.invoice_events) {
      expect(e.user_id).toBeNull();
      expect((e.metadata as Record<string, unknown>).kitchen_report_id).toBe(
        "kr-1"
      );
    }
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
  });

  it("never stores a line_total of 0 or a quantity of 1 that was not read", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      extraction: inv({
        lines: [
          line(),
          line({ description: "Cilantro", line_total: null, unit_cost: null }),
          line({ description: "Limón", quantity: null }),
          line({ description: "Sal", unit: null }),
        ],
      }),
      strictPrices: true,
    });
    expect(r.ok).toBe(true);
    const rows = store.supplier_invoice_lines;
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Aguacate");
    for (const l of rows) {
      expect(l.line_total).not.toBe(0);
      expect(l.unit).not.toBe("unit");
    }
    if (r.ok)
      expect(r.linesSkipped.map((s) => s.description)).toEqual([
        "Cilantro",
        "Limón",
        "Sal",
      ]);
  });

  it("lists unpriced lines in the notes, descriptions only", async () => {
    const { store, client } = db();
    await createInvoiceDraft(client, {
      ...base,
      extraction: inv({
        lines: [
          line(),
          line({ description: "Cilantro", line_total: null, unit_cost: null }),
          line({ description: "Perejil", line_total: null, unit_cost: null }),
        ],
      }),
      strictPrices: true,
      extraNotes: PRICE_UPDATE_NOTE_PREFIX,
    });
    const notes = String(store.supplier_invoices[0].notes);
    expect(notes.startsWith(PRICE_UPDATE_NOTE_PREFIX)).toBe(true);
    expect(notes).toContain(
      "Líneas sin precio (leídas de la foto): Cilantro, Perejil"
    );
  });

  it("computes line_total from a real unit_cost and quantity", async () => {
    const { store, client } = db();
    await createInvoiceDraft(client, {
      ...base,
      extraction: inv({ lines: [line({ line_total: null, unit_cost: 3 })] }),
      strictPrices: true,
    });
    expect(store.supplier_invoice_lines[0].line_total).toBe(30);
  });

  it("uses the fallback date and says so in the notes", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      extraction: inv({ invoice_date: null }),
      strictPrices: true,
      fallbackInvoiceDate: "2026-05-06",
    });
    expect(r.ok && r.usedFallbackDate).toBe(true);
    expect(store.supplier_invoices[0].invoice_date).toBe("2026-05-06");
    expect(String(store.supplier_invoices[0].notes)).toContain(
      "Fecha no leída en la foto: se usó la fecha de envío por Telegram"
    );
  });

  it("fails without a date when there is no fallback", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      extraction: inv({ invoice_date: null }),
      strictPrices: true,
    });
    expect(r).toMatchObject({ ok: false, reason: "missing_date" });
    expect(store.supplier_invoices ?? []).toHaveLength(0);
  });

  it("creates nothing when no line is usable (not even the supplier)", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      extraction: inv({
        supplier_name: "Proveedor Nuevo",
        lines: [line({ line_total: null, unit_cost: null })],
      }),
      strictPrices: true,
    });
    expect(r).toMatchObject({ ok: false, reason: "no_usable_lines" });
    expect(store.supplier_invoices ?? []).toHaveLength(0);
    expect(store.supplier_invoice_lines ?? []).toHaveLength(0);
    expect(store.suppliers ?? []).toHaveLength(0);
    expect(store.invoice_events ?? []).toHaveLength(0);
  });

  it("reuses an existing supplier of the same company only", async () => {
    const { store, client } = db({
      suppliers: [
        { id: "s-other", company_id: "co-2", name: "proveedor demo" },
        { id: "s-mine", company_id: CO, name: "proveedor demo" },
      ],
    });
    await createInvoiceDraft(client, {
      ...base,
      extraction: inv(),
      strictPrices: true,
    });
    expect(store.supplier_invoices[0].supplier_id).toBe("s-mine");
    expect(store.suppliers).toHaveLength(2);
  });
});

describe("createInvoiceDraft strictPrices:false (route behaviour)", () => {
  it("keeps the old coercions: quantity 1, unit 'unit', total 0", async () => {
    const { store, client } = db();
    const r = await createInvoiceDraft(client, {
      ...base,
      userId: "u-1",
      extraction: inv({
        lines: [
          line({
            quantity: null,
            unit: null,
            unit_cost: null,
            line_total: null,
          }),
        ],
      }),
      strictPrices: false,
    });
    expect(r.ok).toBe(true);
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 1,
      unit: "unit",
      line_total: 0,
    });
    expect(store.supplier_invoices[0].created_by_user_id).toBe("u-1");
    expect(store.supplier_invoices[0].notes).toBeNull();
  });

  it("requires a date and a line", async () => {
    const { client } = db();
    expect(
      await createInvoiceDraft(client, {
        ...base,
        extraction: inv({ invoice_date: null }),
        strictPrices: false,
        fallbackInvoiceDate: "2026-05-06",
      })
    ).toMatchObject({ ok: false, reason: "missing_date" });
    expect(
      await createInvoiceDraft(client, {
        ...base,
        extraction: inv({ lines: [] }),
        strictPrices: false,
      })
    ).toMatchObject({ ok: false, reason: "no_lines" });
  });
});

describe("invoiceExistsForKitchenReport", () => {
  it("finds a report id within the company only", async () => {
    const { client } = db();
    await createInvoiceDraft(client, {
      ...base,
      extraction: inv(),
      strictPrices: true,
      eventMetadata: { kitchen_report_id: "kr-9" },
    });
    expect(await invoiceExistsForKitchenReport(client, CO, "kr-9")).toBe(true);
    expect(await invoiceExistsForKitchenReport(client, CO, "kr-10")).toBe(
      false
    );
    expect(await invoiceExistsForKitchenReport(client, "co-2", "kr-9")).toBe(
      false
    );
  });
});
