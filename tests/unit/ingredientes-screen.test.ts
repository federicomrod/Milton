import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  lineImpactAfterPrice,
  parseIngredientesFilter,
  parsePriceInput,
  previousSameUnitCost,
  priceChangePct,
  priceSourceOf,
  sortIngredientes,
} from "@/lib/restaurant/ingredientes-screen";
import { redirectToIngredientes } from "@/lib/restaurant/recetas-redirect";

const entry = (
  id: string,
  cost_date: string,
  normalized_unit: string,
  normalized_unit_cost: number,
  created_at = `${cost_date}T10:00:00Z`
) => ({ id, cost_date, created_at, normalized_unit, normalized_unit_cost });

describe("previousSameUnitCost", () => {
  it("returns the newest earlier entry in the same unit", () => {
    const latest = entry("c", "2026-10-10", "kg", 12);
    const entries = [
      entry("a", "2026-09-01", "kg", 9),
      entry("b", "2026-09-20", "kg", 10),
      entry("x", "2026-10-01", "unit", 1),
      latest,
    ];
    expect(previousSameUnitCost(entries, latest)).toBe(10);
  });

  it("treats unit synonyms as the same unit and ignores later rows", () => {
    const latest = entry("c", "2026-10-10", "kg", 12);
    const entries = [
      entry("a", "2026-09-01", "kilogram", 8),
      entry("z", "2026-10-12", "kg", 99),
      latest,
    ];
    expect(previousSameUnitCost(entries, latest)).toBe(8);
  });

  it("is null without a latest or without a previous one", () => {
    expect(previousSameUnitCost([], null)).toBeNull();
    const latest = entry("c", "2026-10-10", "kg", 12);
    expect(previousSameUnitCost([latest], latest)).toBeNull();
  });
});

describe("priceChangePct", () => {
  it("computes the percent change", () => {
    expect(priceChangePct(11, 10)).toBeCloseTo(10);
    expect(priceChangePct(9, 10)).toBeCloseTo(-10);
  });
  it("is null when a side is missing or the base is 0", () => {
    expect(priceChangePct(null, 10)).toBeNull();
    expect(priceChangePct(10, null)).toBeNull();
    expect(priceChangePct(10, 0)).toBeNull();
  });
});

describe("sortIngredientes", () => {
  const rows = [
    { id: "1", name: "Tomate", price: 2, sold_net_sales: 500 },
    { id: "2", name: "aguacate", price: null, sold_net_sales: 0 },
    { id: "3", name: "Queso", price: null, sold_net_sales: 900 },
    { id: "4", name: "Cebolla", price: null, sold_net_sales: 0 },
  ];
  it("Todos is alphabetical (case-insensitive)", () => {
    expect(sortIngredientes(rows, "todos").map((r) => r.name)).toEqual([
      "aguacate",
      "Cebolla",
      "Queso",
      "Tomate",
    ]);
  });
  it("Falta precio keeps only missing prices, sold dishes first", () => {
    expect(sortIngredientes(rows, "falta_precio").map((r) => r.id)).toEqual([
      "3",
      "2",
      "4",
    ]);
  });
  it("parses the filter param", () => {
    expect(parseIngredientesFilter("falta_precio")).toBe("falta_precio");
    expect(parseIngredientesFilter("otro")).toBe("todos");
    expect(parseIngredientesFilter(undefined)).toBe("todos");
  });
});

describe("parsePriceInput", () => {
  it("reads money-like input", () => {
    expect(parsePriceInput("$12.40")).toBe(12.4);
    expect(parsePriceInput("12,40")).toBe(12.4);
    expect(parsePriceInput("$1,234.50")).toBe(1234.5);
    expect(parsePriceInput(" 7 ")).toBe(7);
  });
  it("rejects empty or negative input", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("-5")).toBeNull();
  });
});

describe("priceSourceOf", () => {
  it("maps entries to Excel / lista / factura / manual", () => {
    expect(priceSourceOf({ source_type: "manual" })).toBe("manual");
    expect(priceSourceOf({ source_type: "invoice_line" })).toBe("factura");
    expect(
      priceSourceOf({ source_type: "import", notes: "Receta: Burger" })
    ).toBe("excel");
    expect(priceSourceOf({ source_type: "import", notes: null })).toBe("lista");
  });
});

describe("lineImpactAfterPrice", () => {
  it("converts the new price into the line unit", () => {
    expect(
      lineImpactAfterPrice({
        qty: 200,
        unit: "g",
        oldAmount: null,
        oldPrice: null,
        newPrice: 10,
        newPriceUnit: "kg",
      })
    ).toBeCloseTo(2);
  });
  it("is null when it cannot be costed (never 0)", () => {
    expect(
      lineImpactAfterPrice({
        qty: 1,
        unit: "rebanada",
        oldAmount: null,
        oldPrice: null,
        newPrice: 10,
        newPriceUnit: "kg",
      })
    ).toBeNull();
  });
});

describe("Ingredientes route", () => {
  it("old URL redirects to Menú › Ingredientes keeping params", () => {
    expect(redirectToIngredientes({})).toBe(
      "/dashboard/restaurant/menu/ingredientes"
    );
    expect(redirectToIngredientes({ ingrediente: "abc", location: "l1" })).toBe(
      "/dashboard/restaurant/menu/ingredientes?ingrediente=abc&location=l1"
    );
  });

  it("selection never reloads the server page", () => {
    const src = readFileSync(
      "components/restaurant/menu/IngredientesScreen.tsx",
      "utf8"
    );
    expect(src).toContain("window.history.replaceState");
    expect(src).not.toContain("router.refresh");
    expect(src).not.toMatch(/text-\[1[01](\.5)?px\]/);
  });
});
