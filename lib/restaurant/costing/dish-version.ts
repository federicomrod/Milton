// lib/restaurant/costing/dish-version.ts
//
// ONE answer to "which recipe version does this dish use". The Plato screen
// (hasRecipe, the editor it loads), the workspace editor view and the dish
// engine (dish-economics `dishFromProduct`) all call it, so the screen can
// never say «Este plato todavía no tiene receta» for a dish the engine costs.
//
//   * The recipe id of a dish is the product's own `menu_item_id`, or, when the
//     list row has none, the one on its POS link.
//   * The version is the approved one in force, else the newest version of any
//     status (in review, legacy / imported from Excel). Pure, no I/O.

import { pickDishVersions, type StateVersion } from "./dish-state";

/** The recipe (menu item) id of a dish: its own, or the link's. */
export function resolveDishMenuItemId(
  productMenuItemId: string | null | undefined,
  linkMenuItemId?: string | null
): string | null {
  return productMenuItemId || linkMenuItemId || null;
}

export interface DishVersionPick<T extends StateVersion> {
  menu_item_id: string | null;
  versions: T[];
  approved: T | null;
  newest: T | null;
  /** What the dish shows and is costed with: approved in force, else newest. */
  version: T | null;
}

export function pickDishVersion<T extends StateVersion>(input: {
  productMenuItemId: string | null | undefined;
  linkMenuItemId?: string | null;
  versionsByMenuItem: ReadonlyMap<string, T[]>;
  asOfDate?: string | null;
}): DishVersionPick<T> {
  const menu_item_id = resolveDishMenuItemId(
    input.productMenuItemId,
    input.linkMenuItemId
  );
  const versions = menu_item_id
    ? (input.versionsByMenuItem.get(menu_item_id) ?? [])
    : [];
  return {
    menu_item_id,
    versions,
    ...pickDishVersions(versions, input.asOfDate),
  };
}

/**
 * Does the screen show the editor (true) or the empty state (false)?
 * Empty = no recipe id or no version at all. ANY version (approved, in
 * review, legacy, even one with no lines yet) is shown in the editor: its
 * lines can be added there, or brought from the last file. «Crear receta»
 * would make a SECOND recipe, so it is only offered when there is none.
 */
export function dishHasRecipe(input: {
  menuItemId: string | null | undefined;
  versionId: string | null | undefined;
  /** Kept for callers; an empty version still opens the editor. */
  lineCount?: number;
  evidenceLineCount?: number;
}): boolean {
  if (!input.menuItemId || !input.versionId) return false;
  return true;
}
