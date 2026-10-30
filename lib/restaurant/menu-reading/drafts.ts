// Decide, per POS dish, what the menu adds. Pure, so the rules live here
// and not in React or in the route:
// - every POS product is matched to the menu FIRST (so every menu dish can
//   be reported), then decided;
// - a dish that already HAS a recipe (see recipe-costing/has-recipe.ts: an
//   approved or newest version with lines, or an Excel suggestion) is left
//   alone: the Excel wins and the menu adds nothing. A Confirmado link only
//   says «this POS product is this plato»; it does not block the draft;
// - a dish matches a menu dish only when the match is clear, otherwise it
//   is "No encontrado en el menú";
// - the report is per MENU dish (`buildMenuOutcomes`): one entry for every
//   dish the menu lists, so the outcomes always add up to the dishes read.
// - each component suggests an existing ingredient or preparation, or is
//   "Nuevo, sugerido". Nothing is created and every quantity stays
//   Pendiente (never 0, never a guess).

import type { MenuDish } from "./extract";
import type { MenuDish as PlatoDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import {
  matchMenuComponent,
  matchPosDishToMenu,
  type CatalogPreparationRef,
  type DishMatch,
} from "./match";
import type { CatalogIngredientRef } from "@/lib/restaurant/recipe-costing/ingredient-match";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { menuMsg } from "./messages";

export const MENU_EVIDENCE_SOURCE = "menu";
import {
  FLAG_FROM_MENU,
  FLAG_NEW_SUGGESTED,
  FLAG_PENDING_INGREDIENT,
  FLAG_PENDING_QTY,
} from "@/lib/restaurant/recipe-costing/editor";

export { FLAG_FROM_MENU, FLAG_NEW_SUGGESTED, FLAG_PENDING_QTY };

export const NOT_FOUND_IN_MENU = menuMsg("es", "notFoundInMenu");
export const HAS_RECIPE_REASON = menuMsg("es", "hasRecipeReason");
export const NO_COMPONENTS_REASON = menuMsg("es", "noComponentsReason");
export const MENU_DRAFT_EXISTS_REASON = menuMsg("es", "draftExistsReason");

export interface MenuDraftProduct {
  odoo_product_id: number;
  odoo_name: string;
  pos_price: number | null;
  link_state: string | null;
  /** The plato has a recipe by the one rule (has-recipe.ts), not just a version row. */
  has_recipe: boolean;
  /** One plato may be several POS products (sizes): the same key counts once. */
  plato_key?: string;
  /** True when that recipe is a draft an earlier menu reading made. */
  menu_draft?: boolean;
}

export interface MenuDraftCatalog {
  ingredients: readonly CatalogIngredientRef[];
  preparations: readonly CatalogPreparationRef[];
  aliases?: ReadonlyMap<string, string>;
}

export type MenuDraftDecision =
  | {
      kind: "draft";
      product: MenuDraftProduct;
      match: DishMatch;
      evidence: Record<string, unknown>;
      new_components: number;
    }
  | { kind: "no_encontrado"; product: MenuDraftProduct }
  | {
      kind: "omitido";
      product: MenuDraftProduct;
      reason: string;
      code: OmittedCode;
      /** The menu dish this product matched (always set: matching is first). */
      match?: DishMatch;
    };

export type OmittedCode = "has_recipe" | "no_ingredients" | "draft_exists";

export function menuDraftLines(
  components: readonly string[],
  catalog: MenuDraftCatalog,
  lang: PreferredLanguage = "es"
): Array<Record<string, unknown>> {
  return components.map((name) => {
    const hit = matchMenuComponent(name, catalog);
    return {
      source_row: null,
      raw_name: name,
      ingredient_match: hit?.kind === "ingredient" ? hit.name : null,
      sub_recipe_match: hit?.kind === "component" ? hit.name : null,
      // The menu never says how much: the person writes it.
      qty: null,
      unit: null,
      unit_cost: null,
      pending: true,
      flags: [
        FLAG_PENDING_INGREDIENT,
        FLAG_PENDING_QTY,
        FLAG_FROM_MENU,
        ...(hit ? [] : [FLAG_NEW_SUGGESTED]),
      ],
      reasons: [
        hit
          ? menuMsg(
              lang,
              hit.kind === "component" ? "hitPreparation" : "hitIngredient",
              { name: hit.name }
            )
          : menuMsg(lang, "notInList"),
      ],
    };
  });
}

export function menuDraftEvidence(input: {
  match: DishMatch;
  lines: Array<Record<string, unknown>>;
  menuSourceId: string | null;
  menuUrl: string | null;
  lang?: PreferredLanguage;
}): Record<string, unknown> {
  const lang = input.lang ?? "es";
  const { dish, variant } = input.match;
  return {
    source: MENU_EVIDENCE_SOURCE,
    tab: null,
    block_name: null,
    filename: null,
    confidence: null,
    evidence: `${menuMsg(lang, "fromMenu", { name: dish.name })}${variant ? ` (${variant.label})` : ""}`,
    menu_source_id: input.menuSourceId,
    menu_url: input.menuUrl,
    menu_dish: dish.name,
    menu_variant: variant?.label ?? null,
    menu_section: dish.section,
    menu_description: dish.description,
    menu_price: variant?.price ?? dish.price,
    menu_match_basis: input.match.basis,
    // A dish on the menu is one plate.
    yield: { value: 1, unit: "portion", source: "menu" },
    excel_total: null,
    milton_cost: null,
    excel_match: null,
    variance_amount: null,
    variance_pct: null,
    status: "borrador",
    pending: true,
    reasons: [menuMsg(lang, "missingQuantities")],
    lines: input.lines,
  };
}

export function planMenuDrafts(input: {
  products: readonly MenuDraftProduct[];
  dishes: readonly MenuDish[];
  catalog: MenuDraftCatalog;
  menuSourceId: string | null;
  menuUrl: string | null;
  /** Language of the reasons and notes (default Spanish). */
  lang?: PreferredLanguage;
}): MenuDraftDecision[] {
  const lang = input.lang ?? "es";
  return input.products.map((product): MenuDraftDecision => {
    const match = matchPosDishToMenu(
      { name: product.odoo_name, price: product.pos_price },
      input.dishes
    );
    if (!match) return { kind: "no_encontrado", product };
    if (product.has_recipe) {
      return {
        kind: "omitido",
        product,
        reason: menuMsg(lang, "hasRecipeReason"),
        code: "has_recipe",
        match,
      };
    }
    if (product.menu_draft) {
      return {
        kind: "omitido",
        product,
        reason: menuMsg(lang, "draftExistsReason"),
        code: "draft_exists",
        match,
      };
    }
    if (match.dish.components.length === 0) {
      return {
        kind: "omitido",
        product,
        reason: menuMsg(lang, "noComponentsReason"),
        code: "no_ingredients",
        match,
      };
    }
    const lines = menuDraftLines(match.dish.components, input.catalog, lang);
    return {
      kind: "draft",
      product,
      match,
      evidence: menuDraftEvidence({
        match,
        lines,
        menuSourceId: input.menuSourceId,
        menuUrl: input.menuUrl,
        lang,
      }),
      new_components: lines.filter((line) =>
        (line.flags as string[]).includes(FLAG_NEW_SUGGESTED)
      ).length,
    };
  });
}

const OUTCOME_ORDER: Record<string, number> = {
  draft: 0,
  draft_exists: 1,
  has_recipe: 2,
  no_ingredients: 3,
  no_encontrado: 4,
};

function outcomeRank(decision: MenuDraftDecision): number {
  return OUTCOME_ORDER[
    decision.kind === "omitido" ? decision.code : decision.kind
  ];
}

/** The winning decision of a plato, plus its other POS products. */
export type MenuPlatoDecision = MenuDraftDecision & {
  /** Other POS products of the same plato (same recipe): they follow it. */
  siblings: MenuDraftProduct[];
};

/**
 * One decision per PLATO. Several POS products of the same plato (sizes, the
 * same menu item) count once: the best outcome wins, and only one of them
 * drafts. Products with no `plato_key` are their own plato.
 */
export function decisionsByPlato(
  decisions: readonly MenuDraftDecision[]
): MenuPlatoDecision[] {
  const best = new Map<string, MenuPlatoDecision>();
  for (const decision of decisions) {
    const key =
      decision.product.plato_key ?? `pos:${decision.product.odoo_product_id}`;
    const had = best.get(key);
    if (!had) {
      best.set(key, { ...decision, siblings: [] });
    } else if (outcomeRank(decision) < outcomeRank(had)) {
      best.set(key, {
        ...decision,
        siblings: [...had.siblings, had.product],
      });
    } else {
      had.siblings.push(decision.product);
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// The report per MENU dish.
// ---------------------------------------------------------------------------

export type MenuOutcomeCode =
  | "drafted"
  | "has_recipe"
  | "draft_exists"
  | "no_ingredients"
  | "no_pos_match"
  | "failed";

export interface MenuOutcome {
  /** The dish as the menu names it. */
  menu_dish: string;
  outcome: MenuOutcomeCode;
  /** The Odoo products behind the outcome (empty for «sin producto»). */
  products: Array<{ odoo_product_id: number; odoo_name: string }>;
}

const MENU_OUTCOME_RANK: Record<MenuOutcomeCode, number> = {
  drafted: 0,
  failed: 1,
  draft_exists: 2,
  has_recipe: 3,
  no_ingredients: 4,
  no_pos_match: 5,
};

function outcomeOf(
  decision: MenuPlatoDecision,
  failed: ReadonlySet<number>
): MenuOutcomeCode | null {
  if (decision.kind === "no_encontrado") return null;
  if (decision.kind === "draft") {
    return failed.has(decision.product.odoo_product_id) ? "failed" : "drafted";
  }
  return decision.code;
}

/**
 * Exactly one entry per dish the menu lists, in the menu's order, so the
 * outcomes always add up to `dishes.length`. A dish no POS product matched is
 * «no_pos_match». When several products match one dish the best outcome wins
 * and lists the products behind it.
 */
export function buildMenuOutcomes(
  dishes: readonly MenuDish[],
  decisions: readonly MenuPlatoDecision[],
  failedProductIds: ReadonlySet<number> = new Set()
): MenuOutcome[] {
  const byDish = new Map<
    MenuDish,
    Array<{ outcome: MenuOutcomeCode; products: MenuDraftProduct[] }>
  >();
  for (const decision of decisions) {
    const outcome = outcomeOf(decision, failedProductIds);
    const dish =
      decision.kind === "no_encontrado" ? null : decision.match?.dish;
    if (!outcome || !dish) continue;
    const list = byDish.get(dish) ?? [];
    list.push({ outcome, products: [decision.product, ...decision.siblings] });
    byDish.set(dish, list);
  }
  return dishes.map((dish): MenuOutcome => {
    const entries = byDish.get(dish) ?? [];
    if (entries.length === 0) {
      return { menu_dish: dish.name, outcome: "no_pos_match", products: [] };
    }
    const best = entries.reduce((a, b) =>
      MENU_OUTCOME_RANK[b.outcome] < MENU_OUTCOME_RANK[a.outcome] ? b : a
    );
    const seen = new Set<number>();
    const products: MenuOutcome["products"] = [];
    for (const entry of entries) {
      if (entry.outcome !== best.outcome) continue;
      for (const p of entry.products) {
        if (seen.has(p.odoo_product_id)) continue;
        seen.add(p.odoo_product_id);
        products.push({
          odoo_product_id: p.odoo_product_id,
          odoo_name: p.odoo_name,
        });
      }
    }
    return { menu_dish: dish.name, outcome: best.outcome, products };
  });
}

// ---------------------------------------------------------------------------
// Platos with sales this month that the menu does not list.
// ---------------------------------------------------------------------------

/** One Platos group (a menu dish of Menú › Platos) and its POS products. */
export interface MenuPlatoGroup {
  id: string;
  name: string;
  /** No product of it has a recipe (same bucket as Resumen's «sin receta»). */
  sin_receta: boolean;
  products: Array<{
    odoo_product_id: number;
    odoo_name: string;
    pos_price: number | null;
  }>;
}

// Worst first, as in costing/rollup.ts. `borrador` is a status of the
// costing core; compared as text so this module does not depend on its type.
const PENDING_ORDER = ["falta_precio", "estimado", "borrador", "sin_receta"];

/**
 * The bucket a Platos group counts in: the worst status among its variants
 * that are not covered (an approved size never makes the dish «sin receta»).
 */
function pendingStatusOf(
  variants: ReadonlyArray<{ status: string; covered: boolean }>
): string | null {
  const pending = new Set(
    variants.filter((v) => !v.covered).map((v) => v.status)
  );
  return PENDING_ORDER.find((status) => pending.has(status)) ?? null;
}

/** Platos groups of the period (already grouped by Platos, not by name). */
export function platoGroupsFromMenuDishes(
  platos: readonly PlatoDish[],
  productOf: (
    odooProductId: number
  ) => { odoo_name: string; pos_price: number | null } | undefined
): MenuPlatoGroup[] {
  return platos.map((plato) => ({
    id: plato.id,
    name: plato.name,
    sin_receta: pendingStatusOf(plato.variants) === "sin_receta",
    products: plato.variants.map((variant) => ({
      odoo_product_id: variant.odoo_product_id,
      odoo_name: productOf(variant.odoo_product_id)?.odoo_name ?? variant.name,
      pos_price: productOf(variant.odoo_product_id)?.pos_price ?? null,
    })),
  }));
}

/**
 * Names of the Platos groups with sales in the period, sin receta, that no
 * menu dish matches (any of their products). Never option combinations: the
 * groups are the Platos, not the raw POS names.
 */
export function platosNotOnMenu(
  groups: readonly MenuPlatoGroup[],
  dishes: readonly MenuDish[]
): string[] {
  return groups
    .filter(
      (group) =>
        group.sin_receta &&
        !group.products.some((product) =>
          matchPosDishToMenu(
            { name: product.odoo_name, price: product.pos_price },
            dishes
          )
        )
    )
    .map((group) => group.name);
}
