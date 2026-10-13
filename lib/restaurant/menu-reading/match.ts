// Match POS dishes to menu dishes, and menu components to the catalog.
// Pure and deterministic. A POS dish gets a menu dish only when the match
// is clear; anything doubtful is "No encontrado en el menú". A component
// that matches nothing is "Nuevo, sugerido" and is never created here.

import {
  AUTO_NAME_SCORE,
  bestNameMatch,
  nameMatchScore,
  normalizeMatchName,
} from "@/lib/restaurant/cost-workbook/names";
import {
  matchExistingIngredient,
  type CatalogIngredientRef,
} from "@/lib/restaurant/recipe-costing/ingredient-match";
import type { MenuDish, MenuDishVariant } from "./extract";

/** A name this close (with a matching price) is enough. */
export const PRICE_BACKED_NAME_SCORE = 0.7;
/** Prices within this share count as the same price. */
export const PRICE_TOLERANCE = 0.03;
/** Two dishes closer than this are a tie. */
const TIE_GAP = 0.08;

const SIZE_PATTERNS: Array<[RegExp, (n: string) => string]> = [
  [/\bpara\s+(\d+)\s*(?:personas?|pers\.?|pax)?\b/i, (n) => `${n}p`],
  [/\b(\d+)\s*(?:personas?|pers\.?|pax|p)\b/i, (n) => `${n}p`],
  [/\b(\d+(?:[.,]\d+)?)\s*(?:oz|onzas?)\b/i, (n) => `${n.replace(",", ".")}oz`],
];

const NUMBER_WORDS: Record<string, string> = {
  un: "1",
  una: "1",
  uno: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  ocho: "8",
  diez: "10",
  doce: "12",
};

/** "dos personas" -> "2 personas". Only before a people word, so a dish
 *  like "Tres leches" keeps its name. */
function peopleInDigits(name: string): string {
  return name.replace(
    /\b(un|una|uno|dos|tres|cuatro|cinco|seis|ocho|diez|doce)(\s+(?:personas?|pers\.?|pax)\b)/gi,
    (_, word: string, rest: string) =>
      `${NUMBER_WORDS[word.toLowerCase()]}${rest}`
  );
}

/** "Parrillada (3 personas)" -> "3p"; "Café 12 oz" -> "12oz"; else null. */
export function sizeOf(name: string): string | null {
  const text = peopleInDigits(name);
  for (const [re, canon] of SIZE_PATTERNS) {
    const hit = text.match(re);
    if (hit) return canon(hit[1]);
  }
  return null;
}

/** The name without its size: "Parrillada Pinolera 3P" -> "Parrillada Pinolera". */
export function stripSize(name: string): string {
  let out = peopleInDigits(name);
  for (const [re] of SIZE_PATTERNS) out = out.replace(re, " ");
  return out
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= PRICE_TOLERANCE;
}

function dishPrices(dish: MenuDish): number[] {
  return [dish.price, ...dish.variants.map((v) => v.price)].filter(
    (p): p is number => p != null
  );
}

function dishSizes(dish: MenuDish): string[] {
  return [
    sizeOf(dish.name),
    ...dish.variants.map((v) => sizeOf(v.label)),
  ].filter((s): s is string => s != null);
}

export interface DishMatch {
  dish: MenuDish;
  variant: MenuDishVariant | null;
  score: number;
  /** "nombre" when the name alone is clear; "nombre_y_precio" otherwise. */
  basis: "nombre" | "nombre_y_precio";
}

export function matchPosDishToMenu(
  pos: { name: string; price: number | null },
  dishes: readonly MenuDish[]
): DishMatch | null {
  const base = stripSize(pos.name);
  const size = sizeOf(pos.name);
  if (!normalizeMatchName(base)) return null;

  const scored = dishes
    .map((dish) => ({
      dish,
      score: nameMatchScore(base, stripSize(dish.name)),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const best = scored[0].score;
  if (best < PRICE_BACKED_NAME_SCORE) return null;

  // Every dish about as close as the best one.
  let tied = scored.filter((row) => best - row.score < TIE_GAP);
  // Several dishes with the same name (one per size, or per section):
  // the size, then the price, decide; otherwise it is not clear.
  if (tied.length > 1 && size) {
    const bySize = tied.filter((row) => dishSizes(row.dish).includes(size));
    if (bySize.length > 0) tied = bySize;
  }
  if (tied.length > 1) {
    const byPrice = tied.filter((row) =>
      dishPrices(row.dish).some((p) => samePrice(p, pos.price))
    );
    if (byPrice.length !== 1) return null;
    tied = byPrice;
  }
  const { dish, score } = tied[0];

  const priceAgrees = dishPrices(dish).some((p) => samePrice(p, pos.price));
  if (score < AUTO_NAME_SCORE && !priceAgrees) return null;

  const variant =
    (size ? dish.variants.find((v) => sizeOf(v.label) === size) : undefined) ??
    (dish.variants.length > 0
      ? (() => {
          const byPrice = dish.variants.filter((v) =>
            samePrice(v.price, pos.price)
          );
          return byPrice.length === 1 ? byPrice[0] : undefined;
        })()
      : undefined) ??
    null;

  return {
    dish,
    variant,
    score,
    basis: score >= AUTO_NAME_SCORE ? "nombre" : "nombre_y_precio",
  };
}

export interface CatalogPreparationRef {
  id: string;
  name: string;
}

export type ComponentMatch = {
  kind: "ingredient" | "component";
  id: string;
  name: string;
} | null;

/**
 * Suggest an existing ingredient or preparation for a menu component.
 * Only a suggestion: the person confirms it in Plato por plato.
 */
export function matchMenuComponent(
  name: string,
  catalog: {
    ingredients: readonly CatalogIngredientRef[];
    preparations: readonly CatalogPreparationRef[];
    aliases?: ReadonlyMap<string, string>;
  }
): ComponentMatch {
  const key = normalizeMatchName(name);
  if (!key) return null;
  const ingredient = matchExistingIngredient(
    name,
    catalog.ingredients,
    catalog.aliases
  );
  if (ingredient.kind === "exact") {
    return { kind: "ingredient", ...pick(ingredient.ingredient) };
  }
  const exactPrep = catalog.preparations.filter(
    (row) => normalizeMatchName(row.name) === key
  );
  if (exactPrep.length === 1) {
    return { kind: "component", ...pick(exactPrep[0]) };
  }
  const prep = bestNameMatch(name, [...catalog.preparations], (r) => r.name);
  if (prep && prep.score >= AUTO_NAME_SCORE) {
    return { kind: "component", ...pick(prep.item) };
  }
  if (ingredient.kind === "possible") {
    return { kind: "ingredient", ...pick(ingredient.ingredient) };
  }
  return null;
}

function pick(row: { id: string; name: string }): { id: string; name: string } {
  return { id: row.id, name: row.name };
}
