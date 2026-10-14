// lib/restaurant/pos-product-list.ts
//
// Rank Odoo products by share of net sales and compute coverage.
// Coverage = % of FOOD net sales whose cost is known: a Confirmado link
// AND an Aprobada recipe version, a no-cost modifier, or a combo whose
// parts are all covered. Products a person excluded (not food) leave the
// denominator (see pos-treatments.ts). Combo child lines roll up to the
// parent combo; they are not top-level sold products. No KPI math belongs
// in React.

import { classifySaleLine } from "@/lib/restaurant/sales-revenue";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import {
  CLASSIFICATION_LABELS,
  LINK_STATE_LABELS,
  matchPosProductLink,
  matchPosProductLinkForSales,
  odooProductIdFromMetadata,
  unlinkedPosProduct,
  type PosProductClassification,
  type PosProductLinkRecord,
  type PosProductLinkState,
} from "@/lib/restaurant/pos-product-links";
import {
  TREATMENT_RULES,
  effectiveTreatment,
  isCovered,
  suggestTreatment,
  type CoverageState,
  type TreatmentSuggestion,
} from "@/lib/restaurant/pos-treatments";

export interface PosSaleLineForProductList {
  company_id: string;
  location_id?: string | null;
  raw_item_name: string;
  quantity?: number | null;
  category?: string | null;
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
  /** Every POS name this product was sold under (renames included). */
  raw_names?: string[];
  net_sales: number;
  share_of_net_sales: number;
  units_sold: number;
  category: string | null;
  is_combo: boolean;
  components: ComboComponentShare[];
  /** Combo parts a person marked excluido: the combo stays uncovered. */
  excluded_parts: string[];
  /** Saved treatment ("por_clasificar" when nobody chose one). */
  classification: PosProductClassification;
  classification_label: string;
  /** Treatment used for coverage (an unclassified combo is a combo). */
  treatment: PosProductClassification;
  /** Shown until a person saves a treatment; never applied by itself. */
  suggested_treatment: TreatmentSuggestion | null;
  in_food_sales: boolean;
  /** Share of food net sales (0 for excluded products). */
  share_of_food_sales: number;
  link_state: PosProductLinkState;
  link_state_label: string;
  menu_item_id: string | null;
  counts_toward_coverage: boolean;
  /**
   * "Todos los restaurantes" only: the product's sales split by the link
   * that costs them, when restaurants resolve to different links (one
   * restaurant has its own link, another has none or a different one).
   * Each part carries only its restaurants' sales; totals add the parts.
   */
  parts?: RankedPosProduct[];
  /** On a part: whose link costs it. */
  sales_scope?: SalesScope;
}

export interface SalesScope {
  /** restaurante = that restaurant's own link; compartido = the
   *  company-wide link; sin_vinculo = no link applies to these sales. */
  kind: "restaurante" | "compartido" | "sin_vinculo";
  /** The restaurant of a "restaurante" link; null otherwise. */
  location_id: string | null;
  /** Restaurants whose sales are in this part ("" = no restaurant). */
  sale_location_ids: string[];
}

export interface PosProductListResult {
  company_id: string;
  net_sales: number;
  /** Coverage denominator: net sales minus excluded products. */
  food_net_sales: number;
  excluded_net_sales: number;
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
  units_sold: number;
  category: string | null;
  is_combo: boolean;
  components: Map<number, ComboComponentShare>;
  raw_names: Set<string>;
}

function newAccumulator(odooProductId: number, name: string): Accumulator {
  return {
    odoo_product_id: odooProductId,
    odoo_name: name.trim(),
    net_sales: 0,
    standalone_net: 0,
    units_sold: 0,
    category: null,
    is_combo: false,
    components: new Map(),
    raw_names: new Set(),
  };
}

