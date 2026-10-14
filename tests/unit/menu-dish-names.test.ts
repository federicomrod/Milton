// R1-10: reading a POS variant name. Synthetic names only.

import { describe, expect, it } from "vitest";
import {
  dishKey,
  exclusionFor,
  parseVariantName,
  sameDishKey,
} from "@/lib/restaurant/menu-dishes/variant-name";

describe("parseVariantName", () => {
  it("reads size, sides and cooking point", () => {
    const v = parseVariantName(
      "Bistec Norteño (6 onz.) (Pan con Ajo, Papas, Bien Cocido)"
    );
    expect(v.base).toBe("Bistec Norteño");
    expect(v).toMatchObject({
      portion_qty: 6,
      portion_unit: "oz",
      cooking_point: "Bien Cocido",
      is_event: false,
    });
    expect(v.sides).toEqual(["Pan con Ajo", "Papas"]);
  });

  it("strips a size written in the dish part and reads an event", () => {
    const v = parseVariantName(
      "Bistecs Norteños 8oz. (Eventos)  (3/4, Tortilla)"
    );
    expect(v.key).toBe(dishKey("Bistec Norteño"));
    expect(v).toMatchObject({
      portion_qty: 8,
      is_event: true,
      cooking_point: "3/4",
    });
    expect(v.sides).toEqual(["Tortilla"]);
  });

  it("reads personas, EVENTO, PROMO and a name with no options", () => {
    expect(parseVariantName("Parrilla Grande (3 personas)")).toMatchObject({
      portion_qty: 3,
      portion_unit: "personas",
    });
    expect(parseVariantName("BISTEC NORTEÑO (EVENTO)")).toMatchObject({
      is_event: true,
      key: dishKey("Bistec Norteño"),
    });
    expect(
      parseVariantName("Bistec Norteño (4 oz) (PROMO) (Tortilla, 1/2)")
    ).toMatchObject({ is_promo: true, portion_qty: 4, cooking_point: "1/2" });
    expect(parseVariantName("Sopa de Casa")).toMatchObject({
      base: "Sopa de Casa",
      portion_qty: null,
      sides: [],
    });
  });

  it("folds plurals and accents into one key, and tolerates one typo", () => {
    expect(dishKey("Churrascos Típicos")).toBe(dishKey("churrasco tipico"));
    expect(
      sameDishKey(dishKey("Pariillada Grande"), dishKey("Parrillada Grande"))
    ).toBe(true);
    expect(sameDishKey(dishKey("Sopa"), dishKey("Sopas de"))).toBe(false);
  });
});

describe("exclusionFor", () => {
  it("excludes by POS category and drinks sold as promos", () => {
    expect(exclusionFor({ name: "Agua", category: "Bebidas sin Licor" })).toBe(
      "bebida"
    );
    expect(
      exclusionFor({ name: "Orden de queso", category: "Ordenes Extras" })
    ).toBe("extra");
    expect(exclusionFor({ name: "Almuerzo", category: "Empleados" })).toBe(
      "empleados"
    );
    expect(
      exclusionFor({ name: "Promo de toñas", category: "Promociones" })
    ).toBe("bebida");
    expect(
      exclusionFor({ name: "Bistec (Aguacate)", category: "De la parrilla" })
    ).toBeNull();
  });
});
