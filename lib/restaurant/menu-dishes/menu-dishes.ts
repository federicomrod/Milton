// lib/restaurant/menu-dishes/menu-dishes.ts
//
// R1-10 "Plato del menú": group POS variants into menu dishes and roll the
// shared loader's numbers up to them. Pure. Board issue #210.
//
// - A menu dish is the parent of N POS variants (size, side, cooking
//   point, event) and has one recipe.
// - A variant with its own approved recipe keeps its own cost (Excel line
//   costs still win, #227). Otherwise it is costed with the dish's recipe:
//   cost = base cost + (portion / base portion − 1) × protein line cost.
//   Side and cooking point do not change the cost (pilot).
// - Sums, never averages: units, sales and cost add up per dish; margin
//   and food cost % come from those sums.
// - Grouping is idempotent: a person's move or exclusion (persisted on the
//   link) always wins; Milton only fills what is empty.

import type {
  DishEconomics,
  DishEconomicsTotals,
  DishLineEconomics,
  DishStatus,
} from "@/lib/restaurant/costing/dish-economics";
import {
  dishKey,
  exclusionFor,
  parseVariantName,
  sameDishKey,
} from "./variant-name";

export type MenuDishStatus = "suggested" | "confirmed" | "excluded";
export type Channel = "salón" | "eventos";

/** A menu dish as stored (045); absent until the migration is applied. */
export interface StoredMenuDish {
  id: string;
  name: string;
  restaurant_id: string | null;
  category: string | null;
  recipe_id: string | null;
  base_portion_qty: number | null;
  base_portion_unit: string | null;
  source: "excel" | "menu" | "name";
  status: MenuDishStatus;
}

/** A variant's stored grouping (045 columns on pos_product_links). */
export interface StoredVariant {
  odoo_product_id: number;
  menu_dish_id: string | null;
  portion_qty: number | null;
  side_label: string | null;
  cooking_point: string | null;
  is_event: boolean;
  excluded_reason: string | null;
}

export interface MenuDishVariant {
  odoo_product_id: number;
  name: string;
  size: number | null;
  size_unit: "oz" | "personas" | null;
  /** Sides as one label ("Pan con Ajo, Papas"), for grouping on screen. */
  side: string | null;
  sides: string[];
  cooking_point: string | null;
  channel: Channel;
  is_promo: boolean;
  units: number;
  net_sales: number;
  /** Cost of one unit (own recipe, or the dish's scaled). Null = unknown. */
  unit_cost: number | null;
  cost_total: number | null;
  margin: number | null;
  food_cost_pct: number | null;
  cost_basis: "own" | "dish" | null;
  status: DishStatus;
  covered: boolean;
}

export interface MenuDish {
  /** Stored id, or `auto:<key>` while Milton's suggestion is not saved. */
  id: string;
  stored: boolean;
  name: string;
  category: string | null;
  source: "excel" | "menu" | "name";
  status: MenuDishStatus;
  /** For an excluded dish: why (bebida, extra…). */
  excluded_reason: string | null;
  variants: MenuDishVariant[];
  units: number;
  net_sales: number;
  /** 0–1 of food net sales (excluded dishes: 0). */
  share_of_food_sales: number;
  /** Sales of the variants that have a cost (approved or estimated). */
  cost_known_sales: number;
  cost_total: number | null;
  food_cost_pct: number | null;
  margin: number | null;
  margin_pct: number | null;
  /** 0–1: sales of covered (approved-cost) variants / dish sales. */
  coverage: number;
  cost_status: DishStatus;
  /** The variant whose recipe is the dish's (opens the recipe editor). */
  base_odoo_product_id: number | null;
  base_portion_qty: number | null;
  excel_total: number | null;
  excel_diff_flag: boolean;
}

export interface MenuDishTotals extends DishEconomicsTotals {
  variant_count: number;
  excluded_variant_count: number;
  excluded_by_reason: Record<string, number>;
  menu_dish_count: number;
}

export interface MenuDishesResult {
  dishes: MenuDish[];
  excluded: MenuDish[];
  /** Per POS product: its menu dish and effective numbers. */
  byProduct: Map<number, { dish_id: string; variant: MenuDishVariant }>;
  totals: MenuDishTotals;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

const MASS = new Set(["oz", "lb", "g", "kg"]);

/** The line that scales with the portion: the costliest weighed line. */
export function proteinLineCost(
  lines: readonly DishLineEconomics[]
): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (line.amount === null || !MASS.has(line.unit)) continue;
    if (best === null || line.amount > best) best = line.amount;
  }
  return best;
}

