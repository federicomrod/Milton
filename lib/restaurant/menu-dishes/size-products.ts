// Menú › Platos, a size row opened into its Odoo products (Part D). Pure.
// - one row per POS product (its restaurant parts add up);
// - a product with no recipe lines of its own (Sin receta / Borrador) can use
//   the recipe of an approved sibling of the same dish: same size first, then
//   the one that sells most. It is a shared link, never a copy;
// - the «Aprobado N de M» tooltip names the products that are not approved.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { dishStatusLabel, unconfirmedLinkLabel } from "./status-labels";
import { dishSums, type MenuDishVariant } from "./menu-dishes";

export interface SizeProduct {
  odoo_product_id: number;
  name: string;
  /** Status id as a string: «borrador» may or may not exist yet. */
  status: string;
  covered: boolean;
  state_reason: MenuDishVariant["state_reason"];
  menu_item_id: string | null;
  size: number | null;
  size_unit: MenuDishVariant["size_unit"];
  cost_basis: MenuDishVariant["cost_basis"];
  sums: ReturnType<typeof dishSums>;
}

/** One entry per POS product, best sellers first. */
export function productsOf(
  variants: readonly MenuDishVariant[]
): SizeProduct[] {
  const byId = new Map<number, MenuDishVariant[]>();
  for (const v of variants) {
    byId.set(v.odoo_product_id, [...(byId.get(v.odoo_product_id) ?? []), v]);
  }
  return [...byId.values()]
    .map((list) => {
      const first = list[0];
      return {
        odoo_product_id: first.odoo_product_id,
        name: first.name,
        status: first.status as string,
        covered: list.every((v) => v.covered),
        state_reason: first.state_reason ?? null,
        menu_item_id: first.menu_item_id ?? null,
        size: first.size,
        size_unit: first.size_unit,
        cost_basis: first.cost_basis,
        sums: dishSums(list),
      };
    })
    .sort((a, b) => b.sums.net_sales - a.sums.net_sales);
}

/** The chip text of a product: its status, or the unconfirmed-link label. */
export function productStatusLabel(
  p: {
    status: string;
    state_reason?: MenuDishVariant["state_reason"];
  },
  lang: PreferredLanguage = "es"
): string {
  if (p.status === "aprobado" && p.state_reason === "vinculo_sin_confirmar") {
    return unconfirmedLinkLabel(lang);
  }
  return dishStatusLabel(p.status, lang);
}

/** Only a product with no recipe lines of its own can take a sibling's recipe. */
export function canUseSiblingRecipe(p: { status: string }): boolean {
  return p.status === "sin_receta" || p.status === "borrador";
}

/**
 * The approved sibling whose recipe a product can use: same size first, then
 * the best-selling one. Null when the dish has no approved sibling with a
 * recipe of its own.
 */
export function pickApprovedSibling(
  dishVariants: readonly MenuDishVariant[],
  target: Pick<SizeProduct, "odoo_product_id" | "size" | "size_unit">
): SizeProduct | null {
  const candidates = productsOf(dishVariants).filter(
    (p) =>
      p.odoo_product_id !== target.odoo_product_id &&
      p.status === "aprobado" &&
      p.cost_basis === "own" &&
      p.menu_item_id !== null
  );
  const sameSize = candidates.filter(
    (p) => p.size === target.size && p.size_unit === target.size_unit
  );
  return sameSize[0] ?? candidates[0] ?? null;
}

/** «Faltan: Parrillada Demo 6 oz Eventos (Sin receta), …» or null. */
export function missingProductsTip(
  dishVariants: readonly MenuDishVariant[],
  lang: PreferredLanguage = "es"
): string | null {
  const missing = productsOf(dishVariants).filter(
    (p) => p.status !== "aprobado"
  );
  if (missing.length === 0) return null;
  return fmt(getDictionary(lang).menu.screens.dishes.missingTip, {
    list: missing
      .map((p) => `${p.name} (${productStatusLabel(p, lang)})`)
      .join(", "),
  });
}
