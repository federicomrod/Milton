import { describe, expect, it } from "vitest";
import {
  buildPosProductList,
  type PosSaleLineForProductList,
} from "@/lib/restaurant/pos-product-list";
import {
  classificationFromStored,
  confirmPosProductLink,
  suggestPosProductLink,
  unlinkedPosProduct,
  type PosProductClassification,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  effectiveTreatment,
  isCovered,
  suggestTreatment,
} from "@/lib/restaurant/pos-treatments";
import { undoConfirmedLinkResult } from "@/lib/restaurant/recipe-costing/link-actions";

function sale(
  productId: number,
  name: string,
  net: number,
  extra: Partial<PosSaleLineForProductList> = {}
): PosSaleLineForProductList {
  return {
    company_id: "co-a",
    location_id: null,
    raw_item_name: name,
    gross_revenue: net,
    net_revenue: net,
    quantity: 1,
    is_tip: false,
    source_metadata: { product_id: productId },
    external_line_id: `${productId}-${name}-${net}`,
    ...extra,
  };
}

function link(
  productId: number,
  classification: PosProductClassification,
  opts: { menu?: string; confirmed?: boolean } = {}
): PosProductLinkRecord {
  const base = {
    ...unlinkedPosProduct({
      company_id: "co-a",
      odoo_product_id: productId,
      odoo_name: `P${productId}`,
    }),
    classification,
    menu_item_id: opts.menu ?? null,
  };
  return opts.confirmed
    ? confirmPosProductLink(base, {
        confirmed_by: "u",
        confirmed_at: "2026-10-13T00:00:00Z",
        confirmed_how: "en_pantalla",
      })
    : base;
}

describe("treatments — suggestions (never saved by themselves)", () => {
  it("suggests from POS structure and name", () => {
    const s = (name: string, is_combo = false) =>
      suggestTreatment({ name, is_combo }).treatment;
    expect(s("Combo familiar", true)).toBe("combo");
    expect(s("Propina")).toBe("excluido");
    expect(s("Cargo por servicio")).toBe("excluido");
    expect(s("Sin cebolla")).toBe("modificador_sin_costo");
    expect(s("Extra queso")).toBe("modificador_con_costo");
    expect(s("Coca-Cola lata")).toBe("reventa");
    expect(s("Cerveza nacional")).toBe("reventa");
    expect(s("Limonada con hierbabuena")).toBe("plato_preparado");
    expect(s("Pollo al carbón")).toBe("plato_preparado");
  });

  it("every suggestion carries a reason in Spanish", () => {
    for (const name of ["Propina", "Extra queso", "Pupusa"]) {
      expect(suggestTreatment({ name, is_combo: false }).reason).toMatch(/\w/);
    }
  });
});

describe("treatments — what counts as covered", () => {
  it("an unclassified Odoo combo is a combo; a saved treatment wins", () => {
    expect(
      effectiveTreatment({ classification: "por_clasificar", is_combo: true })
    ).toBe("combo");
    expect(
      effectiveTreatment({ classification: "plato_preparado", is_combo: true })
    ).toBe("plato_preparado");
  });

  it("dishes need a confirmed link and an approved recipe", () => {
    const dish = { treatment: "plato_preparado" as const };
    expect(isCovered({ ...dish, confirmed: true, approved: true })).toBe(true);
    expect(isCovered({ ...dish, confirmed: true, approved: false })).toBe(
      false
    );
    expect(isCovered({ ...dish, confirmed: false, approved: true })).toBe(
      false
    );
  });

  it("no-cost modifiers count at zero; excluded never counts", () => {
    expect(
      isCovered({
        treatment: "modificador_sin_costo",
        confirmed: false,
        approved: false,
      })
    ).toBe(true);
    expect(
      isCovered({ treatment: "excluido", confirmed: true, approved: true })
    ).toBe(false);
  });

  it("a combo is covered when every part's cost is known", () => {
    const ok = {
      treatment: "plato_preparado" as const,
      confirmed: true,
      approved: true,
    };
    const free = {
      treatment: "modificador_sin_costo" as const,
      confirmed: false,
      approved: false,
    };
    const open = {
      treatment: "por_clasificar" as const,
      confirmed: false,
      approved: false,
    };
    const combo = {
      treatment: "combo" as const,
      confirmed: false,
      approved: false,
    };
    expect(isCovered({ ...combo, parts: [ok, free] })).toBe(true);
    expect(isCovered({ ...combo, parts: [ok, open] })).toBe(false);
    expect(isCovered({ ...combo, parts: [] })).toBe(false);
  });
});

