import { describe, expect, it } from "vitest";
import {
  buildInvoiceLineSummaries,
  formatPreviewQuantity,
  type InvoiceLinePreviewRow,
} from "@/lib/restaurant/invoice-list-preview";

const row = (o: Partial<InvoiceLinePreviewRow>): InvoiceLinePreviewRow => ({
  id: "l0",
  invoice_id: "i1",
  ingredient_id: null,
  supplier_item_name: null,
  description: "texto",
  quantity: 1,
  unit: "kg",
  unit_cost: 2,
  created_at: "2026-01-01T00:00:00Z",
  match_status: "unmatched",
  review_status: "pending",
  ...o,
});

describe("buildInvoiceLineSummaries", () => {
  it("counts like the old loaders and gives every invoice an entry", () => {
    const m = buildInvoiceLineSummaries(
      ["i1", "i2"],
      [
        row({ id: "a", match_status: "matched", review_status: "approved" }),
        row({ id: "b", match_status: "auto_matched" }),
        row({ id: "c" }),
        row({ id: "x", invoice_id: "other" }),
      ],
      new Map()
    );
    expect(m.get("i1")!.counts).toEqual({
      total: 3,
      matched: 2,
      approved: 1,
      unmatched: 1,
      pending: 2,
    });
    expect(m.get("i2")!.counts.total).toBe(0);
    expect(m.get("i2")!.preview).toEqual([]);
    expect(m.has("other")).toBe(false);
  });

  it("keeps the first 2 lines by created_at then id", () => {
    const m = buildInvoiceLineSummaries(
      ["i1"],
      [
        row({ id: "z", description: "tercera", created_at: "2026-01-03" }),
        row({ id: "b", description: "segunda", created_at: "2026-01-01" }),
        row({ id: "a", description: "primera", created_at: "2026-01-01" }),
      ],
      new Map()
    );
    expect(m.get("i1")!.preview.map((p) => p.name)).toEqual([
      "primera",
      "segunda",
    ]);
    expect(m.get("i1")!.counts.total).toBe(3);
  });

  it("the ingredient name wins over supplier_item_name over description", () => {
    const m = buildInvoiceLineSummaries(
      ["i1"],
      [
        row({
          id: "a",
          ingredient_id: "g1",
          supplier_item_name: "HARINA 000",
          created_at: "1",
        }),
        row({ id: "b", supplier_item_name: "Sal fina", created_at: "2" }),
      ],
      new Map([["g1", "Harina de trigo"]])
    );
    const [a, b] = m.get("i1")!.preview;
    expect(a).toMatchObject({ name: "Harina de trigo", matched: true });
    expect(b).toMatchObject({ name: "Sal fina", matched: false });
  });

  it("null cost stays null and numeric strings are parsed", () => {
    const m = buildInvoiceLineSummaries(
      ["i1"],
      [row({ unit_cost: null, quantity: "2.50" })],
      new Map()
    );
    expect(m.get("i1")!.preview[0]).toMatchObject({
      unit_cost: null,
      quantity: 2.5,
    });
  });

  it("drops trailing zeros in quantities", () => {
    expect(formatPreviewQuantity(1)).toBe("1");
    expect(formatPreviewQuantity(2.5)).toBe("2.5");
    expect(formatPreviewQuantity(1.2)).toBe("1.2");
  });
});
