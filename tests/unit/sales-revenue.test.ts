import { describe, it, expect } from "vitest";
import {
  classifySaleLine,
  isTipLineName,
  isTipSaleRow,
} from "@/lib/restaurant/sales-revenue";

describe("isTipLineName", () => {
  it("matches Propina and tip product names, including accents", () => {
    expect(isTipLineName("Propina")).toBe(true);
    expect(isTipLineName("PROPINA")).toBe(true);
    expect(isTipLineName("Propína")).toBe(true);
    expect(isTipLineName("tip")).toBe(true);
    expect(isTipLineName("Tips")).toBe(true);
    expect(isTipLineName("Propina 10%")).toBe(true);
    expect(isTipLineName("tip 15")).toBe(true);
    expect(isTipLineName("gratuity")).toBe(true);
  });

  it("does not treat dishes that contain the word tip as tips", () => {
    expect(isTipLineName("Steak tip")).toBe(false);
    expect(isTipLineName("BBQ Brisket Sandwich")).toBe(false);
    expect(isTipLineName("Pupusa")).toBe(false);
    expect(isTipLineName("")).toBe(false);
  });
});

describe("isTipSaleRow", () => {
  it("lets the is_tip column win over the name", () => {
    expect(
      isTipSaleRow({ is_tip: true, raw_item_name: "Pupusa" })
    ).toBe(true);
    expect(
      isTipSaleRow({ is_tip: false, raw_item_name: "Propina" })
    ).toBe(false);
  });

  it("falls back to the product name when the column is null", () => {
    expect(
      isTipSaleRow({ is_tip: null, raw_item_name: "Propina" })
    ).toBe(true);
    expect(
      isTipSaleRow({ item_name: "Propina" })
    ).toBe(true);
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
    });
  });
});
