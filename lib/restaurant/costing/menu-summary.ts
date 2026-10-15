// lib/restaurant/costing/menu-summary.ts
//
// Menú › Resumen (R1-09b), from the shared dish-economics load only:
// 4 KPIs, the dish table with its Estado, and the "Configura tu menú"
// checklist. Pure. Every count here is the loader's, so Resumen, Platos
// and the Cockpit can never disagree.

import type { DishEconomicsResult, DishStatus } from "./dish-economics";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { ingredientesHref, platosHref } from "@/lib/restaurant/menu-links";

/** Food cost above this share of the price = "margen bajo" (< 60 %). */
export const LOW_MARGIN_PCT = 60;
/** Dishes per batch in the checklist's "Platos" step. */
export const PLATOS_BATCH = 12;
/** Top sellers whose preparations are reviewed first (share of sales). */
const TOP_SELLERS_SHARE = 0.8;

export type MenuClass = "estrella" | "caballo" | "rompecabezas" | "perro";

export const MENU_CLASS_LABELS: Record<MenuClass, string> = {
  estrella: "Estrella",
  caballo: "Caballo",
  rompecabezas: "Rompecabezas",
  perro: "Perro",
};

export interface MenuSummaryRow {
  odoo_product_id: number;
  name: string;
  share_of_food_sales: number;
  unit_cost: number | null;
  food_cost_pct: number | null;
  status: DishStatus;
  /** Approved dishes: menu-engineering class; others: their status. */
  label: string;
  tone: "ok" | "pur" | "warn" | "grey";
  excel_total: number | null;
  excel_diff_flag: boolean;
}

export interface SetupStep {
  id: "excel" | "ingredientes" | "preparaciones" | "platos";
  label: string;
  done: boolean;
  href: string | null;
  /** What the primary button says when this is the next step. */
  action: string;
}

export interface MenuSummary {
  kpis: {
    food_cost_pct: number | null;
    avg_unit_margin: number | null;
    coverage_pct: number;
    covered_dishes: number;
    dish_count: number;
    low_margin_count: number;
  };
  rows: MenuSummaryRow[];
  setup: {
    steps: SetupStep[];
    done: number;
    total: number;
    next: SetupStep | null;
    complete: boolean;
  };
  /** The loader's problem count (Falta precio + Sin receta). */
  problem_count: number;
  /** Ingredients used by sold dishes with no price ("Resolver N precios"). */
  missing_price_ingredients: number;
  /** R1-10: per menu dish (same helpers as Platos). */
  dish_kpis: MenuDishKpis | null;
  mix: SalesMixRow[];
  to_resolve: ToResolveRow[];
}

/**
 * Kasavana–Smith: popular when the dish sells at least 70 % of an equal
 * share; profitable when its unit margin is at least the average.
 */
export function menuClassOf(input: {
  share: number;
  unitMargin: number;
  dishCount: number;
  avgMargin: number;
}): MenuClass {
  const popular = input.share >= 0.7 / Math.max(1, input.dishCount);
  const profitable = input.unitMargin >= input.avgMargin;
  if (popular && profitable) return "estrella";
  if (popular) return "caballo";
  if (profitable) return "rompecabezas";
  return "perro";
}

const STATUS_TONE: Record<DishStatus, MenuSummaryRow["tone"]> = {
  aprobado: "ok",
  estimado: "pur",
  falta_precio: "warn",
  sin_receta: "grey",
};

