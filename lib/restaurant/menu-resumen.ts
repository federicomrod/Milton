// lib/restaurant/menu-resumen.ts
//
// R1-18: the arithmetic of Menú › Resumen as the menu's cockpit. Like Cockpit
// v2, it loads ONE dataset (sales per day and product + each dish's variants
// with their cost) and everything after — range, KPIs, Top platos, margin
// rankings, Pendientes — is computed in the browser. Pure.
//
// The numbers are the loader's by construction: a dish is rolled up with the
// same `rollupLeaves` as Platos and Resumen did on the server, and the KPIs
// count only COVERED (approved) variants, exactly like `totalsOf`:
//   Costo de comida   = Σ cost of covered variants ÷ their sales
//   Margen bruto      = their sales − their cost
//   Ventas con costo  = sales of covered variants ÷ food sales
//   Platos con problema = dishes whose status is Falta precio or Sin receta
// A missing price is «Sin precio»: never $0, never 0%.

import { addDays } from "@/lib/restaurant/cockpit-math";
import { rollupLeaves, type RollupLeaf } from "@/lib/restaurant/costing/rollup";
import type { DishStatus } from "@/lib/restaurant/costing/dish-status";
import {
  LOW_MARGIN_PCT,
  marginRankings,
  type MarginRanking,
} from "@/lib/restaurant/costing/menu-summary";

export interface ResumenVariant {
  key: string;
  product_id: number;
  /** Restaurants this variant's sales belong to (a restaurant-costed part); null = every one. */
  locations: string[] | null;
  /** Cost of ONE unit; null = Sin precio. */
  unit_cost: number | null;
  covered: boolean;
  status: DishStatus;
}

export interface ResumenDish {
  id: string;
  name: string;
  variants: ResumenVariant[];
}

/** Net sales and units of one product in one restaurant on one business day. */
export interface ResumenDayRow {
  d: string;
  l: string | null;
  p: number;
  n: number;
  u: number;
}

export interface ResumenData {
  currency: string;
  dishes: ResumenDish[];
  days: ResumenDayRow[];
  first_day: string | null;
  last_day: string | null;
}

export type ResumenPeriod = "7d" | "month" | "90d";

export interface ResumenRange {
  from: string;
  to: string;
}

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** "Julio 2026" (the month of the last day with sales). */
export function monthLabel(lastDay: string): string {
  return `${MONTHS[+lastDay.slice(5, 7) - 1]} ${lastDay.slice(0, 4)}`;
}

export function resumenRange(
  period: ResumenPeriod,
  lastDay: string
): ResumenRange {
  if (period === "7d") return { from: addDays(lastDay, -6), to: lastDay };
  if (period === "90d") return { from: addDays(lastDay, -89), to: lastDay };
  return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
}

export interface DishRow {
  id: string;
  name: string;
  /** The product that opens this dish in Platos (its best-selling variant). */
  product_id: number | null;
  net_sales: number;
  /** Share of all food sales of the range, 0–1. */
  share: number;
  units: number;
  margin_pct: number | null;
  coverage: number;
  cost_status: DishStatus;
}

export interface ResumenKpis {
  food_cost_pct: number | null;
  gross_margin: number | null;
  coverage_pct: number;
  covered_dishes: number;
  dish_count: number;
  problem_count: number;
  low_margin_count: number;
  /** Every dish has an approved cost: the 4th card becomes «bajo objetivo». */
  all_costed: boolean;
}

export interface ResumenView {
  range: ResumenRange;
  empty: boolean;
  food_sales: number;
  kpis: ResumenKpis;
  /** Every dish with sales, best sellers first. */
  dishes: DishRow[];
  top: DishRow[];
  top_share: number;
  ranking: MarginRanking;
  counts: {
    falta_precio: { dishes: number; share: number };
    sin_receta: { dishes: number; share: number };
    estimado: { dishes: number; share: number };
  };
}

