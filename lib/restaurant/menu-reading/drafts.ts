// Decide, per POS dish, what the menu adds. Pure, so the rules live here
// and not in React or in the route:
// - a dish already Confirmado, or with any recipe (from the Excel or made
//   by hand), is left alone: the Excel wins and the menu adds nothing;
// - a dish matches a menu dish only when the match is clear, otherwise it
//   is "No encontrado en el menú";
// - each component suggests an existing ingredient or preparation, or is
//   "Nuevo, sugerido". Nothing is created and every quantity stays
//   Pendiente (never 0, never a guess).

import type { MenuDish } from "./extract";
import {
  matchMenuComponent,
  matchPosDishToMenu,
  type CatalogPreparationRef,
  type DishMatch,
} from "./match";
import type { CatalogIngredientRef } from "@/lib/restaurant/recipe-costing/ingredient-match";

export const MENU_EVIDENCE_SOURCE = "menu";
import {
  FLAG_FROM_MENU,
  FLAG_NEW_SUGGESTED,
  FLAG_PENDING_INGREDIENT,
  FLAG_PENDING_QTY,
} from "@/lib/restaurant/recipe-costing/editor";

export { FLAG_FROM_MENU, FLAG_NEW_SUGGESTED, FLAG_PENDING_QTY };

export const NOT_FOUND_IN_MENU = "No encontrado en el menú";
export const HAS_RECIPE_REASON =
  "ya tiene receta (de tu Excel o hecha a mano); el menú no la cambia";
export const CONFIRMED_REASON = "este vínculo ya está Confirmado";
export const NO_COMPONENTS_REASON = "el menú no dice qué lleva este plato";
export const MENU_DRAFT_EXISTS_REASON = "ya tiene un borrador del menú";

export interface MenuDraftProduct {
  odoo_product_id: number;
  odoo_name: string;
  pos_price: number | null;
  link_state: string | null;
  /** True when the dish already has any recipe version, or an Excel suggestion. */
  has_recipe: boolean;
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
  | { kind: "omitido"; product: MenuDraftProduct; reason: string };

export function menuDraftLines(
  components: readonly string[],
  catalog: MenuDraftCatalog
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
          ? `Del menú; parece ${hit.kind === "component" ? "tu preparación" : "tu ingrediente"} «${hit.name}». Confírmalo y escribe cuánto lleva.`
          : "Del menú; no está en tu lista. Nuevo, sugerido: créalo o elige uno de tu lista.",
      ],
    };
  });
}

export function menuDraftEvidence(input: {
  match: DishMatch;
  lines: Array<Record<string, unknown>>;
  menuSourceId: string | null;
  menuUrl: string | null;
}): Record<string, unknown> {
  const { dish, variant } = input.match;
  return {
    source: MENU_EVIDENCE_SOURCE,
    tab: null,
    block_name: null,
    filename: null,
    confidence: null,
    evidence: `Del menú: ${dish.name}${variant ? ` (${variant.label})` : ""}`,
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
    reasons: ["Faltan las cantidades: el menú dice qué lleva, no cuánto."],
    lines: input.lines,
  };
}

export function planMenuDrafts(input: {
  products: readonly MenuDraftProduct[];
  dishes: readonly MenuDish[];
  catalog: MenuDraftCatalog;
  menuSourceId: string | null;
  menuUrl: string | null;
}): MenuDraftDecision[] {
  return input.products.map((product): MenuDraftDecision => {
    if (product.link_state === "confirmado") {
      return { kind: "omitido", product, reason: CONFIRMED_REASON };
    }
    if (product.has_recipe) {
      return {
        kind: "omitido",
        product,
        reason: product.menu_draft
          ? MENU_DRAFT_EXISTS_REASON
          : HAS_RECIPE_REASON,
      };
    }
    const match = matchPosDishToMenu(
      { name: product.odoo_name, price: product.pos_price },
      input.dishes
    );
    if (!match) return { kind: "no_encontrado", product };
    if (match.dish.components.length === 0) {
      return { kind: "omitido", product, reason: NO_COMPONENTS_REASON };
    }
    const lines = menuDraftLines(match.dish.components, input.catalog);
    return {
      kind: "draft",
      product,
      match,
      evidence: menuDraftEvidence({
        match,
        lines,
        menuSourceId: input.menuSourceId,
        menuUrl: input.menuUrl,
      }),
      new_components: lines.filter((line) =>
        (line.flags as string[]).includes(FLAG_NEW_SUGGESTED)
      ).length,
    };
  });
}
