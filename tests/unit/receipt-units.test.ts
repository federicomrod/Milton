// Handwritten market receipt: count words and bare counts are units. Synthetic.
import { describe, expect, it } from "vitest";
import { createInvoiceDraft } from "@/lib/restaurant/invoice-draft";
import {
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractedInvoice,
} from "@/lib/restaurant/invoice-extraction";
import { mapKitchenUnit } from "@/lib/restaurant/kitchen-units";
import { normalizeUnit } from "@/lib/restaurant/units";
import { makeFakeDb } from "./helpers/fake-db";

function l(over: Partial<ExtractedInvoice["lines"][number]>) {
  return {
    description: "x",
    supplier_item_name: null,
    supplier_sku: null,
    quantity: 1,
    unit: null,
    unit_cost: null,
    line_total: 1,
    tax_amount: null,
    ...over,
  };
}
function inv(lines: ExtractedInvoice["lines"]): ExtractedInvoice {
  return {
    supplier_name: "Mercado Demo",
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
async function run(lines: ExtractedInvoice["lines"], strictPrices = true) {
  const store = {} as Record<string, Record<string, unknown>[]>;
  const client = makeFakeDb(store) as never;
  const r = await createInvoiceDraft(client, {
    companyId: "co-1",
    userId: null,
    sourceType: "image",
    originalFileName: null,
    extraction: inv(lines),
    strictPrices,
  });
  return { r, store };
}

describe("receipt with count words", () => {
  it("saves all 3 lines: lb, manojo, bare count", async () => {
    const { r, store } = await run([
      l({ description: "tomate", quantity: 2, unit: "lb", line_total: 1.8 }),
      l({
        description: "cilantro",
        quantity: 1,
        unit: "manojo",
        line_total: 0.5,
      }),
      l({ description: "aguacate", quantity: 3, unit: null, line_total: 2.25 }),
    ]);
    expect(r.ok).toBe(true);
    const rows = store.supplier_invoice_lines;
    expect(rows).toHaveLength(3);
    expect(rows.map((x) => x.unit)).toEqual(["lb", "unidad", "unidad"]);
    expect(rows.map((x) => x.line_total)).toEqual([1.8, 0.5, 2.25]);
    expect(rows.map((x) => x.quantity)).toEqual([2, 1, 3]);
    expect(String(store.supplier_invoices[0].notes ?? "")).not.toContain(
      "sin unidad"
    );
  });

  it("uses a count word found in the description", async () => {
    const { store } = await run([
      l({
        description: "manojo cilantro",
        quantity: 1,
        unit: null,
        line_total: 0.5,
      }),
      l({
        description: "bolsa de limón",
        quantity: 2,
        unit: null,
        line_total: 3,
      }),
    ]);
    expect(store.supplier_invoice_lines.map((x) => x.unit)).toEqual([
      "unidad",
      "bolsa",
    ]);
  });

  it("converts a docena to 12 units with a note", async () => {
    const { store } = await run([
      l({
        description: "huevos",
        quantity: 1,
        unit: "docena",
        line_total: 2.4,
      }),
    ]);
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 12,
      unit: "unidad",
      line_total: 2.4,
    });
    expect(String(store.supplier_invoices[0].notes)).toContain(
      "Docena convertida a 12 unidades: huevos"
    );
  });

  it("no quantity and no unit stays skipped as no_quantity", async () => {
    const { r } = await run([
      l({ description: "sal", quantity: null, unit: null, line_total: 1 }),
      l({ description: "tomate", quantity: 2, unit: "lb", line_total: 1.8 }),
    ]);
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).toContain("no_quantity");
    expect(JSON.stringify(r)).not.toContain("no_unit");
  });

  it("lb/kg/g/oz lines keep their unit", async () => {
    const { store } = await run(
      ["lb", "kg", "g", "oz"].map((u) =>
        l({ description: `p-${u}`, quantity: 2, unit: u, line_total: 4 })
      )
    );
    expect(store.supplier_invoice_lines.map((x) => x.unit)).toEqual([
      "lb",
      "kg",
      "g",
      "oz",
    ]);
  });

  it("non-strict path is unchanged", async () => {
    const { store } = await run(
      [
        l({
          description: "aguacate",
          quantity: null,
          unit: null,
          line_total: null,
        }),
      ],
      false
    );
    expect(store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 1,
      unit: "unit",
      line_total: 0,
    });
  });

  it("prompt states the count-word rule", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Count words are units");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("'unidad'");
  });

  it("unit helpers", () => {
    expect(normalizeUnit("manojo")).toBe("unit");
    expect(normalizeUnit("atados")).toBe("unit");
    expect(mapKitchenUnit("manojo")).toBe("unidad");
    expect(mapKitchenUnit("dientes")).toBe("unidad");
    expect(mapKitchenUnit("diente")).toBe("unidad");
  });
});
