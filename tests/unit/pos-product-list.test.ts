import { describe, expect, it } from "vitest";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  confirmPosProductLink,
  suggestPosProductLink,
  unlinkedPosProduct,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import type { PosSaleLineForProductList } from "@/lib/restaurant/pos-product-list";

function sale(
  overrides: Partial<PosSaleLineForProductList> & {
    product_id: number;
    raw_item_name: string;
    gross_revenue: number;
  }
): PosSaleLineForProductList {
  const { product_id, ...rest } = overrides;
  return {
    company_id: "co-a",
    location_id: "loc-1",
    net_revenue: overrides.gross_revenue,
    is_tip: false,
    source_metadata: { product_id },
    ...rest,
  };
}

describe("buildPosProductList — ranking", () => {
  it("ranks Odoo products by share of net sales", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 1,
          raw_item_name: "Agua",
          gross_revenue: 20,
          external_line_id: "1",
        }),
        sale({
          product_id: 2,
          raw_item_name: "Rib Eye",
          gross_revenue: 80,
          external_line_id: "2",
        }),
        sale({
          product_id: 1,
          raw_item_name: "Agua",
          gross_revenue: 10,
          external_line_id: "3",
        }),
      ],
      links: [],
      recipeVersions: [],
    });
    expect(list.net_sales).toBe(110);
    expect(list.products.map((p) => p.odoo_product_id)).toEqual([2, 1]);
    expect(list.products[0].net_sales).toBe(80);
    expect(list.products[0].share_of_net_sales).toBeCloseTo(80 / 110);
    expect(list.products[1].net_sales).toBe(30);
    expect(list.products[0].link_state).toBe("sin_vincular");
    expect(list.products[0].classification).toBe("por_clasificar");
  });

  it("excludes tips from net sales", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 1,
          raw_item_name: "Rib Eye",
          gross_revenue: 100,
          external_line_id: "1",
        }),
        sale({
          product_id: 99,
          raw_item_name: "Propina",
          gross_revenue: 15,
          is_tip: true,
          external_line_id: "2",
        }),
      ],
      links: [],
      recipeVersions: [],
    });
    expect(list.net_sales).toBe(100);
    expect(list.products).toHaveLength(1);
    expect(list.products[0].odoo_product_id).toBe(1);
  });
});

describe("buildPosProductList — combo roll-up", () => {
  it("rolls child prices onto the $0 parent combo and hides the children", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 10,
          raw_item_name: "Combo Almuerzo",
          gross_revenue: 0,
          external_line_id: "100",
        }),
        sale({
          product_id: 11,
          raw_item_name: "Hamburguesa",
          gross_revenue: 80,
          external_line_id: "101",
          combo_parent_external_line_id: "100",
          combo_parent_odoo_product_id: 10,
        }),
        sale({
          product_id: 12,
          raw_item_name: "Papas",
          gross_revenue: 40,
          external_line_id: "102",
          combo_parent_external_line_id: "100",
          combo_parent_odoo_product_id: 10,
        }),
        sale({
          product_id: 20,
          raw_item_name: "Limonada",
          gross_revenue: 15,
          external_line_id: "200",
        }),
      ],
      links: [],
      recipeVersions: [],
    });
    expect(list.products.map((p) => p.odoo_product_id)).toEqual([10, 20]);
    const combo = list.products[0];
    expect(combo.odoo_name).toBe("Combo Almuerzo");
    expect(combo.net_sales).toBe(120);
    expect(combo.is_combo).toBe(true);
    expect(combo.components.map((c) => c.odoo_product_id)).toEqual([11, 12]);
    expect(combo.components[0].net_sales).toBe(80);
    expect(list.products[1].net_sales).toBe(15);
    expect(list.net_sales).toBe(135);
  });

  it("keeps a child's own stand-alone sales as a separate top-level product", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 10,
          raw_item_name: "Combo",
          gross_revenue: 0,
          external_line_id: "100",
        }),
        sale({
          product_id: 11,
          raw_item_name: "Hamburguesa",
          gross_revenue: 80,
          external_line_id: "101",
          combo_parent_external_line_id: "100",
          combo_parent_odoo_product_id: 10,
        }),
        sale({
          product_id: 11,
          raw_item_name: "Hamburguesa",
          gross_revenue: 50,
          external_line_id: "201",
        }),
      ],
      links: [],
      recipeVersions: [],
    });
    expect(list.products.map((p) => p.odoo_product_id)).toEqual([10, 11]);
    expect(list.products[0].net_sales).toBe(80);
    expect(list.products[1].net_sales).toBe(50);
  });
});

