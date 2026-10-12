// lib/restaurant/pos-product-list.ts
//
// Rank Odoo products by share of net sales and compute coverage.
// Coverage = % of net sales with a Confirmado link AND an Aprobada
// recipe version. Combo child lines roll up to the parent combo;
// they are not top-level sold products. No KPI math belongs in React.

import { classifySaleLine } from "@/lib/restaurant/sales-revenue";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import {
  CLASSIFICATION_LABELS,
  LINK_STATE_LABELS,
  matchPosProductLink,
  odooProductIdFromMetadata,
  unlinkedPosProduct,
  type PosProductClassification,
  type PosProductLinkRecord,
  type PosProductLinkState,
} from "@/lib/restaurant/pos-product-links";

export interface PosSaleLineForProductList {
  company_id: string;
  location_id?: string | null;
  raw_item_name: string;
  gross_revenue?: number | null;
  net_revenue?: number | null;
  is_tip?: boolean | null;
  source_metadata?: Record<string, unknown> | null;
  external_line_id?: string | null;
  combo_parent_external_line_id?: string | null;
  combo_parent_odoo_product_id?: number | null;
}

export interface RecipeVersionForCoverage {
  menu_item_id: string;
  status: string;
}

export interface ComboComponentShare {
  odoo_product_id: number;
  odoo_name: string;
  net_sales: number;
}

export interface RankedPosProduct {
  odoo_product_id: number;
  odoo_name: string;
  net_sales: number;
  share_of_net_sales: number;
  is_combo: boolean;
  components: ComboComponentShare[];
  classification: PosProductClassification;
  classification_label: string;
  link_state: PosProductLinkState;
  link_state_label: string;
  menu_item_id: string | null;
  counts_toward_coverage: boolean;
}