function mergeAccumulators(accs: readonly Accumulator[]): Accumulator {
  const out = newAccumulator(accs[0].odoo_product_id, accs[0].odoo_name);
  for (const acc of accs) {
    out.odoo_name = rememberName(out.odoo_name, acc.odoo_name);
    out.net_sales = round2(out.net_sales + acc.net_sales);
    out.standalone_net = round2(out.standalone_net + acc.standalone_net);
    out.units_sold = round2(out.units_sold + acc.units_sold);
    out.category = out.category ?? acc.category;
    out.is_combo = out.is_combo || acc.is_combo;
    for (const name of acc.raw_names) out.raw_names.add(name);
    for (const part of acc.components.values()) {
      const current = out.components.get(part.odoo_product_id);
      out.components.set(part.odoo_product_id, {
        ...part,
        net_sales: round2((current?.net_sales ?? 0) + part.net_sales),
      });
    }
  }
  return out;
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
  // "Todos los restaurantes": the same sums per restaurant, so each
  // restaurant's sales are costed with its own (or the shared) link.
  const byProductLocation = new Map<number, Map<string, Accumulator>>();
  const ensureIn = (
    map: Map<number, Accumulator>,
    odooProductId: number,
    name: string
  ): Accumulator => {
    const existing = map.get(odooProductId);
    if (existing) {
      existing.odoo_name = rememberName(existing.odoo_name, name);
      return existing;
    }
    const created = newAccumulator(odooProductId, name);
    map.set(odooProductId, created);
    return created;
  };
  const targets = (
    odooProductId: number,
    name: string,
    saleLocation: string
  ): Accumulator[] => {
    const total = ensureIn(byProduct, odooProductId, name);
    if (locationId) return [total];
    let perLocation = byProductLocation.get(odooProductId);
    if (!perLocation) {
      perLocation = new Map();
      byProductLocation.set(odooProductId, perLocation);
    }
    const local =
      perLocation.get(saleLocation) ?? newAccumulator(odooProductId, name);
    local.odoo_name = rememberName(local.odoo_name, name);
    perLocation.set(saleLocation, local);
    return [total, local];
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

    const saleLocation = line.location_id ?? "";
    const parentProductId = parentProductIdFromLine(
      line,
      productByExternalLineId
    );
    if (parentProductId !== null && parentProductId !== ownProductId) {
      for (const parent of targets(parentProductId, "", saleLocation)) {
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
      }
      continue;
    }

    const qty =
      typeof line.quantity === "number" && Number.isFinite(line.quantity)
        ? line.quantity
        : 0;
    const rawName = line.raw_item_name.trim();
    for (const product of targets(
      ownProductId,
      line.raw_item_name,
      saleLocation
    )) {
      if (rawName) product.raw_names.add(rawName);
      product.net_sales = round2(product.net_sales + classified.net);
      product.standalone_net = round2(product.standalone_net + classified.net);
      product.units_sold = round2(product.units_sold + qty);
      if (!product.category && line.category?.trim()) {
        product.category = line.category.trim();
      }
    }
  }

  const approvedByMenuItem = new Map<string, Array<{ status: string }>>();
  for (const version of input.recipeVersions) {
    const list = approvedByMenuItem.get(version.menu_item_id) ?? [];
    list.push({ status: version.status });
    approvedByMenuItem.set(version.menu_item_id, list);
  }

  /** The link for a product: the selected restaurant's rule, or (for a
   *  part) strictly the link of the restaurants whose sales it holds. */
  const linkOf = (
    odooProductId: number,
    scope: { strict: boolean; location: string | null }
  ): PosProductLinkRecord | null =>
    scope.strict
      ? matchPosProductLinkForSales(
          input.links,
          companyId,
          odooProductId,
          scope.location
        )
      : matchPosProductLink(
          input.links,
          companyId,
          odooProductId,
          scope.location
        );

  const coverageStateFor = (
    odooProductId: number,
    isCombo: boolean,
    scope: { strict: boolean; location: string | null }
  ): CoverageState => {
    const link = linkOf(odooProductId, scope);
    const menuItemId = link?.menu_item_id ?? null;
    return {
      treatment: effectiveTreatment({
        classification: link?.classification ?? "por_clasificar",
        is_combo: isCombo,
      }),
      confirmed: link?.link_state === "confirmado",
      approved:
        menuItemId != null &&
        hasApprovedVersion(approvedByMenuItem.get(menuItemId) ?? []),
    };
  };

  const rowOf = (
    acc: Accumulator,
    scope: { strict: boolean; location: string | null }
  ): RankedPosProduct => {
    const link =
      linkOf(acc.odoo_product_id, scope) ??
      unlinkedPosProduct({
        company_id: companyId,
        odoo_product_id: acc.odoo_product_id,
        odoo_name: acc.odoo_name,
        location_id: scope.location,
      });

    const menuItemId = link.menu_item_id;
    const treatment = effectiveTreatment({
      classification: link.classification,
      is_combo: acc.is_combo,
    });
    const parts = acc.is_combo
      ? [...acc.components.keys()].map((partId) =>
          coverageStateFor(partId, false, scope)
        )
      : [];
    const countsTowardCoverage = isCovered({
      ...coverageStateFor(acc.odoo_product_id, acc.is_combo, scope),
      parts,
    });

    return {
      odoo_product_id: acc.odoo_product_id,
      odoo_name: acc.odoo_name || link.odoo_name,
      raw_names: [...acc.raw_names].sort(),
      net_sales: acc.net_sales,
      share_of_net_sales: 0,
      units_sold: acc.units_sold,
      category: acc.category,
      is_combo: acc.is_combo,
      excluded_parts: acc.is_combo
        ? [...acc.components.values()]
            .filter(
              (part) =>
                coverageStateFor(part.odoo_product_id, false, scope)
                  .treatment === "excluido"
            )
            .map((part) => part.odoo_name)
        : [],
      components: [...acc.components.values()].sort(
        (a, b) =>
          b.net_sales - a.net_sales ||
          a.odoo_name.localeCompare(b.odoo_name) ||
          a.odoo_product_id - b.odoo_product_id
      ),
      classification: link.classification,
      classification_label: CLASSIFICATION_LABELS[link.classification],
      treatment,
      suggested_treatment:
        link.classification === "por_clasificar"
          ? suggestTreatment({
              name: acc.odoo_name || link.odoo_name,
              is_combo: acc.is_combo,
            })
          : null,
      in_food_sales: TREATMENT_RULES[treatment].in_food_sales,
      share_of_food_sales: 0,
      link_state: link.link_state,
      link_state_label: LINK_STATE_LABELS[link.link_state],
      menu_item_id: menuItemId,
      counts_toward_coverage: countsTowardCoverage,
    };
  };

  /**
   * "Todos los restaurantes": split a product's sales by the link that
   * costs each restaurant's sales. Null when one link costs them all
   * (the usual case: a shared link, or one restaurant).
   */
  const partsOf = (acc: Accumulator): RankedPosProduct[] | undefined => {
    if (locationId) return undefined;
    const perLocation = byProductLocation.get(acc.odoo_product_id);
    if (!perLocation || perLocation.size === 0) return undefined;
    const shown = matchPosProductLink(
      input.links,
      companyId,
      acc.odoo_product_id,
      null
    );
    const groups = new Map<
      string,
      { link: PosProductLinkRecord | null; locations: string[] }
    >();
    for (const saleLocation of [...perLocation.keys()].sort()) {
      const link = matchPosProductLinkForSales(
        input.links,
        companyId,
        acc.odoo_product_id,
        saleLocation || null
      );
      const key = link
        ? `${link.location_id ?? "*"}:${link.odoo_product_id}`
        : "none";
      const group = groups.get(key) ?? { link, locations: [] };
      group.locations.push(saleLocation);
      groups.set(key, group);
    }
    const only = groups.size === 1 ? [...groups.values()][0] : null;
    if (only && only.link === shown) return undefined;
    return [...groups.values()].map(({ link, locations }) => {
      const merged = mergeAccumulators(
        locations.map((l) => perLocation.get(l) as Accumulator)
      );
      const linkLocation = link?.location_id ?? null;
      const row = rowOf(merged, { strict: true, location: linkLocation });
      row.sales_scope = {
        kind: !link
          ? "sin_vinculo"
          : link.location_id
            ? "restaurante"
            : "compartido",
        location_id: linkLocation,
        sale_location_ids: locations,
      };
      return row;
    });
  };

  const products: RankedPosProduct[] = [];
  for (const acc of byProduct.values()) {
    // Combo children with no stand-alone sales are components, not
    // top-level sold products. Combo parents stay even when their own
    // line is $0.
    if (!acc.is_combo && acc.standalone_net <= 0 && acc.net_sales <= 0) {
      continue;
    }
    if (!acc.is_combo && acc.standalone_net <= 0) continue;

    const row = rowOf(acc, { strict: false, location: locationId });
    const parts = partsOf(acc);
    if (parts) {
      row.parts = parts;
      // The product is food when any of its parts is; covered only when
      // every part is (the totals below add the parts themselves).
      row.in_food_sales = parts.some((p) => p.in_food_sales);
      row.counts_toward_coverage = parts.every((p) => p.counts_toward_coverage);
    }
    products.push(row);
  }

  // Totals add each restaurant's part on its own terms.
  const rows = products.flatMap((product) => product.parts ?? [product]);
  const netSales = round2(
    rows.reduce((sum, product) => sum + product.net_sales, 0)
  );
  const foodNetSales = round2(
    rows
      .filter((product) => product.in_food_sales)
      .reduce((sum, product) => sum + product.net_sales, 0)
  );
  const coveredNetSales = round2(
    rows
      .filter((product) => product.counts_toward_coverage)
      .reduce((sum, product) => sum + product.net_sales, 0)
  );
  const foodSalesOf = (product: RankedPosProduct) =>
    (product.parts ?? [product])
      .filter((p) => p.in_food_sales)
      .reduce((sum, p) => sum + p.net_sales, 0);

  products.sort(
    (a, b) =>
      b.net_sales - a.net_sales ||
      a.odoo_name.localeCompare(b.odoo_name) ||
      a.odoo_product_id - b.odoo_product_id
  );
  for (const product of [...products, ...rows]) {
    product.share_of_net_sales =
      netSales === 0 ? 0 : product.net_sales / netSales;
    product.share_of_food_sales =
      foodNetSales === 0 ? 0 : foodSalesOf(product) / foodNetSales;
  }

  return {
    company_id: companyId,
    net_sales: netSales,
    food_net_sales: foodNetSales,
    excluded_net_sales: round2(netSales - foodNetSales),
    covered_net_sales: coveredNetSales,
    coverage_pct:
      foodNetSales === 0 ? 0 : round1((coveredNetSales / foodNetSales) * 100),
    products,
  };
}