/** Variant cost from the dish's recipe: only the protein scales. */
export function scaledCost(input: {
  baseCost: number;
  baseProtein: number | null;
  basePortion: number | null;
  portion: number | null;
}): number {
  const { baseCost, baseProtein, basePortion, portion } = input;
  if (!baseProtein || !basePortion || !portion || portion === basePortion) {
    return baseCost;
  }
  return baseCost + (portion / basePortion - 1) * baseProtein;
}

/**
 * A dish's numbers from its variants: sums only (units, sales, cost);
 * margin, food cost % and coverage come from those sums, never averaged.
 * The loader and the screen (after "Mover variante") both use this.
 */
export function dishSums(
  variants: readonly MenuDishVariant[]
): Pick<
  MenuDish,
  | "units"
  | "net_sales"
  | "share_of_food_sales"
  | "cost_known_sales"
  | "cost_total"
  | "food_cost_pct"
  | "margin"
  | "margin_pct"
  | "coverage"
  | "cost_status"
> {
  const units = variants.reduce((s, v) => s + v.units, 0);
  const net = variants.reduce((s, v) => s + v.net_sales, 0);
  const known = variants.filter((v) => v.cost_total !== null);
  const knownSales = known.reduce((s, v) => s + v.net_sales, 0);
  const costTotal = known.length
    ? known.reduce((s, v) => s + (v.cost_total ?? 0), 0)
    : null;
  const coveredSales = variants
    .filter((v) => v.covered)
    .reduce((s, v) => s + v.net_sales, 0);
  return {
    units: round2(units),
    net_sales: round2(net),
    share_of_food_sales: 0,
    cost_known_sales: round2(knownSales),
    cost_total: costTotal,
    food_cost_pct:
      costTotal !== null && knownSales > 0
        ? (costTotal / knownSales) * 100
        : null,
    margin: costTotal !== null ? knownSales - costTotal : null,
    margin_pct:
      costTotal !== null && knownSales > 0
        ? ((knownSales - costTotal) / knownSales) * 100
        : null,
    coverage: net > 0 ? coveredSales / net : 0,
    cost_status:
      net > 0 && coveredSales >= net - 0.005
        ? "aprobado"
        : worst(variants.map((v) => v.status)),
  };
}

/** Move one variant between dishes on screen (sums recomputed). */
export function moveVariantLocally(
  dishes: readonly MenuDish[],
  odooProductId: number,
  targetId: string,
  newDishName?: string
): MenuDish[] {
  let moving: MenuDishVariant | null = null;
  const without = dishes.map((d) => {
    const v = d.variants.find((x) => x.odoo_product_id === odooProductId);
    if (!v) return d;
    moving = v;
    const variants = d.variants.filter((x) => x !== v);
    return { ...d, variants, ...dishSums(variants) };
  });
  if (!moving) return [...dishes];
  const moved: MenuDishVariant = moving;
  let target = without.find((d) => d.id === targetId);
  const rest = without.filter(
    (d) => d.variants.length > 0 && d.id !== targetId
  );
  if (!target) {
    target = {
      ...(without[0] as MenuDish),
      id: targetId,
      stored: false,
      name: newDishName ?? "Plato nuevo",
      status: "confirmed",
      variants: [],
      excluded_reason: null,
      base_odoo_product_id: moved.odoo_product_id,
    };
  }
  const variants = [...target.variants, moved];
  const next = [...rest, { ...target, variants, ...dishSums(variants) }];
  const food = next.reduce((s, d) => s + d.net_sales, 0);
  for (const d of next)
    d.share_of_food_sales = food > 0 ? d.net_sales / food : 0;
  return next.sort((a, b) => b.net_sales - a.net_sales);
}

function worst(statuses: DishStatus[]): DishStatus {
  if (statuses.includes("falta_precio")) return "falta_precio";
  if (statuses.includes("estimado")) return "estimado";
  if (statuses.includes("sin_receta")) return "sin_receta";
  return "aprobado";
}

interface Group {
  id: string;
  stored: StoredMenuDish | null;
  key: string;
  members: Array<{
    dish: DishEconomics;
    parsed: ReturnType<typeof parseVariantName>;
    stored: StoredVariant | null;
  }>;
  excluded_reason: string | null;
}