export interface PosProductListResult {
  company_id: string;
  net_sales: number;
  covered_net_sales: number;
  coverage_pct: number;
  products: RankedPosProduct[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function parentProductIdFromLine(
  line: PosSaleLineForProductList,
  productByExternalLineId: Map<string, number>
): number | null {
  if (
    typeof line.combo_parent_odoo_product_id === "number" &&
    Number.isInteger(line.combo_parent_odoo_product_id)
  ) {
    return line.combo_parent_odoo_product_id;
  }
  const parentLineId = line.combo_parent_external_line_id?.trim();
  if (!parentLineId) return null;
  return productByExternalLineId.get(parentLineId) ?? null;
}

interface Accumulator {
  odoo_product_id: number;
  odoo_name: string;
  net_sales: number;
  standalone_net: number;
  is_combo: boolean;
  components: Map<number, ComboComponentShare>;
}

function rememberName(current: string, next: string): string {
  const trimmed = next.trim();
  return trimmed.length > 0 ? trimmed : current;
}

/**
 * Build the sellable product list for one company.
 * Rows from any other company_id are ignored (tenant isolation).
 */
export function buildPosProductList(input: {
  companyId: string;
  sales: readonly PosSaleLineForProductList[];
  links: readonly PosProductLinkRecord[];
  recipeVersions: readonly RecipeVersionForCoverage[];
  locationId?: string | null;
}): PosProductListResult {
  const companyId = input.companyId;
  const locationId = input.locationId ?? null;

  const productByExternalLineId = new Map<string, number>();
  for (const line of input.sales) {
    if (line.company_id !== companyId) continue;
    const productId = odooProductIdFromMetadata(line.source_metadata);
    const lineId = line.external_line_id?.trim();
    if (productId !== null && lineId) {
      productByExternalLineId.set(lineId, productId);
    }
  }

  const byProduct = new Map<number, Accumulator>();
  const ensure = (odooProductId: number, name: string): Accumulator => {
    const existing = byProduct.get(odooProductId);
    if (existing) {
      existing.odoo_name = rememberName(existing.odoo_name, name);
      return existing;
    }
    const created: Accumulator = {
      odoo_product_id: odooProductId,
      odoo_name: name.trim(),
      net_sales: 0,
      standalone_net: 0,
      is_combo: false,
      components: new Map(),
    };
    byProduct.set(odooProductId, created);
    return created;
  };

  for (const line of input.sales) {
    if (line.company_id !== companyId) continue;
    if (locationId && line.location_id !== locationId) {
      continue;
    }
    const ownProductId = odooProductIdFromMetadata(line.source_metadata);
    if (ownProductId === null) continue;

    const classified = classifySaleLine(line);
    if (classified.isTip) continue;

    const parentProductId = parentProductIdFromLine(
      line,
      productByExternalLineId
    );
    if (parentProductId !== null && parentProductId !== ownProductId) {
      const parent = ensure(parentProductId, "");
      parent.is_combo = true;
      parent.net_sales = round2(parent.net_sales + classified.net);
      const component =
        parent.components.get(ownProductId) ??
        ({
          odoo_product_id: ownProductId,
          odoo_name: line.raw_item_name,
          net_sales: 0,
        } satisfies ComboComponentShare);
      component.odoo_name = rememberName(
        component.odoo_name,
        line.raw_item_name
      );
      component.net_sales = round2(component.net_sales + classified.net);
      parent.components.set(ownProductId, component);
      continue;
    }

    const product = ensure(ownProductId, line.raw_item_name);
    product.net_sales = round2(product.net_sales + classified.net);
    product.standalone_net = round2(product.standalone_net + classified.net);
  }

  const approvedByMenuItem = new Map<string, Array<{ status: string }>>();
  for (const version of input.recipeVersions) {
    const list = approvedByMenuItem.get(version.menu_item_id) ?? [];
    list.push({ status: version.status });
    approvedByMenuItem.set(version.menu_item_id, list);
  }

  const products: RankedPosProduct[] = [];
  for (const acc of byProduct.values()) {
    // Combo children with no stand-alone sales are components, not
    // top-level sold products. Combo parents stay even when their own
    // line is $0.
    if (!acc.is_combo && acc.standalone_net <= 0 && acc.net_sales <= 0) {
      continue;
    }
    if (!acc.is_combo && acc.standalone_net <= 0) continue;

    const link =
      matchPosProductLink(
        input.links,
        companyId,
        acc.odoo_product_id,
        locationId
      ) ??
      unlinkedPosProduct({
        company_id: companyId,
        odoo_product_id: acc.odoo_product_id,
        odoo_name: acc.odoo_name,
        location_id: locationId,
      });

    const menuItemId = link.menu_item_id;
    const approved =
      menuItemId != null &&
      hasApprovedVersion(approvedByMenuItem.get(menuItemId) ?? []);
    const countsTowardCoverage = link.link_state === "confirmado" && approved;

    products.push({
      odoo_product_id: acc.odoo_product_id,
      odoo_name: acc.odoo_name || link.odoo_name,
      net_sales: acc.net_sales,
      share_of_net_sales: 0,
      is_combo: acc.is_combo,
      components: [...acc.components.values()].sort(
        (a, b) =>
          b.net_sales - a.net_sales ||
          a.odoo_name.localeCompare(b.odoo_name) ||
          a.odoo_product_id - b.odoo_product_id
      ),
      classification: link.classification,
      classification_label: CLASSIFICATION_LABELS[link.classification],
      link_state: link.link_state,
      link_state_label: LINK_STATE_LABELS[link.link_state],
      menu_item_id: menuItemId,
      counts_toward_coverage: countsTowardCoverage,
    });
  }

  const netSales = round2(
    products.reduce((sum, product) => sum + product.net_sales, 0)
  );
  const coveredNetSales = round2(
    products
      .filter((product) => product.counts_toward_coverage)
      .reduce((sum, product) => sum + product.net_sales, 0)
  );

  products.sort(
    (a, b) =>
      b.net_sales - a.net_sales ||
      a.odoo_name.localeCompare(b.odoo_name) ||
      a.odoo_product_id - b.odoo_product_id
  );
  for (const product of products) {
    product.share_of_net_sales =
      netSales === 0 ? 0 : product.net_sales / netSales;
  }

  return {
    company_id: companyId,
    net_sales: netSales,
    covered_net_sales: coveredNetSales,
    coverage_pct:
      netSales === 0 ? 0 : round1((coveredNetSales / netSales) * 100),
    products,
  };
}
