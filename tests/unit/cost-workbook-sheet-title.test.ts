import { describe, expect, it } from "vitest";
import {
  collectCostoRestauranteBlockNames,
  SHEET_TITLE_RE,
} from "@/lib/restaurant/cost-workbook/blocks";

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

  it("treats any lone first-row tab title as a title, not a recipe name", () => {
    const header = ["Articulo", "Unidad Detalle", "Cantidad", "Costo Unitario"];
    const body = [
      ["COSTO RESTAURANTE"],
      ["SOPA DEMO"],
      header,
      ["CEBOLLA", "ONZA", 2, 0.1],
      ["COSTO TOTAL", "", 0, 0.2],
    ];
    for (const title of [
      "CASA DEMO — ENTRADAS",
      "Restaurante de prueba",
      "Carta de verano",
    ]) {
      expect(collectCostoRestauranteBlockNames([[title], [], ...body])).toEqual(
        ["SOPA DEMO"]
      );
    }
  });
});
