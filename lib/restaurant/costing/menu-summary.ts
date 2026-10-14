// lib/restaurant/costing/menu-summary.ts
//
// Menú › Resumen (R1-09b), from the shared dish-economics load only:
// 4 KPIs, the dish table with its Estado, and the "Configura tu menú"
// checklist. Pure. Every count here is the loader's, so Resumen, Platos
// and the Cockpit can never disagree.

import type { DishEconomicsResult, DishStatus } from "./dish-economics";
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
  economics: Pick<DishEconomicsResult, "dishes" | "totals">,
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

  const toReview = dishes.filter((d) => d.status !== "aprobado");
  const estimated = toReview.filter((d) => d.status === "estimado").length;
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
          ? `Confirmar platos (${dishes.length - toReview.length} de ${dishes.length})`
          : "Confirmar platos",
      done: dishes.length > 0 && toReview.length === 0,
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