describe("coverage is over food net sales", () => {
  const versions = [
    { menu_item_id: "m-dish", status: "approved" },
    { menu_item_id: "m-part", status: "approved" },
  ];

  it("excluded sales leave the denominator; shares are of food sales", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale(1, "Pollo", 60),
        sale(2, "Sopa", 20),
        sale(3, "Propina", 20),
      ],
      links: [
        link(1, "plato_preparado", { menu: "m-dish", confirmed: true }),
        link(3, "excluido"),
      ],
      recipeVersions: versions,
    });
    expect(list.net_sales).toBe(100);
    expect(list.food_net_sales).toBe(80);
    expect(list.excluded_net_sales).toBe(20);
    expect(list.covered_net_sales).toBe(60);
    expect(list.coverage_pct).toBe(75);
    const byId = new Map(list.products.map((p) => [p.odoo_product_id, p]));
    expect(byId.get(1)?.share_of_food_sales).toBeCloseTo(0.75);
    expect(byId.get(3)?.share_of_food_sales).toBe(0);
    expect(byId.get(3)?.in_food_sales).toBe(false);
  });

  it("an unclassified product counts in food sales and gets a suggestion", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [sale(1, "Propina", 10), sale(2, "Pupusa", 30)],
      links: [],
      recipeVersions: [],
    });
    expect(list.food_net_sales).toBe(40);
    const tip = list.products.find((p) => p.odoo_product_id === 1);
    expect(tip?.classification).toBe("por_clasificar");
    expect(tip?.suggested_treatment?.treatment).toBe("excluido");
    expect(tip?.in_food_sales).toBe(true);
  });

  it("a combo counts when its parts are covered", () => {
    const parent = sale(10, "Combo", 0, { external_line_id: "p1" });
    const part = sale(11, "Pollo", 50, {
      external_line_id: "c1",
      combo_parent_external_line_id: "p1",
    });
    const free = sale(12, "Sin hielo", 0.01, {
      external_line_id: "c2",
      combo_parent_external_line_id: "p1",
    });
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [parent, part, free],
      links: [
        link(11, "plato_preparado", { menu: "m-part", confirmed: true }),
        link(12, "modificador_sin_costo"),
      ],
      recipeVersions: versions,
    });
    const combo = list.products.find((p) => p.odoo_product_id === 10);
    expect(combo?.treatment).toBe("combo");
    expect(combo?.counts_toward_coverage).toBe(true);
    expect(list.coverage_pct).toBe(100);

    const uncovered = buildPosProductList({
      companyId: "co-a",
      sales: [parent, part, free],
      links: [link(12, "modificador_sin_costo")],
      recipeVersions: versions,
    });
    expect(
      uncovered.products.find((p) => p.odoo_product_id === 10)
        ?.counts_toward_coverage
    ).toBe(false);
  });
});

describe("pre-040 values", () => {
  it("are read as their treatment", () => {
    expect(classificationFromStored("requiere_receta")).toBe("plato_preparado");
    expect(classificationFromStored("componente")).toBe(
      "modificador_con_costo"
    );
    expect(classificationFromStored("no_requiere_costeo")).toBe("excluido");
    expect(classificationFromStored("algo raro")).toBe("por_clasificar");
    expect(classificationFromStored("reventa")).toBe("reventa");
  });

  it("undo restores a legacy snapshot as its treatment", () => {
    const confirmed = link(1, "plato_preparado", {
      menu: "m",
      confirmed: true,
    });
    const result = undoConfirmedLinkResult({
      ...confirmed,
      evidence: {
        __undo: {
          classification: "no_requiere_costeo",
          menu_item_id: "m",
          link_state: "sugerido",
          evidence: {},
        },
      },
    });
    expect(result.ok && result.link.classification).toBe("excluido");
  });

  it("a new suggestion keeps the person's treatment and its audit note", () => {
    const base = {
      ...link(1, "reventa"),
      evidence: { treatment: { value: "reventa", by: "u" } },
    };
    const next = suggestPosProductLink(base, {
      menu_item_id: "m",
      evidence: { source: "ai" },
    });
    expect(next.classification).toBe("reventa");
    expect(next.evidence.treatment).toEqual({ value: "reventa", by: "u" });
  });
});
