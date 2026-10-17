import { describe, expect, it } from "vitest";
import { SHEET_TITLE_RE } from "@/lib/restaurant/cost-workbook/blocks";

describe("cost workbook sheet title", () => {
  it("matches a generic «RESTAURANTE <name>» title, whatever the name", () => {
    expect(SHEET_TITLE_RE.test("restaurante de prueba")).toBe(true);
    expect(SHEET_TITLE_RE.test("restaurante casa central")).toBe(true);
  });

  it("does not match the banner, a bare word or a long sentence", () => {
    expect(SHEET_TITLE_RE.test("restaurante")).toBe(false);
    expect(SHEET_TITLE_RE.test("costo restaurante")).toBe(false);
    expect(SHEET_TITLE_RE.test("restaurante a b c d e f g h i j k")).toBe(
      false
    );
  });
});