describe("buildPosProductList — coverage and isolation", () => {
  it("counts coverage only for Confirmado + Aprobada", () => {
    const confirmedApproved = confirmPosProductLink(
      {
        ...unlinkedPosProduct({
          company_id: "co-a",
          odoo_product_id: 10,
          odoo_name: "Combo Almuerzo",
        }),
        menu_item_id: "menu-combo",
        classification: "requiere_receta",
      },
      {
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T12:00:00Z",
        confirmed_how: "manual",
      }
    );
    const suggestedApproved = suggestPosProductLink(
      unlinkedPosProduct({
        company_id: "co-a",
        odoo_product_id: 20,
        odoo_name: "Limonada",
      }),
      { menu_item_id: "menu-drink", evidence: { score: 1 } }
    );
    const confirmedUnapproved: PosProductLinkRecord = confirmPosProductLink(
      {
        ...unlinkedPosProduct({
          company_id: "co-a",
          odoo_product_id: 30,
          odoo_name: "Postre",
        }),
        menu_item_id: "menu-dessert",
        classification: "requiere_receta",
      },
      {
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T12:00:00Z",
        confirmed_how: "manual",
      }
    );

    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 10,
          raw_item_name: "Combo Almuerzo",
          gross_revenue: 100,
          external_line_id: "1",
        }),
        sale({
          product_id: 20,
          raw_item_name: "Limonada",
          gross_revenue: 40,
          external_line_id: "2",
        }),
        sale({
          product_id: 30,
          raw_item_name: "Postre",
          gross_revenue: 60,
          external_line_id: "3",
        }),
      ],
      links: [confirmedApproved, suggestedApproved, confirmedUnapproved],
      recipeVersions: [
        { menu_item_id: "menu-combo", status: "approved" },
        { menu_item_id: "menu-drink", status: "approved" },
        { menu_item_id: "menu-dessert", status: "in_review" },
      ],
    });

    expect(list.net_sales).toBe(200);
    expect(list.covered_net_sales).toBe(100);
    expect(list.coverage_pct).toBe(50);
    const byId = new Map(list.products.map((p) => [p.odoo_product_id, p]));
    expect(byId.get(10)?.counts_toward_coverage).toBe(true);
    expect(byId.get(10)?.link_state).toBe("confirmado");
    expect(byId.get(20)?.counts_toward_coverage).toBe(false);
    expect(byId.get(20)?.link_state).toBe("sugerido");
    expect(byId.get(30)?.counts_toward_coverage).toBe(false);
    expect(byId.get(30)?.link_state).toBe("confirmado");
  });

  it("ignores another tenant's sales and links", () => {
    const leakLink = confirmPosProductLink(
      {
        ...unlinkedPosProduct({
          company_id: "co-b",
          odoo_product_id: 1,
          odoo_name: "Secreto",
        }),
        menu_item_id: "menu-leak",
      },
      {
        confirmed_by: "user-b",
        confirmed_at: "2026-10-12T12:00:00Z",
        confirmed_how: "manual",
      }
    );
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 1,
          raw_item_name: "Agua",
          gross_revenue: 10,
          external_line_id: "a1",
        }),
        sale({
          company_id: "co-b",
          product_id: 1,
          raw_item_name: "Secreto",
          gross_revenue: 999,
          external_line_id: "b1",
        }),
      ],
      links: [leakLink],
      recipeVersions: [{ menu_item_id: "menu-leak", status: "approved" }],
    });
    expect(list.net_sales).toBe(10);
    expect(list.coverage_pct).toBe(0);
    expect(list.products).toHaveLength(1);
    expect(list.products[0].link_state).toBe("sin_vincular");
    expect(list.products[0].odoo_name).toBe("Agua");
  });

  it("never auto-confirms a product that has sales but no link row", () => {
    const list = buildPosProductList({
      companyId: "co-a",
      sales: [
        sale({
          product_id: 7,
          raw_item_name: "Nuevo",
          gross_revenue: 25,
          external_line_id: "7",
        }),
      ],
      links: [],
      recipeVersions: [{ menu_item_id: "anything", status: "approved" }],
    });
    expect(list.products[0].link_state).toBe("sin_vincular");
    expect(list.products[0].counts_toward_coverage).toBe(false);
    expect(list.coverage_pct).toBe(0);
  });
});
