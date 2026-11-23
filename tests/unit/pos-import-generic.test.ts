// tests/unit/pos-import-generic.test.ts
//
// Tests for the generic POS sales column mapper (issue #531).

import { describe, it, expect } from "vitest";
import {
  computeHeaderFingerprint,
  detectDecimalSeparator,
  detectDateFormat,
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

describe("detectDateFormat", () => {
  it("detects ISO format", () => {
    const rows = [
      { date: "2026-01-15" },
      { date: "2026-01-16" },
    ];
    const result = detectDateFormat(rows, "date");
    expect(result.format).toBe("YYYY-MM-DD");
    expect(result.ambiguous).toBe(false);
  });

  it("detects DD/MM/YYYY when day > 12", () => {
    const rows = [
      { date: "15/01/2026" },
      { date: "16/01/2026" },
    ];
    const result = detectDateFormat(rows, "date");
    expect(result.format).toBe("DD/MM/YYYY");
    expect(result.ambiguous).toBe(false);
  });

  it("detects MM/DD/YYYY when month > 12", () => {
    const rows = [
      { date: "01/15/2026" },
      { date: "01/16/2026" },
    ];
    const result = detectDateFormat(rows, "date");
    expect(result.format).toBe("MM/DD/YYYY");
    expect(result.ambiguous).toBe(false);
  });

  it("flags ambiguous when both parts ≤ 12", () => {
    const rows = [
      { date: "05/01/2026" },
      { date: "06/02/2026" },
    ];
    const result = detectDateFormat(rows, "date");
    // Defaults to DD/MM but marked ambiguous
    expect(result.format).toBe("DD/MM/YYYY");
    expect(result.ambiguous).toBe(true);
  });

  it("flags mixed EU+US file as ambiguous", () => {
    const rows = [
      { date: "15/01/2026" }, // Unambiguous EU (day > 12)
      { date: "01/20/2026" }, // Unambiguous US (month > 12)
      { date: "05/06/2026" }, // Ambiguous
    ];
    const result = detectDateFormat(rows, "date");
    expect(result.ambiguous).toBe(true);
  });
});

describe("parseDateGeneric", () => {
  it("rejects impossible dates - month 15 in MM/DD/YYYY", () => {
    const result = parseDateGeneric("15/20/2026", "MM/DD/YYYY");
    expect(result).toBeNull();
  });

  it("rejects impossible dates - day 32 in DD/MM/YYYY", () => {
    const result = parseDateGeneric("32/01/2026", "DD/MM/YYYY");
    expect(result).toBeNull();
  });

  it("rejects impossible dates - month 13 in DD/MM/YYYY", () => {
    const result = parseDateGeneric("15/13/2026", "DD/MM/YYYY");
    expect(result).toBeNull();
  });

  it("accepts valid dates in MM/DD/YYYY", () => {
    const result = parseDateGeneric("01/15/2026", "MM/DD/YYYY");
    expect(result).toBe("2026-01-15");
  });

  it("accepts valid dates in DD/MM/YYYY", () => {
    const result = parseDateGeneric("15/01/2026", "DD/MM/YYYY");
    expect(result).toBe("2026-01-15");
  });

  it("accepts valid dates in YYYY-MM-DD", () => {
    const result = parseDateGeneric("2026-01-15", "YYYY-MM-DD");
    expect(result).toBe("2026-01-15");
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


describe("parseDateGeneric with explicit format", () => {
  it("parses 05/01/2026 as 2026-01-05 with DD/MM/YYYY format", () => {
    expect(parseDateGeneric("05/01/2026", "DD/MM/YYYY")).toBe("2026-01-05");
  });

  it("parses 05/01/2026 as 2026-05-01 with MM/DD/YYYY format", () => {
    expect(parseDateGeneric("05/01/2026", "MM/DD/YYYY")).toBe("2026-05-01");
  });

  it("parses YYYY-MM-DD format", () => {
    expect(parseDateGeneric("2026-01-15", "YYYY-MM-DD")).toBe("2026-01-15");
  });

  it("never guesses - wrong format returns null", () => {
    expect(parseDateGeneric("05/01/2026", "YYYY-MM-DD")).toBeNull();
    expect(parseDateGeneric("2026-01-15", "DD/MM/YYYY")).toBeNull();
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
      date_format: "DD/MM/YYYY",
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

describe("End-to-end fixture tests (blocker #5)", () => {
  it("loads and parses fuel-export.csv with comma decimals and quoted fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { parseCSV } = await import("@/lib/restaurant/pos-csv-parser");

    const fixturePath = path.join(process.cwd(), "tests/fixtures/pos-uploads/fuel-export.csv");
    const buffer = fs.readFileSync(fixturePath);
    const parsed = parseCSV(buffer);

    // Should detect headers and skip title row
    expect(parsed.headers).toContain("Fecha");
    expect(parsed.headers).toContain("Producto");
    expect(parsed.headers).toContain("Cant.");
    expect(parsed.headers).toContain("Importe");
    
    // Should have data rows
    expect(parsed.rows.length).toBeGreaterThan(0);
    
    // Detect comma decimals
    const decimalSep = detectDecimalSeparator(parsed.rows);
    expect(decimalSep).toBe("comma");

    // Assert first row: "120,00" should stay as one cell and parse to 120
    const firstRow = parsed.rows[0];
    expect(firstRow).toBeDefined();
    
    const importeValue = firstRow["Importe"];
    expect(importeValue).toBe("120,00"); // One cell, not split
    
    // Parse with comma decimal
    expect(parseNumberGeneric(importeValue, "comma")).toBe(120);
  });

  it("loads and parses el-malevo-export.csv with ISO dates", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { parseCSV } = await import("@/lib/restaurant/pos-csv-parser");

    const fixturePath = path.join(process.cwd(), "tests/fixtures/pos-uploads/el-malevo-export.csv");
    const buffer = fs.readFileSync(fixturePath);
    const parsed = parseCSV(buffer);

    // Should detect headers
    expect(parsed.headers).toContain("Fecha Venta");
    expect(parsed.headers).toContain("Plato");
    
    // Detect ISO date format
    const dateDetection = detectDateFormat(parsed.rows, "Fecha Venta");
    expect(dateDetection.format).toBe("YYYY-MM-DD");
    expect(dateDetection.ambiguous).toBe(false);
  });
});
