// The extraction prompt asks for Spanish notes on the Telegram path only, and
// the invoice notes label the model's notes in Spanish.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

const calls: Array<{ messages: Array<{ role: string; content: unknown }> }> =
  [];
vi.mock("openai", () => ({
  OpenAI: class {
    chat = {
      completions: {
        create: async (body: {
          messages: Array<{ role: string; content: unknown }>;
        }) => {
          calls.push(body);
          return { choices: [{ message: { content: "{}" } }] };
        },
      },
    };
  },
}));

import {
  createInvoiceDraft,
  extractInvoiceFromImage,
} from "@/lib/restaurant/invoice-draft";

beforeEach(() => {
  calls.length = 0;
  process.env.OPENAI_API_KEY = "test-key";
});

describe("notes language", () => {
  it("notesLanguage 'es' adds the Spanish-notes instruction to the system prompt; default does not", async () => {
    await extractInvoiceFromImage({
      dataUrl: "data:image/jpeg;base64,AAAA",
      notesLanguage: "es",
    });
    await extractInvoiceFromImage({ dataUrl: "data:image/jpeg;base64,AAAA" });
    const system = (i: number) =>
      String(calls[i].messages.find((m) => m.role === "system")?.content);
    expect(system(0)).toContain("confidence_notes) in Spanish");
    expect(system(1)).not.toContain("in Spanish (neutral Latin American)");
  });

  it("the model's notes are labelled «Notas de la lectura:» in the invoice notes", async () => {
    const store: Record<string, Array<Record<string, unknown>>> = {
      companies: [{ id: "co-1", currency: "USD" }],
      suppliers: [],
      ingredients: [],
      ingredient_aliases: [],
      supplier_invoices: [],
      supplier_invoice_lines: [],
      invoice_events: [],
    };
    const res = await createInvoiceDraft(makeFakeDb(store) as never, {
      companyId: "co-1",
      userId: null,
      sourceType: "image",
      originalFileName: "telegram-1.jpg",
      strictPrices: true,
      fallbackInvoiceDate: "2026-10-24",
      extraction: {
        supplier_name: "Proveedor Demo",
        invoice_number: null,
        invoice_date: "2026-10-24",
        due_date: null,
        currency: null,
        subtotal: null,
        tax_amount: null,
        total_amount: null,
        confidence_notes: ["Foto borrosa en la esquina"],
        lines: [
          {
            description: "Tomate",
            supplier_item_name: "Tomate",
            supplier_sku: null,
            quantity: 2,
            unit: "lb",
            unit_cost: 1,
            line_total: 2,
            tax_amount: null,
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    const notes = String(store.supplier_invoices[0].notes);
    expect(notes).toContain("Notas de la lectura: Foto borrosa en la esquina");
    expect(notes).not.toContain("AI extraction notes");
  });
});
