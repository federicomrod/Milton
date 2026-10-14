// lib/restaurant/costing/dish-economics.ts
//
// One source of truth for what each sold dish costs and earns (R1-09a).
// Every screen (Menú, Platos, Recetas, Cockpit, Costos, the daily email,
// Ask Milton) reads these numbers; none of them recomputes cost or
// coverage on its own.
//
// Source of truth:
//   POS product (pos_sales_items, tips excluded)
//     → pos_product_links (odoo_product_id → menu_item_id, treatment)
//     → recipe_versions (approved = in force, in_review = estimate)
//     → recipe_version_inputs (lines; a line's own Excel cost wins, #227)
//     → ingredient_cost_entries (the single price record per ingredient)
//
// Lines are hydrated with the recipe editor's own `hydrateLines`, so a
// dish costs here exactly what the editor shows for it. Pure: no I/O.
//
// A missing price is never $0: such a dish has unit_cost = null and the
// status "falta_precio", and it is left out of COGS and coverage.

import type { CostingData } from "@/lib/restaurant/costing";
import {
  hydrateLines,
  type EditorLine,
  type EvidenceLineIn,
  type PriceMeta,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import type {
  PosProductListResult,
  RankedPosProduct,
  SalesScope,
} from "@/lib/restaurant/pos-product-list";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";

import { DISH_STATUS_LABELS, type DishStatus } from "./dish-status";
import {
  buildMenuDishes,
  type MenuDish,
  type MenuDishTotals,
  type StoredMenuDish,
  type StoredVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";

export { DISH_STATUS_LABELS, type DishStatus };

/** Excel COSTO TOTAL vs Milton: a gap above this is highlighted. */
export const EXCEL_DIFF_TOLERANCE = 0.05;

export type DishCostSource =
  /** Approved recipe version (in force). */
  | "receta_aprobada"
  /** Recipe still in review: an estimate, not counted in KPIs. */
  | "borrador"
  /** A person said it carries no cost (modificador sin costo). */
  | "sin_costo"
  /** Combo costed by its parts. */
  | "partes";

export interface DishLineEconomics {
  name: string;
  raw_name: string;
  kind: EditorLine["kind"];
  ingredient_id: string | null;
  component_id: string | null;
  qty: number;
  unit: string;
  /** Cost per line unit (full precision); null when unknown. */
  unit_cost: number | null;
  /** qty × unit_cost; null when unknown (never 0 for a missing price). */
  amount: number | null;
  /** True when the line is costed with its own cost from the Excel. */
  own_cost: boolean;
  /** Where the line's price came from: Excel cell, or the price record. */
  price_source: string | null;
  price_date: string | null;
  /** The ingredient's catalog price (the single price record). */
  catalog_price: PriceMeta | null;
  /** Unit cost the Excel line showed, kept as a reference. */
  excel_unit_cost: number | null;
  pending: boolean;
}

export interface DishEconomics {
  odoo_product_id: number;
  name: string;
  raw_names: string[];
  menu_item_id: string | null;
  category: string | null;
  treatment: PosProductClassification;
  is_combo: boolean;
  status: DishStatus;
  status_label: string;
  /** Cost of one unit sold (full precision). Null = unknown, never 0. */
  unit_cost: number | null;
  cost_source: DishCostSource | null;
  /** Approval date of the version in force, or the draft's latest date. */
  cost_date: string | null;
  recipe_version_id: string | null;
  /** The Excel's COSTO TOTAL for this dish, as a reference. */
  excel_total: number | null;
  /** unit_cost − excel_total (null when either is missing). */
  excel_diff: number | null;
  /** True when |excel_diff| > EXCEL_DIFF_TOLERANCE. */
  excel_diff_flag: boolean;
  units_sold: number;
  net_sales: number;
  /** 0–1 share of food net sales (the coverage denominator). */
  share_of_food_sales: number;
  /** Average net price per unit sold (tax and tips already out). */
  avg_net_price: number | null;
  /** 0–100; null without a known cost or price. */
  food_cost_pct: number | null;
  /** avg_net_price − unit_cost. */
  unit_margin: number | null;
  /** In the numerator of "Ventas con costo". */
  covered: boolean;
  /** Counted in COGS / food cost % (approved with a known cost). */
  in_cogs: boolean;
  lines: DishLineEconomics[];
  lines_missing_price: number;
  /** R1-10: the menu dish this POS variant belongs to. */
  menu_dish_id?: string | null;
  menu_dish_name?: string | null;
  /** Out of food costing (bebida, extra…): not in totals. */
  excluded_reason?: string | null;
  /** Where unit_cost comes from: its own recipe, or the dish's scaled. */
  cost_basis?: "own" | "dish" | null;
  /** The variant's own recipe cost, before the dish's was applied. */
  own_unit_cost?: number | null;
  /**
   * "Todos los restaurantes": set on a part (one restaurant's sales, costed
   * with that restaurant's own or the shared link). Unique per row.
   */
  row_key?: string;
  sales_scope?: SalesScope;
  /** The restaurant of the link that costs this row; null = the shared
   *  link (or none). */
  link_location_id?: string | null;
  /** The product's parts when its restaurants are costed differently;
   *  this row then holds their sums. */
  parts?: DishEconomicsPart[];
}

/** One restaurant group's numbers for a product (no lines). */
export type DishEconomicsPart = Omit<DishEconomics, "lines" | "parts">;

/** The key of a row: the product, or the product in one restaurant group. */
export function rowKeyOf(dish: {
  odoo_product_id: number;
  row_key?: string;
}): string {
  return dish.row_key ?? String(dish.odoo_product_id);
}

export interface DishEconomicsTotals {
  /** Coverage denominator: food net sales, tips and excluded out. */
  food_net_sales: number;
  excluded_net_sales: number;
  covered_net_sales: number;
  /** 0–100, one decimal. Sales-weighted. */
  coverage_pct: number;
  /** Net sales of the dishes counted in COGS. */
  cost_known_net_sales: number;
  estimated_cogs: number;
  /** estimated_cogs / cost_known_net_sales; null when nothing is costed. */
  food_cost_pct: number | null;
  gross_margin: number | null;
  gross_margin_pct: number | null;
  /** Average unit margin of the costed dishes, weighted by units sold. */
  avg_unit_margin: number | null;
  dish_count: number;
  approved_count: number;
  estimated_count: number;
  missing_price_count: number;
  no_recipe_count: number;
  /** Falta precio + Sin receta. */
  problem_count: number;
  /** Food net sales of dishes that have any recipe (approved or draft). */
  with_recipe_net_sales: number;
}

export interface DishEconomicsResult {
  company_id: string;
  currency: string;
  period: { from: string | null; to: string | null };
  /** False for a company with no Odoo product or link at all (CSV-only
   *  uploads): screens then fall back to the legacy name-mapped path. */
  uses_pos_products: boolean;
  /** Every sold POS product (variant), with its menu dish's effective cost. */
  dishes: DishEconomics[];
  /** Totals per menu dish (R1-10): one denominator, sums only. */
  totals: DishEconomicsTotals;
  /** Menu dishes (variants grouped) and the excluded ones. */
  menu_dishes: MenuDish[];
  excluded_menu_dishes: MenuDish[];
  menu_totals: MenuDishTotals;
  /** False until migration 045: grouping is Milton's, in memory only. */
  menu_dishes_stored?: boolean;
  /** Products whose grouping is Milton's suggestion, not stored yet. */
  menu_unsaved_variant_count?: number;
}

export interface DishVersion {
  id: string;
  menu_item_id: string;
  version_number: number;
  status: string;
  effective_date: string | null;
  approved_at?: string | null;
  created_at?: string | null;
}

export interface DishLinkInput {
  odoo_product_id: number;
  location_id: string | null;
  menu_item_id: string | null;
  link_state: string;
  evidence: Record<string, unknown>;
  /** Needed only for a linked recipe with no sales in the view. */
  odoo_name?: string;
  classification?: PosProductClassification;
}

export interface BuildDishEconomicsInput {
  companyId: string;
  currency: string;
  period?: { from: string | null; to: string | null };
  list: PosProductListResult;
  links: readonly DishLinkInput[];
  versions: readonly DishVersion[];
  /** recipe_version_inputs keyed by recipe_version_id. */
  inputsByVersionId: ReadonlyMap<string, VersionInput[]>;
  costing: CostingData;
  /** Evidence lines of a link (the editor's parser). */
  evidenceLinesOf: (evidence: Record<string, unknown>) => EvidenceLineIn[];
  /** Price meta for an ingredient (the editor's `latestPrice`). */
  priceOf: (ingredientId: string) => PriceMeta | null;
  locationId?: string | null;
  /** R1-10 (045): stored menu dishes and each variant's grouping. */
  storedMenuDishes?: readonly StoredMenuDish[];
  storedVariants?: ReadonlyMap<number, StoredVariant>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The link for a part's sales: that restaurant's own link, else the
 *  company-wide one; never another restaurant's (matchPosProductLinkForSales). */
function linkForSales(
  links: readonly DishLinkInput[],
  odooProductId: number,
  saleLocationId: string | null
): DishLinkInput | null {
  const same = links.filter((l) => l.odoo_product_id === odooProductId);
  if (saleLocationId) {
    const scoped = same.find((l) => l.location_id === saleLocationId);
    if (scoped) return scoped;
  }
  return same.find((l) => l.location_id == null) ?? null;
}

/** The link that applies to a product: the same rule as everywhere else
 *  (matchPosProductLink), including a restaurant-only link when no
 *  restaurant is selected. */
function linkFor(
  links: readonly DishLinkInput[],
  odooProductId: number,
  locationId: string | null
): DishLinkInput | null {
  const same = links.filter((l) => l.odoo_product_id === odooProductId);
  if (locationId) {
    const scoped = same.find((l) => l.location_id === locationId);
    if (scoped) return scoped;
  }
  const companyWide = same.find((l) => l.location_id == null);
  if (companyWide || locationId) return companyWide ?? null;
  return (
    same
      .filter((l) => l.location_id != null)
      .sort(
        (a, b) =>
          Number(b.link_state === "confirmado") -
            Number(a.link_state === "confirmado") ||
          String(a.location_id).localeCompare(String(b.location_id))
      )[0] ?? null
  );
}

function latest<T extends { version_number: number }>(rows: readonly T[]) {
  let best: T | null = null;
  for (const row of rows) {
    if (!best || row.version_number > best.version_number) best = row;
  }
  return best;
}

/** The approved version in force today (latest approved number). */
function approvedInForce(rows: readonly DishVersion[]): DishVersion | null {
  return latest(rows.filter((row) => row.status === "approved"));
}

function lineEconomics(line: EditorLine): DishLineEconomics {
  const own = line.own_cost === true;
  return {
    name: line.name ?? line.raw_name,
    raw_name: line.raw_name,
    kind: line.kind,
    ingredient_id: line.ingredient_id,
    component_id: line.component_id,
    qty: line.qty,
    unit: line.unit,
    unit_cost: line.unit_cost,
    amount: line.amount,
    own_cost: own,
    price_source: own ? "excel" : (line.price?.source ?? null),
    price_date: own ? null : (line.price?.date ?? null),
    catalog_price: line.price,
    excel_unit_cost: line.excel_unit_cost,
    pending: line.pending,
  };
}

/** Editor total: known only when every line is costed (never a partial). */
export function totalOfLines(lines: readonly EditorLine[]): number | null {
  if (lines.length === 0) return null;
  if (lines.some((line) => line.pending || line.amount === null)) return null;
  return lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
}

function dishFromProduct(
  product: RankedPosProduct,
  input: BuildDishEconomicsInput,
  versionsByMenuItem: ReadonlyMap<string, DishVersion[]>,
  names: {
    ingredients: ReadonlyMap<string, string>;
    components: ReadonlyMap<string, string>;
  }
): DishEconomics {
  const link = product.sales_scope
    ? linkForSales(
        input.links,
        product.odoo_product_id,
        product.sales_scope.location_id
      )
    : linkFor(input.links, product.odoo_product_id, input.locationId ?? null);
  const menuItemId = product.menu_item_id ?? link?.menu_item_id ?? null;
  const versions = menuItemId ? (versionsByMenuItem.get(menuItemId) ?? []) : [];
  const approved = approvedInForce(versions);
  const newest = latest(versions);
  const evidence = link?.evidence ?? {};
  const excelTotal = asFiniteNumber(evidence.excel_total);

  // The version this dish is costed with: the approved one in force, or
  // the draft the editor shows when nothing is approved yet.
  const version = approved ?? newest;
  let lines: EditorLine[] = [];
  if (version) {
    // The link's evidence describes the newest version (the one the
    // editor shows). An older approved version is costed on its inputs
    // alone so the draft's unresolved lines do not leak into it.
    const evidenceLines =
      version.id === newest?.id ? input.evidenceLinesOf(evidence) : [];
    lines = hydrateLines({
      data: input.costing,
      evidenceLines,
      inputs: input.inputsByVersionId.get(version.id) ?? [],
      names: {
        ingredients: names.ingredients,
        components: names.components,
        priceOf: input.priceOf,
        suggest: () => null,
      },
    });
  }
  const linesTotal = totalOfLines(lines);
  const missing = lines.filter((l) => l.pending || l.amount === null).length;

  let status: DishStatus;
  let unitCost: number | null = null;
  let costSource: DishCostSource | null = null;
  let costDate: string | null = null;

  if (product.treatment === "modificador_sin_costo") {
    status = "aprobado";
    unitCost = 0;
    costSource = "sin_costo";
  } else if (product.treatment === "combo" && !approved) {
    // A combo is costed by its parts; covered when they all are.
    status = product.counts_toward_coverage ? "aprobado" : "sin_receta";
    costSource = product.counts_toward_coverage ? "partes" : null;
  } else if (!version || lines.length === 0) {
    status = "sin_receta";
  } else if (linesTotal === null) {
    status = "falta_precio";
    costSource = approved ? "receta_aprobada" : "borrador";
  } else if (approved && product.counts_toward_coverage) {
    status = "aprobado";
    unitCost = linesTotal;
    costSource = "receta_aprobada";
    costDate =
      approved.approved_at?.slice(0, 10) ?? approved.effective_date ?? null;
  } else {
    // A draft (AI or import) with every price known: an estimate.
    status = "estimado";
    unitCost = linesTotal;
    costSource = approved ? "receta_aprobada" : "borrador";
    costDate =
      (approved?.approved_at ?? version.created_at)?.slice(0, 10) ?? null;
  }

  const avgNetPrice =
    product.units_sold > 0 ? product.net_sales / product.units_sold : null;
  const foodCostPct =
    unitCost !== null && avgNetPrice !== null && avgNetPrice > 0
      ? (unitCost / avgNetPrice) * 100
      : null;
  const unitMargin =
    unitCost !== null && avgNetPrice !== null ? avgNetPrice - unitCost : null;
  const excelDiff =
    unitCost !== null && excelTotal !== null ? unitCost - excelTotal : null;

  const covered =
    status === "aprobado" &&
    product.in_food_sales &&
    product.counts_toward_coverage;
  const inCogs = covered && unitCost !== null;

  return {
    odoo_product_id: product.odoo_product_id,
    name: product.odoo_name,
    raw_names: product.raw_names ?? [product.odoo_name],
    menu_item_id: menuItemId,
    category: product.category,
    treatment: product.treatment,
    is_combo: product.is_combo,
    status,
    status_label: DISH_STATUS_LABELS[status],
    unit_cost: unitCost,
    cost_source: costSource,
    cost_date: costDate,
    recipe_version_id: version?.id ?? null,
    excel_total: excelTotal,
    excel_diff: excelDiff,
    excel_diff_flag:
      excelDiff !== null && Math.abs(excelDiff) > EXCEL_DIFF_TOLERANCE,
    units_sold: product.units_sold,
    net_sales: product.net_sales,
    share_of_food_sales: product.share_of_food_sales,
    avg_net_price: avgNetPrice,
    food_cost_pct: foodCostPct,
    unit_margin: unitMargin,
    covered,
    in_cogs: inCogs,
    lines: lines.map(lineEconomics),
    lines_missing_price: missing,
    link_location_id: link?.location_id ?? null,
    ...(product.sales_scope
      ? {
          row_key: `${product.odoo_product_id}@${
            product.sales_scope.location_id ?? product.sales_scope.kind
          }`,
          sales_scope: product.sales_scope,
        }
      : {}),
  };
}

const STATUS_ORDER: DishStatus[] = [
  "falta_precio",
  "estimado",
  "sin_receta",
  "aprobado",
];

/**
 * One row per product from its restaurant parts: sums only. Covered only
 * when every part is; a unit cost only when every part has one (then
 * the units-weighted cost, so cost × units equals the parts' cost).
 */
function mergeParts(parts: readonly DishEconomics[]): DishEconomics {
  const base =
    [...parts]
      .sort((a, b) => b.net_sales - a.net_sales)
      .find((p) => p.recipe_version_id !== null) ?? parts[0];
  const units = round2(parts.reduce((s, p) => s + p.units_sold, 0));
  const net = round2(parts.reduce((s, p) => s + p.net_sales, 0));
  const allCosted = parts.every((p) => p.unit_cost !== null);
  const costTotal = parts.reduce(
    (s, p) => s + (p.unit_cost ?? 0) * p.units_sold,
    0
  );
  const unitCost = allCosted && units > 0 ? costTotal / units : null;
  const status =
    STATUS_ORDER.find((st) => parts.some((p) => p.status === st)) ??
    base.status;
  const avg = units > 0 ? net / units : null;
  const rest: DishEconomics = { ...base };
  delete rest.row_key;
  delete rest.sales_scope;
  return {
    ...rest,
    raw_names: [...new Set(parts.flatMap((p) => p.raw_names))].sort(),
    status,
    status_label: DISH_STATUS_LABELS[status],
    unit_cost: unitCost,
    units_sold: units,
    net_sales: net,
    share_of_food_sales: parts.reduce((s, p) => s + p.share_of_food_sales, 0),
    avg_net_price: avg,
    food_cost_pct:
      unitCost !== null && avg !== null && avg > 0
        ? (unitCost / avg) * 100
        : null,
    unit_margin: unitCost !== null && avg !== null ? avg - unitCost : null,
    covered: parts.every((p) => p.covered),
    in_cogs: parts.every((p) => p.in_cogs),
    excel_diff:
      unitCost !== null && base.excel_total !== null
        ? unitCost - base.excel_total
        : null,
    excel_diff_flag:
      unitCost !== null &&
      base.excel_total !== null &&
      Math.abs(unitCost - base.excel_total) > EXCEL_DIFF_TOLERANCE,
    parts: parts.map((p) => {
      const part: Partial<DishEconomics> = { ...p };
      delete part.lines;
      delete part.parts;
      return part as DishEconomicsPart;
    }),
  };
}

export function totalsOf(
  dishes: readonly DishEconomics[],
  list: Pick<PosProductListResult, "food_net_sales" | "excluded_net_sales">
): DishEconomicsTotals {
  const food = list.food_net_sales;
  let covered = 0;
  let costKnown = 0;
  let cogs = 0;
  let withRecipe = 0;
  let marginUnits = 0;
  let marginSum = 0;
  const count: Record<DishStatus, number> = {
    aprobado: 0,
    estimado: 0,
    falta_precio: 0,
    sin_receta: 0,
  };
  for (const dish of dishes) {
    count[dish.status] += 1;
    if (dish.covered) covered += dish.net_sales;
    if (dish.status !== "sin_receta") withRecipe += dish.net_sales;
    if (dish.in_cogs && dish.unit_cost !== null) {
      costKnown += dish.net_sales;
      cogs += dish.unit_cost * dish.units_sold;
      if (dish.unit_margin !== null && dish.units_sold > 0) {
        marginSum += dish.unit_margin * dish.units_sold;
        marginUnits += dish.units_sold;
      }
    }
  }
  const foodCostPct = costKnown > 0 ? round1((cogs / costKnown) * 100) : null;
  const grossMargin = costKnown > 0 ? round2(costKnown - cogs) : null;
  return {
    food_net_sales: round2(food),
    excluded_net_sales: round2(list.excluded_net_sales),
    covered_net_sales: round2(covered),
    coverage_pct: food > 0 ? round1((covered / food) * 100) : 0,
    cost_known_net_sales: round2(costKnown),
    estimated_cogs: round2(cogs),
    food_cost_pct: foodCostPct,
    gross_margin: grossMargin,
    gross_margin_pct:
      costKnown > 0 ? round1(((costKnown - cogs) / costKnown) * 100) : null,
    avg_unit_margin: marginUnits > 0 ? round2(marginSum / marginUnits) : null,
    dish_count: dishes.length,
    approved_count: count.aprobado,
    estimated_count: count.estimado,
    missing_price_count: count.falta_precio,
    no_recipe_count: count.sin_receta,
    problem_count: count.falta_precio + count.sin_receta,
    with_recipe_net_sales: round2(withRecipe),
  };
}

/**
 * Cost and economics of every food dish sold in the period, top sellers
 * first, plus the totals every screen shows. Products a person excluded
 * (tips, cargos, merchandise) are left out entirely.
 */
export function buildDishEconomics(
  input: BuildDishEconomicsInput
): DishEconomicsResult {
  const versionsByMenuItem = new Map<string, DishVersion[]>();
  for (const version of input.versions) {
    const list = versionsByMenuItem.get(version.menu_item_id) ?? [];
    list.push(version);
    versionsByMenuItem.set(version.menu_item_id, list);
  }
  const names = {
    ingredients: new Map(
      [...input.costing.ingredientsById.values()].map((r) => [r.id, r.name])
    ),
    components: new Map(
      [...input.costing.componentsById.values()].map((r) => [r.id, r.name])
    ),
  };
  // A product whose restaurants are costed by different links ("Todos los
  // restaurantes") is costed per part: each restaurant's sales only with
  // its own or the shared link (#237 review).
  const rows = input.list.products
    .filter((product) => product.in_food_sales)
    .flatMap((product) => product.parts ?? [product])
    .filter((product) => product.in_food_sales)
    .map((product) =>
      dishFromProduct(product, input, versionsByMenuItem, names)
    );
  // Linked recipes with no sales in this view (sold only in the other
  // restaurant): candidates for their menu dish's recipe, never rows.
  const sold = new Set(input.list.products.map((p) => p.odoo_product_id));
  const recipeOnly: DishEconomics[] = [];
  const seenRecipeOnly = new Set<number>();
  for (const l of input.links) {
    const id = l.odoo_product_id;
    if (sold.has(id) || seenRecipeOnly.has(id) || !l.odoo_name) continue;
    const link = input.locationId
      ? linkForSales(input.links, id, input.locationId)
      : linkFor(input.links, id, null);
    if (!link?.menu_item_id || !versionsByMenuItem.has(link.menu_item_id)) {
      continue;
    }
    seenRecipeOnly.add(id);
    const classification = link.classification ?? "por_clasificar";
    if (
      classification === "excluido" ||
      classification === "modificador_sin_costo"
    ) {
      continue;
    }
    const approved = (versionsByMenuItem.get(link.menu_item_id) ?? []).some(
      (v) => v.status === "approved"
    );
    const product: RankedPosProduct = {
      odoo_product_id: id,
      odoo_name: link.odoo_name ?? l.odoo_name,
      net_sales: 0,
      share_of_net_sales: 0,
      units_sold: 0,
      category: null,
      is_combo: false,
      components: [],
      excluded_parts: [],
      classification,
      classification_label: classification,
      treatment: classification,
      suggested_treatment: null,
      in_food_sales: true,
      share_of_food_sales: 0,
      link_state: link.link_state as RankedPosProduct["link_state"],
      link_state_label: link.link_state,
      menu_item_id: link.menu_item_id,
      counts_toward_coverage: link.link_state === "confirmado" && approved,
    };
    const dish = dishFromProduct(product, input, versionsByMenuItem, names);
    if (dish.unit_cost !== null) recipeOnly.push(dish);
  }

  // R1-10: group the variants into menu dishes; every number every screen
  // shows is then the dish-level one (sums, never averages).
  const grouped = buildMenuDishes({
    products: rows,
    storedDishes: input.storedMenuDishes,
    storedVariants: input.storedVariants,
    allRestaurants: !input.locationId,
    recipeOnly,
    excludedNetSalesBefore: input.list.excluded_net_sales,
  });
  const nameOf = new Map(
    [...grouped.dishes, ...grouped.excluded].map((d) => [d.id, d])
  );
  for (const dish of rows) {
    const hit = grouped.byProduct.get(rowKeyOf(dish));
    if (!hit) continue;
    const menuDish = nameOf.get(hit.dish_id);
    const v = hit.variant;
    dish.menu_dish_id = hit.dish_id;
    dish.menu_dish_name = menuDish?.name ?? null;
    dish.own_unit_cost = dish.unit_cost;
    if (menuDish?.status === "excluded") {
      dish.excluded_reason = menuDish.excluded_reason;
      dish.covered = false;
      dish.in_cogs = false;
      dish.share_of_food_sales = 0;
      continue;
    }
    dish.cost_basis = v.cost_basis;
    dish.unit_cost = v.unit_cost;
    dish.status = v.status;
    dish.status_label = DISH_STATUS_LABELS[v.status];
    dish.covered = v.covered;
    dish.in_cogs = v.covered && v.unit_cost !== null;
    dish.food_cost_pct =
      v.unit_cost !== null &&
      dish.avg_net_price !== null &&
      dish.avg_net_price > 0
        ? (v.unit_cost / dish.avg_net_price) * 100
        : null;
    dish.unit_margin =
      v.unit_cost !== null && dish.avg_net_price !== null
        ? dish.avg_net_price - v.unit_cost
        : null;
    dish.share_of_food_sales =
      grouped.totals.food_net_sales > 0
        ? dish.net_sales / grouped.totals.food_net_sales
        : 0;
  }
  // One row per product for every list and the editor; a split product
  // holds its parts' sums (the totals above already add the parts).
  const partsByProduct = new Map<number, DishEconomics[]>();
  const dishes: DishEconomics[] = [];
  for (const row of rows) {
    if (!row.row_key) {
      dishes.push(row);
      continue;
    }
    const list = partsByProduct.get(row.odoo_product_id);
    if (list) list.push(row);
    else {
      const created = [row];
      partsByProduct.set(row.odoo_product_id, created);
      dishes.push(row);
    }
  }
  for (let i = 0; i < dishes.length; i++) {
    const parts = partsByProduct.get(dishes[i].odoo_product_id);
    if (parts && dishes[i].row_key) dishes[i] = mergeParts(parts);
  }
  return {
    company_id: input.companyId,
    currency: input.currency,
    period: input.period ?? { from: null, to: null },
    uses_pos_products: input.list.products.length > 0 || input.links.length > 0,
    dishes,
    totals: grouped.totals,
    menu_dishes: grouped.dishes,
    excluded_menu_dishes: grouped.excluded,
    menu_totals: grouped.totals,
    menu_unsaved_variant_count: grouped.unsaved_variant_count,
  };
}

/** Dishes with this status (Platos filters, problem lists). */
export function dishesWithStatus(
  result: Pick<DishEconomicsResult, "dishes">,
  statuses: readonly DishStatus[]
): DishEconomics[] {
  const wanted = new Set(statuses);
  return result.dishes.filter((dish) => wanted.has(dish.status));
}

/** Dishes that use an ingredient, with that line's cost (Costos, Ingredientes). */
export function dishesUsingIngredient(
  result: Pick<DishEconomicsResult, "dishes">,
  ingredientId: string
): Array<{ dish: DishEconomics; line: DishLineEconomics }> {
  const out: Array<{ dish: DishEconomics; line: DishLineEconomics }> = [];
  for (const dish of result.dishes) {
    const line = dish.lines.find((l) => l.ingredient_id === ingredientId);
    if (line) out.push({ dish, line });
  }
  return out;
}
