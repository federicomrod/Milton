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
} from "@/lib/restaurant/pos-product-list";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";

import { DISH_STATUS_LABELS, type DishStatus } from "./dish-status";

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
  dishes: DishEconomics[];
  totals: DishEconomicsTotals;
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
  const link = linkFor(
    input.links,
    product.odoo_product_id,
    input.locationId ?? null
  );
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
  const dishes = input.list.products
    .filter((product) => product.in_food_sales)
    .map((product) =>
      dishFromProduct(product, input, versionsByMenuItem, names)
    );
  return {
    company_id: input.companyId,
    currency: input.currency,
    period: input.period ?? { from: null, to: null },
    uses_pos_products: input.list.products.length > 0 || input.links.length > 0,
    dishes,
    totals: totalsOf(dishes, input.list),
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