export function buildMenuSummary(
  economics: Pick<DishEconomicsResult, "dishes" | "totals"> &
    Partial<Pick<DishEconomicsResult, "menu_dishes">>,
  opts: { excelUploaded: boolean }
): MenuSummary {
  const { dishes, totals } = economics;
  const costed = dishes.filter(
    (d) => d.in_cogs && d.unit_margin !== null && d.unit_cost !== null
  );
  const avgMargin = totals.avg_unit_margin ?? 0;

  const rows: MenuSummaryRow[] = dishes.map((dish) => {
    const cls =
      dish.in_cogs && dish.unit_margin !== null
        ? menuClassOf({
            share: dish.share_of_food_sales,
            unitMargin: dish.unit_margin,
            dishCount: costed.length,
            avgMargin,
          })
        : null;
    return {
      odoo_product_id: dish.odoo_product_id,
      name: dish.name,
      share_of_food_sales: dish.share_of_food_sales,
      unit_cost: dish.unit_cost,
      food_cost_pct: dish.food_cost_pct,
      status: dish.status,
      label: cls ? MENU_CLASS_LABELS[cls] : dish.status_label,
      tone: STATUS_TONE[dish.status],
      excel_total: dish.excel_total,
      excel_diff_flag: dish.excel_diff_flag,
    };
  });

  const lowMargin = costed.filter(
    (d) => d.food_cost_pct !== null && 100 - d.food_cost_pct < LOW_MARGIN_PCT
  ).length;

  // Ingredients used by sold dishes that still have no price.
  const missingIngredients = new Set<string>();
  for (const dish of dishes) {
    for (const line of dish.lines) {
      if (
        line.kind === "ingredient" &&
        line.ingredient_id &&
        line.amount === null &&
        !line.own_cost
      ) {
        missingIngredients.add(line.ingredient_id);
      }
    }
  }

  // Preparations the top sellers need that cannot be costed yet.
  const waitingPreps = new Set<string>();
  let running = 0;
  for (const dish of dishes) {
    if (running >= TOP_SELLERS_SHARE) break;
    running += dish.share_of_food_sales;
    for (const line of dish.lines) {
      if (
        line.kind === "component" &&
        line.component_id &&
        line.amount === null
      ) {
        waitingPreps.add(line.component_id);
      }
    }
  }

  // Counted per menu dish when the variants are grouped (R1-10).
  const reviewStatuses: DishStatus[] = economics.menu_dishes
    ? economics.menu_dishes.map((d) => d.cost_status)
    : dishes.map((d) => d.status);
  const dishTotal = reviewStatuses.length;
  const toReview = reviewStatuses.filter((st) => st !== "aprobado");
  const estimated = toReview.filter((st) => st === "estimado").length;
  const batch = Math.min(PLATOS_BATCH, toReview.length);

  const steps: SetupStep[] = [
    {
      id: "excel",
      label: "Subir Excel de costos",
      done: opts.excelUploaded,
      href: null,
      action: "Continuar: subir tu Excel",
    },
    {
      id: "ingredientes",
      label:
        missingIngredients.size > 0
          ? `Completar ${missingIngredients.size} ${missingIngredients.size === 1 ? "precio" : "precios"}`
          : "Precios de ingredientes",
      done: opts.excelUploaded && missingIngredients.size === 0,
      href: ingredientesHref("falta_precio"),
      action: `Continuar: completar ${missingIngredients.size} ${missingIngredients.size === 1 ? "precio" : "precios"}`,
    },
    {
      id: "preparaciones",
      label:
        waitingPreps.size > 0
          ? `Revisar ${waitingPreps.size} ${waitingPreps.size === 1 ? "preparación" : "preparaciones"} de los más vendidos`
          : "Preparaciones de los más vendidos",
      done: opts.excelUploaded && waitingPreps.size === 0,
      href: "/dashboard/restaurant/menu/preparaciones",
      action: `Continuar: revisar ${waitingPreps.size} ${waitingPreps.size === 1 ? "preparación" : "preparaciones"}`,
    },
    {
      id: "platos",
      label:
        toReview.length > 0
          ? `Confirmar platos (${dishTotal - toReview.length} de ${dishTotal})`
          : "Confirmar platos",
      done: dishTotal > 0 && toReview.length === 0,
      href: platosHref(
        estimated > 0 ? ["estimado"] : ["falta_precio", "sin_receta"]
      ),
      action: `Continuar: revisar ${batch} ${batch === 1 ? "plato" : "platos"}`,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    kpis: {
      food_cost_pct: totals.food_cost_pct,
      avg_unit_margin: totals.avg_unit_margin,
      coverage_pct: totals.coverage_pct,
      covered_dishes: dishes.filter((d) => d.covered).length,
      dish_count: totals.dish_count,
      low_margin_count: lowMargin,
    },
    rows,
    setup: {
      steps,
      done,
      total: steps.length,
      next: steps.find((s) => !s.done) ?? null,
      complete: done === steps.length,
    },
    problem_count: totals.problem_count,
    missing_price_ingredients: missingIngredients.size,
    dish_kpis: economics.menu_dishes
      ? menuDishKpis({ totals, menu_dishes: economics.menu_dishes })
      : null,
    mix: economics.menu_dishes ? salesMix(economics.menu_dishes) : [],
    to_resolve: economics.menu_dishes ? toResolve(economics.menu_dishes) : [],
  };
}

/**
 * The Cockpit's "Configura tu menú · n/4" chip (D3): the same checklist as
 * Menú › Resumen. Without the upload history here, a file counts as
 * uploaded once any dish has a recipe version from it.
 */
export function menuSetupProgress(
  economics: Pick<DishEconomicsResult, "dishes" | "totals">
): { done: number; total: number; complete: boolean; nextHref: string } {
  const summary = buildMenuSummary(economics, {
    excelUploaded: economics.dishes.some((d) => d.recipe_version_id !== null),
  });
  return {
    done: summary.setup.done,
    total: summary.setup.total,
    complete: summary.setup.complete,
    nextHref: "/dashboard/restaurant/menu",
  };
}

// ---------------------------------------------------------------------------
// R1-10: per menu dish. Resumen and Platos read these same three helpers,
// so their numbers are identical by construction.
// ---------------------------------------------------------------------------

export interface MenuDishKpis {
  food_cost_pct: number | null;
  gross_margin: number | null;
  coverage_pct: number;
  /** Dishes whose every variant has an approved cost. */
  covered_dishes: number;
  dish_count: number;
  problem_count: number;
  missing_price_dishes: number;
  no_recipe_dishes: number;
}

export function menuDishKpis(
  result: Pick<DishEconomicsResult, "totals" | "menu_dishes">
): MenuDishKpis {
  const dishes = result.menu_dishes;
  return {
    food_cost_pct: result.totals.food_cost_pct,
    gross_margin: result.totals.gross_margin,
    coverage_pct: result.totals.coverage_pct,
    covered_dishes: dishes.filter((d) => d.cost_status === "aprobado").length,
    dish_count: dishes.length,
    problem_count: result.totals.problem_count,
    missing_price_dishes: dishes.filter((d) => d.cost_status === "falta_precio")
      .length,
    no_recipe_dishes: dishes.filter((d) => d.cost_status === "sin_receta")
      .length,
  };
}

export interface SalesMixRow {
  name: string;
  share: number;
  /** "Otros N platos". */
  rest?: number;
  menu_dish_id: string | null;
}

/** Top dishes by share of food sales, then "Otros N platos" (adds to 100%). */
export function salesMix(dishes: readonly MenuDish[], top = 6): SalesMixRow[] {
  const head = dishes.slice(0, top).map((d) => ({
    name: d.name,
    share: d.share_of_food_sales,
    menu_dish_id: d.id,
  }));
  const tail = dishes.slice(top);
  if (tail.length === 0) return head;
  return [
    ...head,
    {
      name: `Otros ${tail.length} platos`,
      share: tail.reduce((s, d) => s + d.share_of_food_sales, 0),
      rest: tail.length,
      menu_dish_id: null,
    },
  ];
}

export interface ToResolveRow {
  kind: "falta_precio" | "sin_receta" | "estimado" | "margen_bajo";
  count: number;
  /** Share of food sales of those dishes (0–1); null for margen bajo. */
  share: number | null;
  href: string;
}

/** "Por resolver": problems counted per dish, weighted by % of sales. */
export function toResolve(dishes: readonly MenuDish[]): ToResolveRow[] {
  const of = (status: DishStatus) =>
    dishes.filter((d) => d.cost_status === status);
  const share = (list: readonly MenuDish[]) =>
    list.reduce((s, d) => s + d.share_of_food_sales, 0);
  const missing = of("falta_precio");
  const noRecipe = of("sin_receta");
  const estimated = of("estimado");
  const lowMargin = dishes.filter(
    (d) => d.margin_pct !== null && d.margin_pct < LOW_MARGIN_PCT
  );
  return [
    {
      kind: "falta_precio" as const,
      count: missing.length,
      share: share(missing),
      href: platosHref(["falta_precio"]),
    },
    {
      kind: "sin_receta" as const,
      count: noRecipe.length,
      share: share(noRecipe),
      href: platosHref(["sin_receta"]),
    },
    {
      kind: "estimado" as const,
      count: estimated.length,
      share: share(estimated),
      href: platosHref(["estimado"]),
    },
    {
      kind: "margen_bajo" as const,
      count: lowMargin.length,
      share: null,
      href: platosHref(["aprobado"]),
    },
  ].filter((row) => row.count > 0);
}

// ---------------------------------------------------------------------------
// R1-18: Menú › Resumen as the menu's cockpit — best / worst margin
// ---------------------------------------------------------------------------

/** Fewer costed dishes than this and there is no ranking, only an empty state. */
export const MIN_RANKED_DISHES = 3;
/**
 * Do dishes whose cost is an AI estimate («estimado») enter the margin
 * rankings? They are always marked «IA» wherever they appear. Off: a ranking
 * is built on approved costs only (the same dishes the KPIs call "con costo").
 * One constant, so the answer to Sofia's open question is a one-line change.
 */
export const RANKING_INCLUDES_ESTIMATED = false;

export interface MarginDish {
  id: string | null;
  name: string;
  net_sales: number;
  /** Null = no price (Sin precio): never 0, never ranked. */
  margin_pct: number | null;
  cost_status: DishStatus;
}

export interface RankedDish extends MarginDish {
  margin_pct: number;
  /** The cost is an AI estimate: shown with an «IA» chip. */
  ai: boolean;
}

export interface MarginRanking {
  /** Dishes sold in the period (the "M" of "N de M platos"). */
  total: number;
  /** Dishes with a usable cost (the "N"). */
  costed: number;
  /** costed / total, 0–1 (the coverage bar). */
  coverage: number;
  /** At least MIN_RANKED_DISHES costed dishes: the lists below are filled. */
  enough: boolean;
  best: RankedDish[];
  worst: RankedDish[];
}

/**
 * Top / bottom dishes by margin %, only among dishes with a usable cost
 * (approved; plus AI estimates when RANKING_INCLUDES_ESTIMATED). A dish with
 * no price is never in a list and never shows $0 / 0%. Without enough costed
 * dishes there are no lists, only the coverage.
 */
export function marginRankings(
  dishes: readonly MarginDish[],
  opts: { min?: number; top?: number; includeEstimated?: boolean } = {}
): MarginRanking {
  const min = opts.min ?? MIN_RANKED_DISHES;
  const top = opts.top ?? 3;
  const includeEstimated = opts.includeEstimated ?? RANKING_INCLUDES_ESTIMATED;
  const usable: RankedDish[] = [];
  for (const d of dishes) {
    if (d.margin_pct === null || !Number.isFinite(d.margin_pct)) continue;
    const approved = d.cost_status === "aprobado";
    const estimated = d.cost_status === "estimado";
    if (!approved && !(estimated && includeEstimated)) continue;
    usable.push({ ...d, margin_pct: d.margin_pct, ai: estimated });
  }
  const total = dishes.length;
  const base = {
    total,
    costed: usable.length,
    coverage: total > 0 ? usable.length / total : 0,
    enough: usable.length >= min,
  };
  if (!base.enough) return { ...base, best: [], worst: [] };
  const byBest = [...usable].sort(
    (a, b) => b.margin_pct - a.margin_pct || b.net_sales - a.net_sales
  );
  const byWorst = [...usable].sort(
    (a, b) => a.margin_pct - b.margin_pct || b.net_sales - a.net_sales
  );
  return { ...base, best: byBest.slice(0, top), worst: byWorst.slice(0, top) };
}
