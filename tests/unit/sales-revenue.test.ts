import { describe, it, expect } from "vitest";
import {
  classifySaleLine,
  isTipLineName,
  isTipSaleRow,
  SERVICE_CHARGE_NAMES,
  SERVICE_CHARGE_NAMES_ARE_TIPS,
} from "@/lib/restaurant/sales-revenue";

describe("isTipLineName", () => {
  it.each([
    ["Propina", true],
    ["PROPINA", true],
    ["Propína", true],
    ["PROPINA SUGERIDA", true],
    ["Propina Voluntaria", true],
    ["Propina - Tarjeta", true],
    ["propinas", true],
    ["tip", true],
    ["Tips", true],
    ["Tip Jar", true],
    ["tip 15", true],
    ["Propina 10%", true],
    ["gratuity", true],
    ["Gratuities 10%", true],
  ] as const)("treats %s as a tip", (name, expected) => {
    expect(isTipLineName(name)).toBe(expected);
  });

  it.each([
    ["Steak tip", false],
    ["Tipico", false],
    ["tip sirloin", false],
    ["BBQ Brisket Sandwich", false],
    ["Pupusa", false],
    ["", false],
  ] as const)("keeps dish name %s as revenue", (name, expected) => {
    expect(isTipLineName(name)).toBe(expected);
  });

  it("does not treat service-charge names as tips while the flag is false", () => {
    expect(SERVICE_CHARGE_NAMES_ARE_TIPS).toBe(false);
    for (const name of SERVICE_CHARGE_NAMES) {
      expect(isTipLineName(name)).toBe(false);
      expect(isTipLineName(name, false)).toBe(false);
    }
  });

  it("treats service-charge names as tips when the flag is flipped", () => {
    for (const name of SERVICE_CHARGE_NAMES) {
      expect(isTipLineName(name, true)).toBe(true);
    }
    expect(isTipLineName("Steak tip", true)).toBe(false);
    expect(isTipLineName("Tipico", true)).toBe(false);
  });
});

describe("isTipSaleRow", () => {
  it("lets the is_tip column win over the name", () => {
    expect(isTipSaleRow({ is_tip: true, raw_item_name: "Pupusa" })).toBe(true);
    expect(isTipSaleRow({ is_tip: false, raw_item_name: "Propina" })).toBe(
      false
    );
  });

  it("falls back to the product name when the column is null", () => {
    expect(isTipSaleRow({ is_tip: null, raw_item_name: "Propina" })).toBe(true);
    expect(isTipSaleRow({ item_name: "Propina Voluntaria" })).toBe(true);
  });
});

describe("classifySaleLine", () => {
  it("excludes tips from net / gross / discounts", () => {
    const tip = classifySaleLine({
      raw_item_name: "Propina",
      gross_revenue: 8.5,
      discount_amount: 0,
    });
    expect(tip).toEqual({
      isTip: true,
      posted: 8.5,
      net: 0,
      discount: 0,
      gross: 0,
      tip: 8.5,
      discountEstimated: false,
    });
  });

  it("treats posted revenue as net and adds discount to gross", () => {
    const dish = classifySaleLine({
      raw_item_name: "Pupusa",
      gross_revenue: 10,
      discount_amount: 2,
    });
    expect(dish).toEqual({
      isTip: false,
      posted: 10,
      net: 10,
      discount: 2,
      gross: 12,
      tip: 0,
      discountEstimated: false,
    });
  });

  it("surfaces the estimated-discount flag from the row or source_metadata", () => {
    expect(
      classifySaleLine({
        raw_item_name: "Pupusa",
        gross_revenue: 10,
        discount_amount: 2,
        discount_estimated: true,
      }).discountEstimated
    ).toBe(true);
    expect(
      classifySaleLine({
        raw_item_name: "Pupusa",
        gross_revenue: 10,
        discount_amount: 2,
        source_metadata: { discount_estimated: true },
      }).discountEstimated
    ).toBe(true);
  });
});
