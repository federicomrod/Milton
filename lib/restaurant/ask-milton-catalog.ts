// lib/restaurant/ask-milton-catalog.ts
//
// R1-16c: what Ask Milton knows about prices and the menu, in compact,
// bounded blocks the model (and the deterministic answer) can quote:
//   - ingredient_prices: latest confirmed price per ingredient, ranked
//   - menu_dishes: dishes with sales / cost / margin (same load as Menú)
//   - item_groups: the groups people made, with their sales
// Hard rules: an ingredient with no price ("Sin precio") is NEVER ranked and
// never shown as $0; nothing is estimated; every list is capped.

import type { IngredientLatestCostRow } from "@/lib/restaurant/menu-recipes-server";
import type { DishEconomicsResult } from "@/lib/restaurant/costing/dish-economics";
import type { DishStatus } from "@/lib/restaurant/costing/dish-status";
import { DISH_STATUSES } from "@/lib/restaurant/costing/dish-status";
import {
  RANKING_INCLUDES_ESTIMATED,
  marginRankings,
} from "@/lib/restaurant/costing/menu-summary";

export const CATALOG_CAPS = {
  ingredients: 15,
  unpricedNames: 10,
  usedIn: 4,
  dishes: 25,
  /** Ranked platos per direction: owners may ask «top 10». */
  foodCost: 10,
  groups: 20,
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const cut = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function asDishStatus(status: string): DishStatus {
  return (DISH_STATUSES as readonly string[]).includes(status)
    ? (status as DishStatus)
    : "sin_receta";
}

export interface AskMiltonIngredientPrice {
  name: string;
  category: string | null;
  /** Latest confirmed price per unit. */
  price: number;
  unit: string;
  currency: string;
  price_date: string;
  /** factura | manual | lista | excel — where that price came from. */
  source: string | null;
  supplier_name: string | null;
  /** Active dishes that use it (directly or through a preparation); null = unknown. */
  dishes_using: number | null;
  /** A few of those dishes, in this restaurant's scope when one is selected. */
  used_in: string[];
}

export interface AskMiltonIngredientPrices {
  scope: "restaurant" | "company";
  /** Prices are shared by the whole company; usage follows `scope`. */
  note: string;
  priced_count: number;
  /** Ingredients with no confirmed price: not ranked, never $0. */
  unpriced_count: number;
  unpriced_in_use: string[];
  /** Highest latest price per unit first. Units differ: compare within a unit. */
  top_by_unit_cost: AskMiltonIngredientPrice[];
}

export interface IngredientPriceInput {
  rows: readonly IngredientLatestCostRow[];
  dishCount: ReadonlyMap<string, number> | null;
  /** ingredient id → dish names in scope (selected restaurant's dishes). */
  dishNames: ReadonlyMap<string, readonly string[]> | null;
  inUse: ReadonlySet<string> | null;
  scope: "restaurant" | "company";
  topN?: number;
}

export function buildIngredientPrices(
  input: IngredientPriceInput
): AskMiltonIngredientPrices {
  const priced: AskMiltonIngredientPrice[] = [];
  const unpriced: Array<{ name: string; inUse: boolean }> = [];
  for (const row of input.rows) {
    const l = row.latest;
    const cost = l ? Number(l.normalized_unit_cost) : NaN;
    if (!l || !Number.isFinite(cost) || cost <= 0) {
      unpriced.push({
        name: row.name,
        inUse: input.inUse?.has(row.id) ?? false,
      });
      continue;
    }
    const names = input.dishNames?.get(row.id) ?? [];
    priced.push({
      name: cut(row.name),
      category: row.category,
      price: r2(cost),
      unit: l.normalized_unit ?? row.default_unit ?? "",
      currency: l.currency,
      price_date: l.cost_date,
      source: l.source ?? null,
      supplier_name: l.supplier_name,
      dishes_using: input.dishCount?.get(row.id) ?? null,
      used_in: names.slice(0, CATALOG_CAPS.usedIn).map((n) => cut(n)),
    });
  }
  priced.sort(
    (a, b) => b.price - a.price || a.name.localeCompare(b.name, "es")
  );
  return {
    scope: input.scope,
    note:
      "Precios más recientes confirmados, compartidos por toda la empresa. " +
      "Las unidades pueden diferir (lb, oz, g, unidad): compara dentro de la misma unidad. " +
      "Los ingredientes sin precio no entran al ranking.",
    priced_count: priced.length,
    unpriced_count: unpriced.length,
    unpriced_in_use: unpriced
      .filter((u) => u.inUse)
      .slice(0, CATALOG_CAPS.unpricedNames)
      .map((u) => cut(u.name)),
    top_by_unit_cost: priced.slice(0, input.topN ?? CATALOG_CAPS.ingredients),
  };
}

export interface AskMiltonMenuDish {
  name: string;
  category: string | null;
  net_sales: number;
  units: number;
  /** Null = no approved cost yet (Sin precio), never 0. */
  food_cost_pct: number | null;
  margin_pct: number | null;
  cost_status: string;
}

export interface AskMiltonMenuDishes {
  currency: string;
  period: { from: string | null; to: string | null };
  dish_count: number;
  /** Dishes with no recipe or price — excluded from rankings, never 0%. */
  uncosted_count: number;
  top_by_sales: AskMiltonMenuDish[];
  /** Highest food cost % (cost / sale price), same costing as Menú › Resumen. */
  top_by_food_cost: AskMiltonMenuDish[];
  /** Highest margin first — same «aprobado»-only ranking as Resumen. */
  top_by_margin?: AskMiltonMenuDish[];
  /** Net sales by menu category (Churrascos, Bebidas…). */
  sales_by_category: Array<{
    category: string;
    net_sales: number;
    units: number;
    dishes: number;
  }>;
}

export function buildMenuDishes(
  econ: Pick<DishEconomicsResult, "currency" | "period" | "menu_dishes">
): AskMiltonMenuDishes {
  const dishes = econ.menu_dishes;
  const byCategory = new Map<
    string,
    { net_sales: number; units: number; dishes: number }
  >();
  for (const d of dishes) {
    const key = d.category?.trim() || "Sin categoría";
    const c = byCategory.get(key) ?? { net_sales: 0, units: 0, dishes: 0 };
    c.net_sales += d.net_sales;
    c.units += d.units;
    c.dishes += 1;
    byCategory.set(key, c);
  }
  const toRow = (d: (typeof dishes)[number]): AskMiltonMenuDish => ({
    name: cut(d.name),
    category: d.category,
    net_sales: r2(d.net_sales),
    units: Math.round(d.units),
    food_cost_pct:
      d.food_cost_pct !== null && Number.isFinite(d.food_cost_pct)
        ? r2(d.food_cost_pct)
        : null,
    margin_pct:
      d.margin_pct !== null && Number.isFinite(d.margin_pct)
        ? r2(d.margin_pct)
        : null,
    cost_status: String(d.cost_status),
  });
  // Same eligibility as Menú › Resumen: only «aprobado». AI estimates
  // and falta_precio never enter the ranking (RANKING_INCLUDES_ESTIMATED).
  const ranking = marginRankings(
    dishes.map((d, i) => ({
      id: String(i),
      name: d.name,
      net_sales: d.net_sales,
      margin_pct: d.margin_pct,
      cost_status: asDishStatus(d.cost_status),
    })),
    {
      min: 1,
      top: CATALOG_CAPS.foodCost,
      includeEstimated: RANKING_INCLUDES_ESTIMATED,
    }
  );
  return {
    currency: econ.currency,
    period: econ.period,
    dish_count: dishes.length,
    uncosted_count: dishes.length - ranking.costed,
    top_by_sales: [...dishes]
      .sort((a, b) => b.net_sales - a.net_sales)
      .slice(0, CATALOG_CAPS.dishes)
      .map(toRow),
    top_by_food_cost: ranking.worst
      .map((w) => dishes[Number(w.id)])
      .filter((d) => d != null)
      .map(toRow),
    top_by_margin: ranking.best
      .map((w) => dishes[Number(w.id)])
      .filter((d) => d != null)
      .map(toRow),
    sales_by_category: [...byCategory.entries()]
      .map(([category, v]) => ({
        category: cut(category),
        net_sales: r2(v.net_sales),
        units: Math.round(v.units),
        dishes: v.dishes,
      }))
      .sort((a, b) => b.net_sales - a.net_sales)
      .slice(0, CATALOG_CAPS.groups),
  };
}

export interface AskMiltonItemGroup {
  name: string;
  products: number;
  net_sales: number;
  units: number;
}

/** The groups people made, with the sales of their products (nested groups included). */
export function buildItemGroups(
  econ: Pick<DishEconomicsResult, "dishes" | "menu_dishes" | "item_groups">
): AskMiltonItemGroup[] {
  const load = econ.item_groups;
  if (!load?.available) return [];
  const sales = new Map<number, { net: number; units: number }>();
  for (const d of econ.menu_dishes)
    for (const v of d.variants) {
      const s = sales.get(v.odoo_product_id) ?? { net: 0, units: 0 };
      s.net += v.net_sales;
      s.units += v.units;
      sales.set(v.odoo_product_id, s);
    }
  const membersOf = new Map<string, typeof load.members>();
  for (const m of load.members) {
    const list = membersOf.get(m.group_id) ?? [];
    list.push(m);
    membersOf.set(m.group_id, list);
  }
  const productsOf = (groupId: string, seen: Set<string>): Set<number> => {
    const out = new Set<number>();
    if (seen.has(groupId)) return out;
    seen.add(groupId);
    for (const m of membersOf.get(groupId) ?? []) {
      if (m.member_type === "pos_product") {
        const id = Number(m.member_ref);
        if (Number.isInteger(id)) out.add(id);
      } else if (m.member_type === "group") {
        for (const id of productsOf(m.member_ref, seen)) out.add(id);
      }
    }
    return out;
  };
  const out: AskMiltonItemGroup[] = [];
  for (const g of load.groups) {
    if (g.scope !== "product" || g.status === "suggested") continue;
    const ids = productsOf(g.id, new Set());
    let net = 0;
    let units = 0;
    for (const id of ids) {
      const s = sales.get(id);
      if (!s) continue;
      net += s.net;
      units += s.units;
    }
    if (ids.size === 0) continue;
    out.push({
      name: cut(g.name),
      products: ids.size,
      net_sales: r2(net),
      units: Math.round(units),
    });
  }
  return out
    .sort((a, b) => b.net_sales - a.net_sales)
    .slice(0, CATALOG_CAPS.groups);
}

/** Dish names per ingredient from the (restaurant-scoped) dish economics lines. */
export function dishNamesByIngredient(
  econ: Pick<DishEconomicsResult, "dishes"> | null
): Map<string, string[]> | null {
  if (!econ) return null;
  const map = new Map<string, Set<string>>();
  for (const dish of econ.dishes)
    for (const line of dish.lines ?? []) {
      if (!line.ingredient_id) continue;
      const set = map.get(line.ingredient_id) ?? new Set<string>();
      set.add(dish.name);
      map.set(line.ingredient_id, set);
    }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

export const EMPTY_INGREDIENT_PRICES: AskMiltonIngredientPrices = {
  scope: "company",
  note: "",
  priced_count: 0,
  unpriced_count: 0,
  unpriced_in_use: [],
  top_by_unit_cost: [],
};