export function buildMenuDishes(input: {
  products: readonly DishEconomics[];
  storedDishes?: readonly StoredMenuDish[];
  storedVariants?: ReadonlyMap<number, StoredVariant>;
  /** Food net sales before grouping (tips and person-excluded out). */
  excludedNetSalesBefore: number;
}): MenuDishesResult {
  const storedDishes = input.storedDishes ?? [];
  const storedById = new Map(storedDishes.map((d) => [d.id, d]));
  const groups = new Map<string, Group>();
  const excludedGroups = new Map<string, Group>();

  const groupFor = (key: string, label: string): Group => {
    // A stored dish of the same name takes the variant.
    const stored = storedDishes.find(
      (d) => d.status !== "excluded" && sameDishKey(dishKey(d.name), key)
    );
    if (stored) {
      const g = groups.get(stored.id) ?? {
        id: stored.id,
        stored,
        key: dishKey(stored.name),
        members: [],
        excluded_reason: null,
      };
      groups.set(stored.id, g);
      return g;
    }
    for (const g of groups.values()) {
      if (!g.stored && sameDishKey(g.key, key)) return g;
    }
    const g: Group = {
      id: `auto:${key}`,
      stored: null,
      key,
      members: [],
      excluded_reason: null,
    };
    groups.set(g.id, g);
    void label;
    return g;
  };

  for (const dish of input.products) {
    const parsed = parseVariantName(dish.name);
    const stored = input.storedVariants?.get(dish.odoo_product_id) ?? null;
    // 1) A person's choice wins: an exclusion or a move.
    const manualExclusion = stored?.excluded_reason ?? null;
    const storedDish = stored?.menu_dish_id
      ? storedById.get(stored.menu_dish_id)
      : undefined;
    const autoExclusion =
      !stored?.menu_dish_id && dish.treatment === "por_clasificar"
        ? exclusionFor({ name: dish.name, category: dish.category })
        : null;
    const exclusion =
      manualExclusion ??
      (storedDish?.status === "excluded" ? "excluido" : null) ??
      autoExclusion;
    const member = { dish, parsed, stored };
    if (exclusion) {
      const key = `excluded:${exclusion}:${parsed.key}`;
      const g = excludedGroups.get(key) ?? {
        id: storedDish?.id ?? `auto:${parsed.key}`,
        stored: storedDish ?? null,
        key: parsed.key,
        members: [],
        excluded_reason: exclusion,
      };
      g.members.push(member);
      excludedGroups.set(key, g);
      continue;
    }
    if (storedDish) {
      const g = groups.get(storedDish.id) ?? {
        id: storedDish.id,
        stored: storedDish,
        key: dishKey(storedDish.name),
        members: [],
        excluded_reason: null,
      };
      g.members.push(member);
      groups.set(storedDish.id, g);
      continue;
    }
    groupFor(parsed.key, parsed.base).members.push(member);
  }

  const byProduct = new Map<
    number,
    { dish_id: string; variant: MenuDishVariant }
  >();
  const build = (g: Group, excluded: boolean): MenuDish => {
    const members = g.members
      .slice()
      .sort((a, b) => b.dish.net_sales - a.dish.net_sales);
    // The dish's recipe: an approved variant first (top seller), else an
    // estimated one.
    const base =
      members.find(
        (m) =>
          m.dish.status === "aprobado" &&
          m.dish.unit_cost !== null &&
          m.dish.treatment !== "modificador_sin_costo"
      ) ??
      members.find(
        (m) => m.dish.status === "estimado" && m.dish.unit_cost !== null
      ) ??
      null;
    const basePortion =
      g.stored?.base_portion_qty ??
      base?.parsed.portion_qty ??
      base?.stored?.portion_qty ??
      null;
    const baseProtein = base ? proteinLineCost(base.dish.lines) : null;

    const variants: MenuDishVariant[] = members.map(
      ({ dish, parsed, stored }) => {
        const portion = stored?.portion_qty ?? parsed.portion_qty;
        const ownCounts =
          dish.unit_cost !== null &&
          (dish.status === "aprobado" || !base || base.dish === dish);
        let unitCost: number | null;
        let basis: MenuDishVariant["cost_basis"];
        let status: DishStatus;
        let covered: boolean;
        if (excluded) {
          unitCost = dish.unit_cost;
          basis = dish.unit_cost !== null ? "own" : null;
          status = dish.status;
          covered = false;
        } else if (ownCounts) {
          unitCost = dish.unit_cost;
          basis = "own";
          status = dish.status;
          covered = dish.covered;
        } else if (base && base.dish.unit_cost !== null) {
          unitCost = scaledCost({
            baseCost: base.dish.unit_cost,
            baseProtein,
            basePortion,
            portion,
          });
          basis = "dish";
          status = base.dish.status;
          covered = base.dish.status === "aprobado";
        } else {
          unitCost = null;
          basis = null;
          status = dish.status;
          covered = dish.covered;
        }
        const costTotal = unitCost !== null ? unitCost * dish.units_sold : null;
        const variant: MenuDishVariant = {
          odoo_product_id: dish.odoo_product_id,
          name: dish.name,
          size: portion,
          size_unit: parsed.portion_unit,
          side:
            stored?.side_label ??
            (parsed.sides.length ? parsed.sides.join(", ") : null),
          sides: parsed.sides,
          cooking_point: stored?.cooking_point ?? parsed.cooking_point,
          channel:
            (stored?.is_event ?? false) ||
            parsed.is_event ||
            /evento/i.test(dish.category ?? "")
              ? "eventos"
              : "salón",
          is_promo: parsed.is_promo,
          units: dish.units_sold,
          net_sales: dish.net_sales,
          unit_cost: unitCost,
          cost_total: costTotal,
          margin: costTotal !== null ? dish.net_sales - costTotal : null,
          food_cost_pct:
            costTotal !== null && dish.net_sales > 0
              ? (costTotal / dish.net_sales) * 100
              : null,
          cost_basis: basis,
          status,
          covered,
        };
        byProduct.set(dish.odoo_product_id, { dish_id: g.id, variant });
        return variant;
      }
    );

    const top = members[0];
    const name =
      g.stored?.name ??
      // The best-selling variant's dish name, as the restaurant writes it.
      top?.parsed.base ??
      g.key;
    const source: MenuDish["source"] =
      g.stored?.source ??
      (members.some((m) => m.dish.recipe_version_id) ? "excel" : "name");
    return {
      id: g.id,
      stored: Boolean(g.stored),
      name,
      category: g.stored?.category ?? top?.dish.category ?? null,
      source,
      status: excluded ? "excluded" : (g.stored?.status ?? "suggested"),
      excluded_reason: excluded ? g.excluded_reason : null,
      variants,
      ...dishSums(variants),
      base_odoo_product_id:
        base?.dish.odoo_product_id ?? top?.dish.odoo_product_id ?? null,
      base_portion_qty: basePortion,
      excel_total: base?.dish.excel_total ?? null,
      excel_diff_flag: base?.dish.excel_diff_flag ?? false,
    };
  };

  const dishes = [...groups.values()]
    .filter((g) => g.members.length > 0)
    .map((g) => build(g, false));
  const excluded = [...excludedGroups.values()].map((g) => build(g, true));

  // Totals: one denominator (food net sales after exclusions), sums only.
  const food = dishes.reduce((s, d) => s + d.net_sales, 0);
  for (const d of dishes)
    d.share_of_food_sales = food > 0 ? d.net_sales / food : 0;
  dishes.sort(
    (a, b) => b.net_sales - a.net_sales || a.name.localeCompare(b.name, "es")
  );
  excluded.sort((a, b) => b.net_sales - a.net_sales);

  const allVariants = dishes.flatMap((d) => d.variants);
  const covered = allVariants.filter((v) => v.covered);
  const coveredSales = covered.reduce((s, v) => s + v.net_sales, 0);
  const cogsVariants = covered.filter((v) => v.cost_total !== null);
  const costKnown = cogsVariants.reduce((s, v) => s + v.net_sales, 0);
  const cogs = cogsVariants.reduce((s, v) => s + (v.cost_total ?? 0), 0);
  const marginUnits = cogsVariants.reduce((s, v) => s + v.units, 0);
  const count = (st: DishStatus) =>
    dishes.filter((d) => d.cost_status === st).length;
  const excludedByReason: Record<string, number> = {};
  for (const d of excluded) {
    const reason = d.excluded_reason ?? "excluido";
    excludedByReason[reason] =
      (excludedByReason[reason] ?? 0) + d.variants.length;
  }
  const excludedSales = excluded.reduce((s, d) => s + d.net_sales, 0);

  const totals: MenuDishTotals = {
    food_net_sales: round2(food),
    excluded_net_sales: round2(input.excludedNetSalesBefore + excludedSales),
    covered_net_sales: round2(coveredSales),
    coverage_pct: food > 0 ? round1((coveredSales / food) * 100) : 0,
    cost_known_net_sales: round2(costKnown),
    estimated_cogs: round2(cogs),
    food_cost_pct: costKnown > 0 ? round1((cogs / costKnown) * 100) : null,
    gross_margin: costKnown > 0 ? round2(costKnown - cogs) : null,
    gross_margin_pct:
      costKnown > 0 ? round1(((costKnown - cogs) / costKnown) * 100) : null,
    avg_unit_margin:
      marginUnits > 0 ? round2((costKnown - cogs) / marginUnits) : null,
    dish_count: dishes.length,
    approved_count: count("aprobado"),
    estimated_count: count("estimado"),
    missing_price_count: count("falta_precio"),
    no_recipe_count: count("sin_receta"),
    problem_count: count("falta_precio") + count("sin_receta"),
    with_recipe_net_sales: round2(
      dishes
        .filter((d) => d.cost_status !== "sin_receta")
        .reduce((s, d) => s + d.net_sales, 0)
    ),
    variant_count: allVariants.length,
    excluded_variant_count: excluded.reduce((s, d) => s + d.variants.length, 0),
    excluded_by_reason: excludedByReason,
    menu_dish_count: dishes.length,
  };
  return { dishes, excluded, byProduct, totals };
}
