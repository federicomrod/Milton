import { describe, expect, it } from "vitest";
import { resolveIngredientPriceDate } from "@/lib/restaurant/price-date";

describe("resolveIngredientPriceDate", () => {
  it("uses the invoice date when the record has one", () => {
    expect(
      resolveIngredientPriceDate({
        recordDate: "2026-04-08",
        uploadDate: "2026-10-12",
        kind: "invoice",
      })
    ).toEqual({ effective_date: "2026-04-08", date_source: "invoice" });
  });

  it("uses a dated price list's own date", () => {
    expect(
      resolveIngredientPriceDate({
        priceListDate: "2026-04-01",
        uploadDate: "2026-10-12",
        kind: "price_list",
      })
    ).toEqual({
      effective_date: "2026-04-01",
      date_source: "dated_price_list",
    });
  });

  it("falls back to the upload date when the record date is unknown", () => {
    expect(
      resolveIngredientPriceDate({
        uploadDate: "2026-10-12",
        kind: "workbook",
      })
    ).toEqual({ effective_date: "2026-10-12", date_source: "upload" });
  });

  it("records confirmation and manual sources", () => {
    expect(
      resolveIngredientPriceDate({
        recordDate: "2026-05-01",
        uploadDate: "2026-10-12",
        kind: "confirmation",
      }).date_source
    ).toBe("confirmation");
    expect(
      resolveIngredientPriceDate({
        recordDate: "2026-05-02",
        uploadDate: "2026-10-12",
        kind: "manual",
      }).date_source
    ).toBe("manual");
  });
});