export function computeResumen(
  data: ResumenData,
  range: ResumenRange,
  opts: { includeEstimatedInRanking?: boolean } = {}
): ResumenView {
  // product → variants (a product can have one variant per restaurant part)
  const byProduct = new Map<
    number,
    Array<{ dish: number; v: ResumenVariant }>
  >();
  data.dishes.forEach((dish, i) => {
    for (const v of dish.variants) {
      const list = byProduct.get(v.product_id) ?? [];
      list.push({ dish: i, v });
      byProduct.set(v.product_id, list);
    }
  });
  const sums = new Map<
    string,
    { dish: number; v: ResumenVariant; net: number; units: number }
  >();
  for (const row of data.days) {
    if (row.d < range.from || row.d > range.to) continue;
    const list = byProduct.get(row.p);
    if (!list) continue; // not a food dish (tips, excluded products…)
    const pick =
      list.length === 1
        ? list[0]
        : (list.find((x) => x.v.locations?.includes(row.l ?? "")) ??
          list.find((x) => x.v.locations === null) ??
          list[0]);
    const s = sums.get(pick.v.key) ?? {
      dish: pick.dish,
      v: pick.v,
      net: 0,
      units: 0,
    };
    s.net += row.n;
    s.units += row.u;
    sums.set(pick.v.key, s);
  }

  const productOfKey = new Map<string, number>();
  for (const dish of data.dishes)
    for (const v of dish.variants) productOfKey.set(v.key, v.product_id);
  const leavesByDish = new Map<number, RollupLeaf[]>();
  let coveredNet = 0;
  let coveredCost = 0;
  let foodSales = 0;
  for (const s of sums.values()) {
    if (s.net === 0 && s.units === 0) continue;
    const leaf: RollupLeaf = {
      key: s.v.key,
      units: s.units,
      net_sales: s.net,
      cost_total: s.v.unit_cost !== null ? s.v.unit_cost * s.units : null,
      covered: s.v.covered,
      status: s.v.status,
    };
    const list = leavesByDish.get(s.dish) ?? [];
    list.push(leaf);
    leavesByDish.set(s.dish, list);
    foodSales += s.net;
    if (leaf.covered && leaf.cost_total !== null) {
      coveredNet += s.net;
      coveredCost += leaf.cost_total;
    }
  }

  const rows: DishRow[] = [];
  for (const [i, leaves] of leavesByDish) {
    const r = rollupLeaves(leaves);
    if (r.net_sales <= 0) continue;
    const lead = [...leaves].sort((a, b) => b.net_sales - a.net_sales)[0];
    rows.push({
      id: data.dishes[i].id,
      name: data.dishes[i].name,
      product_id: productOfKey.get(lead.key) ?? null,
      net_sales: r.net_sales,
      share: foodSales > 0 ? r.net_sales / foodSales : 0,
      units: r.units,
      margin_pct: r.margin_pct,
      coverage: r.coverage,
      cost_status: r.cost_status,
    });
  }
  rows.sort(
    (a, b) => b.net_sales - a.net_sales || a.name.localeCompare(b.name, "es")
  );

  const of = (status: DishStatus) => {
    const list = rows.filter((d) => d.cost_status === status);
    return {
      dishes: list.length,
      share: list.reduce((a, d) => a + d.share, 0),
    };
  };
  const approved = rows.filter((d) => d.cost_status === "aprobado").length;
  const problem = rows.filter(
    (d) => d.cost_status === "falta_precio" || d.cost_status === "sin_receta"
  ).length;
  const low = rows.filter(
    (d) =>
      d.cost_status === "aprobado" &&
      d.margin_pct !== null &&
      d.margin_pct < LOW_MARGIN_PCT
  ).length;
  const top = rows.slice(0, 5);
  return {
    range,
    empty: rows.length === 0,
    food_sales: Math.round(foodSales * 100) / 100,
    kpis: {
      food_cost_pct:
        coveredNet > 0
          ? Math.round((coveredCost / coveredNet) * 1000) / 10
          : null,
      gross_margin:
        coveredNet > 0
          ? Math.round((coveredNet - coveredCost) * 100) / 100
          : null,
      coverage_pct:
        foodSales > 0
          ? Math.round((coveredSalesOf(sums) / foodSales) * 1000) / 10
          : 0,
      covered_dishes: approved,
      dish_count: rows.length,
      problem_count: problem,
      low_margin_count: low,
      all_costed: rows.length > 0 && approved === rows.length,
    },
    dishes: rows,
    top,
    top_share: top.reduce((a, d) => a + d.share, 0),
    ranking: marginRankings(rows, {
      includeEstimated: opts.includeEstimatedInRanking,
    }),
    counts: {
      falta_precio: of("falta_precio"),
      sin_receta: of("sin_receta"),
      estimado: of("estimado"),
    },
  };
}

function coveredSalesOf(
  sums: Map<string, { v: ResumenVariant; net: number }>
): number {
  let n = 0;
  for (const s of sums.values()) if (s.v.covered) n += s.net;
  return n;
}
