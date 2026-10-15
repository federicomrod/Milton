import { describe, expect, it } from "vitest";
import {
  displayStateForProduct,
  evidenceChecklist,
  formatUnitsLabel,
  namesAlmostEqual,
  odooSyncLabel,
  productKindLabel,
} from "@/lib/restaurant/recipe-costing/display";
import { parseSuggestionEvidence } from "@/lib/restaurant/recipe-costing/evidence";

describe("recipe costing display", () => {
  it("detects plato / bebida / combo / modificador", () => {
    expect(
      productKindLabel({
        name: "Pollo empanizado",
        is_combo: false,
        classification: "plato_preparado",
        category: "Platos fuertes",
      })
    ).toBe("Plato");
    expect(
      productKindLabel({
        name: "Coca-Cola 12 oz",
        is_combo: false,
        classification: "reventa",
        category: "Bebidas",
      })
    ).toBe("Bebida");
    expect(
      productKindLabel({
        name: "Combo familiar",
        is_combo: true,
        classification: "por_clasificar",
      })
    ).toBe("Combo");
    expect(
      productKindLabel({
        name: "Extra queso",
        is_combo: false,
        classification: "modificador_con_costo",
      })
    ).toBe("Modificador");
  });

  it("keeps Confirmado / Sugerido / Ambiguo / Sin receta pills", () => {
    expect(
      displayStateForProduct({
        confirmed: true,
        is_combo: false,
        classification: "requiere_receta",
        kind_label: "Plato",
        ambiguous: false,
        suggested: false,
        bound: true,
        recipe_name: "Pollo",
      }).label
    ).toBe("Confirmado");
    expect(
      displayStateForProduct({
        confirmed: false,
        is_combo: false,
        classification: "requiere_receta",
        kind_label: "Plato",
        ambiguous: true,
        suggested: true,
        bound: true,
        recipe_name: "Pupusa",
      }).tone
    ).toBe("bad");
    expect(
      displayStateForProduct({
        confirmed: false,
        is_combo: false,
        classification: "requiere_receta",
        kind_label: "Plato",
        ambiguous: false,
        suggested: true,
        bound: false,
        recipe_name: null,
      }).label
    ).toBe("Sin receta");
  });

  it("builds an evidence checklist and Odoo sync copy", () => {
    expect(namesAlmostEqual("Pupusas revueltas", "Pupusa revuelta")).toBe(true);
    const checks = evidenceChecklist({
      odoo_name: "Pupusas revueltas",
      block_name: "Pupusa revuelta",
      evidence: parseSuggestionEvidence({
        tab: "PLATOS",
        block_name: "Pupusa revuelta",
        evidence: "precio Excel $1.50 = POS",
        reasons: ["Ninguna otra receta lo vende"],
      }),
      pos_price: 1.5,
      currency: "USD",
    });
    expect(checks[0]?.ok).toBe(true);
    expect(formatUnitsLabel(6590)).toMatch(/6[,.]590 uds/);
    const eightMinAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString();
    expect(odooSyncLabel(eightMinAgo)).toBe("Odoo sincronizado hace 8 min");
  });
});
