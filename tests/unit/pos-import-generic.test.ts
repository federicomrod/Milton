// tests/unit/pos-import-generic.test.ts
//
// Tests for the generic POS sales column mapper (issue #531).

import { describe, it, expect } from "vitest";
import {
  computeHeaderFingerprint,
  detectDecimalSeparator,
  parseNumberGeneric,
  parseDateGeneric,
  normalizeGenericPOSRow,
  type GenericNormalizeContext,
} from "@/lib/restaurant/pos-import-generic";
import { buildNameIndex, normalizeHeader } from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";

describe("computeHeaderFingerprint", () => {
  it("produces the same fingerprint for reordered columns", () => {
    const headers1 = ["Fecha", "Producto", "Cantidad"];
    const headers2 = ["Cantidad", "Producto", "Fecha"];
    const fp1 = computeHeaderFingerprint(headers1);
    const fp2 = computeHeaderFingerprint(headers2);
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different columns", () => {
    const headers1 = ["Fecha", "Producto", "Cantidad"];
    const headers2 = ["Date", "Product", "Quantity"];
    const fp1 = computeHeaderFingerprint(headers1);
    const fp2 = computeHeaderFingerprint(headers2);
    expect(fp1).not.toBe(fp2);
  });
});

describe("detectDecimalSeparator", () => {
  it("detects comma as decimal separator in European format", () => {
    const rows = [
      { price: "1.234,56", quantity: "2" },
      { price: "890,00", quantity: "1" },
      { price: "45,50", quantity: "3" },
    ];
    expect(detectDecimalSeparator(rows)).toBe("comma");
  });

  it("detects dot as decimal separator in US format", () => {
    const rows = [
      { price: "1,234.56", quantity: "2" },
      { price: "890.00", quantity: "1" },
      { price: "45.50", quantity: "3" },
    ];
    expect(detectDecimalSeparator(rows)).toBe("dot");
  });

  it("defaults to dot when ambiguous", () => {
    const rows = [
      { price: "100", quantity: "2" },
      { price: "200", quantity: "1" },
    ];
    expect(detectDecimalSeparator(rows)).toBe("dot");
  });
});

describe("parseNumberGeneric", () => {
  it("parses US format numbers with dot as decimal", () => {
    expect(parseNumberGeneric("1,234.56", "dot")).toBe(1234.56);
    expect(parseNumberGeneric("890.00", "dot")).toBe(890);
    expect(parseNumberGeneric("45.5", "dot")).toBe(45.5);
  });

  it("parses European format numbers with comma as decimal", () => {
    expect(parseNumberGeneric("1.234,56", "comma")).toBe(1234.56);
    expect(parseNumberGeneric("890,00", "comma")).toBe(890);
    expect(parseNumberGeneric("45,5", "comma")).toBe(45.5);
  });

  it("strips currency symbols", () => {
    expect(parseNumberGeneric("$1,234.56", "dot")).toBe(1234.56);
    expect(parseNumberGeneric("€890,00", "comma")).toBe(890);
  });

  it("returns null for invalid numbers", () => {
    expect(parseNumberGeneric("abc", "dot")).toBeNull();
    expect(parseNumberGeneric("", "dot")).toBeNull();
    expect(parseNumberGeneric(null, "dot")).toBeNull();
  });
});

describe("parseDateGeneric", () => {
  it("parses ISO format dates", () => {
    expect(parseDateGeneric("2026-01-15")).toBe("2026-01-15");
    expect(parseDateGeneric("2026-01-15T10:30:00")).toBe("2026-01-15");
  });

  it("parses US format dates MM/DD/YYYY", () => {
    expect(parseDateGeneric("01/15/2026")).toBe("2026-01-15");
    expect(parseDateGeneric("12/31/2025")).toBe("2025-12-31");
  });

  it("parses EU format dates DD/MM/YYYY when day > 12", () => {
    expect(parseDateGeneric("15/01/2026")).toBe("2026-01-15");
    expect(parseDateGeneric("31/12/2025")).toBe("2025-12-31");
  });

  it("parses EU format dates with dot separator", () => {
    expect(parseDateGeneric("15.01.2026")).toBe("2026-01-15");
    expect(parseDateGeneric("31.12.2025")).toBe("2025-12-31");
  });

  it("returns null for invalid dates", () => {
    expect(parseDateGeneric("abc")).toBeNull();
    expect(parseDateGeneric("")).toBeNull();
    expect(parseDateGeneric(null)).toBeNull();
  });
});

describe("normalizeGenericPOSRow", () => {
  function makeContext(
    overrides: Partial<GenericNormalizeContext> = {}
  ): GenericNormalizeContext {
    return {
      company_id: "company-1",
      source_type: "csv",
      currency: "MXN",
      column_mapping: {
        date: "Fecha",
        product: "Producto",
        quantity: "Cantidad",
        net_amount: "Importe",
      },
      decimal_separator: "comma",
      locationIndex: buildNameIndex([
        { id: "loc-1", name: "Fuel Centro" },
        { id: "loc-2", name: "Fuel Norte" },
      ]),
      locationBrandIndex: new Map([
        ["loc-1", null],
        ["loc-2", null],
      ]),
      menuItemIndex: buildScopedNameIndex(
        [
          { id: "item-1", name: "Cerveza Artesanal", scopeId: null },
          { id: "item-2", name: "Burger Clásica", scopeId: null },
        ],
        normalizeHeader
      ),
      ...overrides,
    };
  }

  it("normalizes a valid row with comma decimals", () => {
    const row = {
      Fecha: "15/01/2026",
      Producto: "Cerveza Artesanal",
      Cantidad: "2",
      Importe: "120,00",
    };
    const ctx = makeContext();
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.insert.sale_date).toBe("2026-01-15");
    expect(res.insert.raw_item_name).toBe("Cerveza Artesanal");
    expect(res.insert.quantity).toBe(2);
    expect(res.insert.net_revenue).toBe(120);
    expect(res.insert.currency).toBe("MXN");
  });

  it("matches menu items by name", () => {
    const row = {
      Fecha: "15/01/2026",
      Producto: "Burger Clásica",
      Cantidad: "1",
      Importe: "185,50",
    };
    const ctx = makeContext();
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.menu_item_id).toBe("item-2");
  });

  it("matches locations by name", () => {
    const row = {
      Fecha: "15/01/2026",
      Producto: "Papas Fritas",
      Cantidad: "1",
      Importe: "65,00",
      Local: "Fuel Centro",
    };
    const ctx = makeContext({
      column_mapping: {
        date: "Fecha",
        product: "Producto",
        quantity: "Cantidad",
        net_amount: "Importe",
        location: "Local",
      },
    });
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insert.location_id).toBe("loc-1");
  });

  it("rejects rows with missing required fields", () => {
    const row = {
      Fecha: "15/01/2026",
      Producto: "",
      Cantidad: "1",
      Importe: "100,00",
    };
    const ctx = makeContext();
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toContain("product");
  });

  it("rejects rows with invalid dates", () => {
    const row = {
      Fecha: "invalid-date",
      Producto: "Test",
      Cantidad: "1",
      Importe: "100,00",
    };
    const ctx = makeContext();
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toContain("date");
  });

  it("rejects rows with zero quantity", () => {
    const row = {
      Fecha: "15/01/2026",
      Producto: "Test",
      Cantidad: "0",
      Importe: "100,00",
    };
    const ctx = makeContext();
    const res = normalizeGenericPOSRow(row, 0, ctx);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toContain("quantity");
  });
});
